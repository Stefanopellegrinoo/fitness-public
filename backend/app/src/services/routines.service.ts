import { prisma } from '../lib/prisma';
import { DayOfWeek } from '@prisma/client';

/**
 * `today` is a REQUIRED parameter, not a default: this function used to read
 * the process clock itself, which silently overrode the weekday its own caller
 * had already resolved from the client. Same call as `tz` on `getWeeklyVolume`
 * (slice 2, D11) -- a zone-dependent input with a server-side default is a bug
 * that every caller inherits without writing a line of code.
 */
export async function suggestNextRoutineDay(userId: string, routineId: string, today: DayOfWeek) {
    const days = await prisma.routineDay.findMany({
        where: { routineId, routine: { userId } },
        orderBy: { order: 'asc' },
    });
    if (days.length === 0) return null;

    // A day anchored to the caller's current weekday wins outright: the start
    // button offers today's plan, whatever the rotation says. The rotation only
    // decides for days without a weekday anchor (or when today has none).
    const todaysDay = days.find((day) => day.weekday === today);
    if (todaysDay) return todaysDay;

    // A session with zero sets holds no training data, so it cannot anchor the
    // rotation: otherwise starting a workout and logging nothing advances the routine
    // and the next real workout serves the day AFTER the one that was never trained.
    const lastSession = await prisma.workoutSession.findFirst({
        where: { userId, routineId, routineDayId: { not: null }, sets: { some: {} } },
        orderBy: { startedAt: 'desc' },
        select: { routineDayId: true },
    });

    if (lastSession?.routineDayId) {
        const lastIndex = days.findIndex((day) => day.id === lastSession.routineDayId);
        if (lastIndex >= 0) return days[(lastIndex + 1) % days.length];
    }

    return days[0];
}
