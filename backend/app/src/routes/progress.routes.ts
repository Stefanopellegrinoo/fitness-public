import { Router, Request, Response } from 'express';
import { prisma } from '../lib/prisma';
import { authMiddleware } from '../middlewares/auth.middleware';
import { addCalendarDays, dayWindowInZone, isoWeekWindowInZone, localDateInZone, formatLocalDate, resolveIanaZone, startOfLocalDate } from '../lib/date';

const router = Router();

/**
 * GET /api/progress/body
 * Get weight, muscle and fat history for charts
 */
router.get('/body', authMiddleware, async (req: Request, res: Response) => {
    const userId = req.user!.userId;
    const days = parseInt(req.query.days as string) || 30;

    // Validated BEFORE the try/500-mapping below: a 400 on the caller's own
    // bad `tz` is not an internal failure (D1/D2). The fallback is read HERE,
    // per request, never at module scope (M10).
    let zone: string;
    try {
        zone = resolveIanaZone(req.query.tz);
    } catch (err: any) {
        res.status(400).json({ error: { message: 'Validation error', details: err.message } });
        return;
    }

    try {
        // The window is computed INSIDE the try, not before it (D4): an
        // out-of-range `days` makes `startOfLocalDate` throw a RangeError,
        // and that throw must land in THIS route's own 500, not escape to
        // express's generic errorHandler (a silent contract change).
        const now = new Date();
        const today = dayWindowInZone(now, zone);
        const startDate = startOfLocalDate(addCalendarDays(localDateInZone(now, zone), -days), zone);

        const metrics = await prisma.bodyMetrics.findMany({
            where: {
                userId,
                createdAt: { gte: startDate, lt: today.endExclusive }
            },
            orderBy: { createdAt: 'asc' }
        });

        // Format for charts
        const chartData = metrics.map(m => ({
            date: m.createdAt.toISOString(),
            weight: m.weightKg,
            muscle: m.muscleMassKg,
            fat: m.fatMassKg
        }));

        res.json({ data: chartData });
    } catch (err: any) {
        res.status(500).json({ error: { message: 'Failed to fetch body progress' } });
    }
});

/**
 * GET /api/progress/workouts
 * Get weekly volume and frequency history
 */
router.get('/workouts', authMiddleware, async (req: Request, res: Response) => {
    const userId = req.user!.userId;
    const weeks = parseInt(req.query.weeks as string) || 12;

    let zone: string;
    try {
        zone = resolveIanaZone(req.query.tz);
    } catch (err: any) {
        res.status(400).json({ error: { message: 'Validation error', details: err.message } });
        return;
    }

    try {
        // Window computed INSIDE the try -- see the /body handler above (D4).
        // Floor stays ROLLING (calendar days back from today), not aligned to
        // Monday: aligning it is a chart-shape decision, out of scope (D7).
        // Ceiling is the end of the CURRENT ISO WEEK, not the current day
        // (D6): a session later this same week must still count, which is
        // exactly what makes it comparable to dashboard's weeklyWorkouts (O2).
        const now = new Date();
        const week = isoWeekWindowInZone(now, zone);
        const startDate = startOfLocalDate(addCalendarDays(localDateInZone(now, zone), -weeks * 7), zone);

        const sessions = await prisma.workoutSession.findMany({
            where: {
                userId,
                startedAt: { gte: startDate, lt: week.endExclusive },
                // A session with zero sets holds no training data, so it is neither a
                // session nor a trained day. Same predicate the stale sweep, startWorkout
                // step 5 and GET /workouts/sessions already use to say exactly that.
                sets: { some: {} }
            },
            include: {
                sets: true
            },
            orderBy: { startedAt: 'asc' }
        });

        // Group by week, in the caller's zone (never the raw UTC instant -- m8/m9/m10).
        // `days` tracks distinct calendar days so activeDays reflects days trained,
        // not raw session count (two sessions same day = one active day).
        const weeklyStats: Record<string, { volume: number, sessions: number, days: Set<string> }> = {};

        sessions.forEach(s => {
            const weekStart = isoWeekWindowInZone(s.startedAt, zone).start;
            const weekKey = formatLocalDate(localDateInZone(weekStart, zone));
            if (!weeklyStats[weekKey]) {
                weeklyStats[weekKey] = { volume: 0, sessions: 0, days: new Set() };
            }
            weeklyStats[weekKey].sessions += 1;
            weeklyStats[weekKey].days.add(formatLocalDate(localDateInZone(s.startedAt, zone)));
            s.sets.forEach(set => {
                if (set.setType === 'WARMUP') return;
                weeklyStats[weekKey].volume += (set.weightKg || 0) * (set.reps || 0);
            });
        });

        // A calendar day belongs to exactly one week, so summing per-week activeDays
        // on the client yields the total distinct active days across the range.
        const chartData = Object.entries(weeklyStats).map(([date, stats]) => ({
            date,
            volume: stats.volume,
            sessions: stats.sessions,
            activeDays: stats.days.size
        }));

        res.json({ data: chartData });
    } catch (err: any) {
        res.status(500).json({ error: { message: 'Failed to fetch workout progress' } });
    }
});

/**
 * GET /api/progress/nutrition
 * Get calorie and protein average history
 */
router.get('/nutrition', authMiddleware, async (req: Request, res: Response) => {
    const userId = req.user!.userId;
    const days = parseInt(req.query.days as string) || 30;

    let zone: string;
    try {
        zone = resolveIanaZone(req.query.tz);
    } catch (err: any) {
        res.status(400).json({ error: { message: 'Validation error', details: err.message } });
        return;
    }

    try {
        // Window computed INSIDE the try -- see the /body handler above (D4).
        const now = new Date();
        const today = dayWindowInZone(now, zone);
        const startDate = startOfLocalDate(addCalendarDays(localDateInZone(now, zone), -days), zone);

        const entries = await prisma.nutritionEntry.findMany({
            where: {
                userId,
                date: { gte: startDate, lt: today.endExclusive }
            },
            orderBy: { date: 'asc' }
        });

        // Group by day, in the caller's zone (never the raw UTC instant -- m8).
        const dailyStats: Record<string, { calories: number, protein: number }> = {};

        entries.forEach(e => {
            const dateKey = formatLocalDate(localDateInZone(e.date, zone));
            if (!dailyStats[dateKey]) {
                dailyStats[dateKey] = { calories: 0, protein: 0 };
            }
            dailyStats[dateKey].calories += (e.calories || 0);
            dailyStats[dateKey].protein += (e.protein || 0);
        });

        const chartData = Object.entries(dailyStats).map(([date, stats]) => ({
            date,
            ...stats
        }));

        res.json({ data: chartData });
    } catch (err: any) {
        res.status(500).json({ error: { message: 'Failed to fetch nutrition progress' } });
    }
});

export default router;
