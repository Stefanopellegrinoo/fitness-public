import { prisma } from '../lib/prisma';
import { dayWindowInZone, isoWeekWindowInZone } from '../lib/date';

export interface DashboardSummary {
    todayCalories: number;
    weeklyWorkouts: number;
    activeMinutes: number;
    currentWeightKg: number | null;
    nextWorkout: {
        id: string;
        name: string;
        exercisesCount: number;
    } | null;
}

const ESTIMATED_MINUTES_PER_WORKOUT = 45;

export class DashboardService {
    // `timeZone` is ALWAYS an IANA identifier by the time it reaches here --
    // the route validates a caller-supplied `tz` and resolves the process
    // zone when it is absent, so this method never branches on whether one
    // was given (design D1: one calculation to test, not a legacy path).
    async getSummary(userId: string, timeZone: string): Promise<DashboardSummary> {
        const now = new Date();
        const today = dayWindowInZone(now, timeZone);
        const week = isoWeekWindowInZone(now, timeZone);

        const [nutritionToday, weeklyWorkouts, latestWeightMetric, nextRoutine] = await Promise.all([
            prisma.nutritionEntry.findMany({
                where: { userId, date: { gte: today.start, lt: today.endExclusive } },
            }),
            // A session with zero sets holds no training data. It is not a workout, and
            // since activeMinutes is this count times ESTIMATED_MINUTES_PER_WORKOUT,
            // counting it would also invent 45 minutes of training that never happened.
            prisma.workoutSession.count({
                where: { userId, startedAt: { gte: week.start, lt: week.endExclusive }, sets: { some: {} } },
            }),
            prisma.bodyMetrics.findFirst({
                where: { userId, weightKg: { not: null } },
                orderBy: { createdAt: 'desc' },
                select: { weightKg: true },
            }),
            prisma.routine.findFirst({
                where: { userId },
                include: {
                    days: { include: { _count: { select: { exercises: true } } } },
                    _count: { select: { exercises: true } },
                },
                orderBy: { updatedAt: 'desc' },
            }),
        ]);

        const todayCalories = nutritionToday.reduce(
            (sum: number, entry: { calories: number | null }) => sum + (entry.calories || 0),
            0
        );

        return {
            todayCalories: Math.round(todayCalories),
            weeklyWorkouts,
            activeMinutes: weeklyWorkouts * ESTIMATED_MINUTES_PER_WORKOUT,
            currentWeightKg: await this.resolveCurrentWeight(userId, latestWeightMetric?.weightKg ?? null),
            nextWorkout: this.mapNextWorkout(nextRoutine),
        };
    }

    private async resolveCurrentWeight(userId: string, metricWeightKg: number | null): Promise<number | null> {
        if (metricWeightKg !== null) return metricWeightKg;

        const user = await prisma.user.findUnique({
            where: { id: userId },
            select: { currentWeightKg: true },
        });
        return user?.currentWeightKg ?? null;
    }

    private mapNextWorkout(
        routine: {
            id: string;
            name: string;
            days: { _count: { exercises: number } }[];
            _count: { exercises: number };
        } | null
    ): DashboardSummary['nextWorkout'] {
        if (!routine) return null;

        const exercisesCount = routine.days.length > 0
            ? routine.days.reduce((total, day) => total + day._count.exercises, 0)
            : routine._count.exercises; // legacy flat fallback

        return { id: routine.id, name: routine.name, exercisesCount };
    }
}

export const dashboardService = new DashboardService();
