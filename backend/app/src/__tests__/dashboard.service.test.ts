/**
 * Dashboard Service Tests
 *
 * Coverage:
 * - getSummary(): today calories aggregation, weekly workout count, active minutes
 * - currentWeightKg resolution: latest body metric -> profile fallback -> null
 * - nextWorkout mapping: day-based exercise count, legacy flat fallback, null routine
 * - day/week windows sent to Prisma follow the caller's IANA zone (user-timezone-day-boundaries)
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { dashboardService } from '../services/dashboard.service';
import { prisma } from '../lib/prisma';

vi.mock('../lib/prisma', () => ({
    prisma: {
        nutritionEntry: { findMany: vi.fn() },
        workoutSession: { count: vi.fn() },
        routine: { findFirst: vi.fn() },
        bodyMetrics: { findFirst: vi.fn() },
        user: { findUnique: vi.fn() },
    },
}));

const mocked = prisma as unknown as {
    nutritionEntry: { findMany: ReturnType<typeof vi.fn> };
    workoutSession: { count: ReturnType<typeof vi.fn> };
    routine: { findFirst: ReturnType<typeof vi.fn> };
    bodyMetrics: { findFirst: ReturnType<typeof vi.fn> };
    user: { findUnique: ReturnType<typeof vi.fn> };
};

const USER_ID = 'user-123';

function givenDefaults() {
    mocked.nutritionEntry.findMany.mockResolvedValue([]);
    mocked.workoutSession.count.mockResolvedValue(0);
    mocked.routine.findFirst.mockResolvedValue(null);
    mocked.bodyMetrics.findFirst.mockResolvedValue(null);
    mocked.user.findUnique.mockResolvedValue(null);
}

describe('DashboardService.getSummary', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        givenDefaults();
    });

    describe('currentWeightKg resolution', () => {
        it('returns weight from the latest body metric when one exists', async () => {
            mocked.bodyMetrics.findFirst.mockResolvedValue({ weightKg: 82.4 });
            mocked.user.findUnique.mockResolvedValue({ currentWeightKg: 90 });

            const summary = await dashboardService.getSummary(USER_ID, 'UTC');

            expect(summary.currentWeightKg).toBe(82.4);
            expect(mocked.bodyMetrics.findFirst).toHaveBeenCalledWith(
                expect.objectContaining({
                    where: expect.objectContaining({
                        userId: USER_ID,
                        weightKg: { not: null },
                    }),
                    orderBy: { createdAt: 'desc' },
                })
            );
        });

        it('falls back to the profile weight when there are no body metrics', async () => {
            mocked.bodyMetrics.findFirst.mockResolvedValue(null);
            mocked.user.findUnique.mockResolvedValue({ currentWeightKg: 80.5 });

            const summary = await dashboardService.getSummary(USER_ID, 'UTC');

            expect(summary.currentWeightKg).toBe(80.5);
        });

        it('returns null when neither body metrics nor profile have weight', async () => {
            const summary = await dashboardService.getSummary(USER_ID, 'UTC');

            expect(summary.currentWeightKg).toBeNull();
        });
    });

    describe('activity aggregation', () => {
        it('sums today calories (rounded) and derives active minutes from weekly workouts', async () => {
            mocked.nutritionEntry.findMany.mockResolvedValue([
                { calories: 420.4 },
                { calories: 219.9 },
                { calories: null },
            ]);
            mocked.workoutSession.count.mockResolvedValue(3);

            const summary = await dashboardService.getSummary(USER_ID, 'UTC');

            expect(summary.todayCalories).toBe(640);
            expect(summary.weeklyWorkouts).toBe(3);
            expect(summary.activeMinutes).toBe(135);
        });
    });

    describe('nextWorkout mapping', () => {
        it('maps the most recent routine with a day-based exercise count', async () => {
            mocked.routine.findFirst.mockResolvedValue({
                id: 'routine-1',
                name: 'Push Pull Legs',
                days: [
                    { _count: { exercises: 3 } },
                    { _count: { exercises: 2 } },
                ],
                _count: { exercises: 0 },
            });

            const summary = await dashboardService.getSummary(USER_ID, 'UTC');

            expect(summary.nextWorkout).toEqual({
                id: 'routine-1',
                name: 'Push Pull Legs',
                exercisesCount: 5,
            });
        });

        it('uses the legacy flat exercise count when the routine has no days', async () => {
            mocked.routine.findFirst.mockResolvedValue({
                id: 'routine-2',
                name: 'Full Body',
                days: [],
                _count: { exercises: 7 },
            });

            const summary = await dashboardService.getSummary(USER_ID, 'UTC');

            expect(summary.nextWorkout).toEqual({
                id: 'routine-2',
                name: 'Full Body',
                exercisesCount: 7,
            });
        });

        it('returns null nextWorkout when the user has no routines', async () => {
            const summary = await dashboardService.getSummary(USER_ID, 'UTC');

            expect(summary.nextWorkout).toBeNull();
        });
    });

    // user-timezone-day-boundaries, task 2.1. The `where` reaching Prisma is
    // asserted with LITERAL ISO instants, never by calling
    // dayWindowInZone/isoWeekWindowInZone here -- deriving the expectation from
    // the function under test would let a bug like ending the window at
    // 23:59:59.999 (M5) pass, since both sides of the assertion would carry the
    // same bug. `where` is compared EXACT (no expect.objectContaining nested
    // inside it): a call missing `lt` entirely, or holding a stale window from
    // the wrong caller, has to fail this, not just widen a partial match.
    describe('day/week windows sent to Prisma follow the caller\'s IANA zone', () => {
        const TZ = 'America/Argentina/Buenos_Aires';
        // 2025-06-05T18:00:00Z = Thursday 15:00 in Buenos Aires (fixed UTC-3,
        // no DST since 2009 -- so this literal never drifts with the calendar).
        const NOW = '2025-06-05T18:00:00.000Z';
        const DAY_START = new Date('2025-06-05T03:00:00.000Z');
        const DAY_END_EXCLUSIVE = new Date('2025-06-06T03:00:00.000Z');
        const WEEK_START = new Date('2025-06-02T03:00:00.000Z'); // Monday
        const WEEK_END_EXCLUSIVE = new Date('2025-06-09T03:00:00.000Z'); // next Monday

        beforeEach(() => {
            vi.useFakeTimers();
            vi.setSystemTime(new Date(NOW));
        });

        afterEach(() => {
            vi.useRealTimers();
        });

        it('queries nutritionEntry for todayCalories with the exact day window', async () => {
            await dashboardService.getSummary(USER_ID, TZ);

            expect(mocked.nutritionEntry.findMany).toHaveBeenCalledWith({
                where: { userId: USER_ID, date: { gte: DAY_START, lt: DAY_END_EXCLUSIVE } },
            });
        });

        it('queries workoutSession for weeklyWorkouts/activeMinutes with the exact week window', async () => {
            await dashboardService.getSummary(USER_ID, TZ);

            expect(mocked.workoutSession.count).toHaveBeenCalledWith({
                where: {
                    userId: USER_ID,
                    startedAt: { gte: WEEK_START, lt: WEEK_END_EXCLUSIVE },
                    sets: { some: {} },
                },
            });
        });
    });
});
