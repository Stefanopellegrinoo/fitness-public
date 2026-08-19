import { Router, Request, Response } from 'express';
import { prisma } from '../lib/prisma';
import { authMiddleware } from '../middlewares/auth.middleware';
import { dashboardService } from '../services/dashboard.service';
import { addCalendarDays, isoWeekWindowInZone, localDateInZone, resolveIanaZone, startOfLocalDate } from '../lib/date';

const router = Router();

// GET: Volume analytics per muscle group
router.get('/stats/volume', authMiddleware, async (req: Request, res: Response) => {
    const userId = req.user!.userId;

    // Validated BEFORE the try/500-mapping below, same shape as the `/` handler below: a 400
    // on the caller's own bad input is not an internal failure. The fallback zone is read
    // fresh per request inside `resolveIanaZone`, never hoisted to module scope (M10).
    let zone: string;
    try {
        zone = resolveIanaZone(req.query.tz);
    } catch (err: any) {
        res.status(400).json({ error: { message: 'Validation error', details: err.message } });
        return;
    }

    try {
        const now = new Date();

        // Current week = the caller's ISO week (Monday-first), same definition `/api/dashboard`
        // and `/progress/workouts` already use. Previous week = the calendar week immediately
        // before it -- by calendar arithmetic (D8), never `week.start - 7*24h`.
        const currentWeek = isoWeekWindowInZone(now, zone);
        const monday = localDateInZone(currentWeek.start, zone);
        const lastStart = startOfLocalDate(addCalendarDays(monday, -7), zone);

        // Fetch all sessions for both weeks. Ceiling is semi-open (`lt`, not `lte`): the
        // previous closed-range ceiling here was already `<=` end-of-week, and the fix that
        // makes it uniform with every other window in this slice is on the other four sites
        // (R5) -- this one already had SOME ceiling, unlike those.
        const sessions = await prisma.workoutSession.findMany({
            where: {
                userId,
                startedAt: { gte: lastStart, lt: currentWeek.endExclusive }
            },
            include: {
                sets: {
                    include: { exercise: true }
                }
            }
        });

        const stats: Record<string, { current: number, previous: number }> = {};

        sessions.forEach(session => {
            const isCurrentWeek = session.startedAt >= currentWeek.start;

            session.sets.forEach(set => {
                if (set.setType === 'WARMUP') return;
                const category = set.exercise?.category || 'OTRO';
                const volume = (set.weightKg || 0) * (set.reps || 0);

                if (!stats[category]) {
                    stats[category] = { current: 0, previous: 0 };
                }

                if (isCurrentWeek) {
                    stats[category].current += volume;
                } else {
                    stats[category].previous += volume;
                }
            });
        });

        res.json({ data: stats });
    } catch (err: any) {
        console.error('Error calculating volume stats:', err);
        res.status(500).json({ error: { message: 'Failed to calculate statistics' } });
    }
});

// GET: Dashboard summary stats
router.get('/', authMiddleware, async (req: Request, res: Response) => {
    // Validated BEFORE the try/500-mapping below, same shape as
    // nutrition.routes.ts's `parseBound` (lines ~300-307): a 400 on the
    // caller's own bad input is not an internal failure, so it must not be
    // swept into the generic 500 handler below.
    //
    // The fallback zone is read HERE, per request -- never hoisted to module
    // scope, which would freeze it at import time and never notice a later
    // `process.env.TZ` change (M10).
    let zone: string;
    try {
        zone = resolveIanaZone(req.query.tz);
    } catch (err: any) {
        res.status(400).json({ error: { message: 'Validation error', details: err.message } });
        return;
    }

    try {
        const summary = await dashboardService.getSummary(req.user!.userId, zone);
        res.json({ data: summary });
    } catch (err: any) {
        console.error('Error fetching dashboard stats:', err);
        res.status(500).json({ error: { message: 'Failed to fetch dashboard stats' } });
    }
});

export default router;
