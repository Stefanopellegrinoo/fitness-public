/**
 * Workout Session Lifecycle Tests
 *
 * Guards the session model against silent history corruption:
 * - start with an active session resumes it (no duplicates)
 * - start after finishing today's session creates a NEW session
 *   (it must NOT reopen the finished one nor overwrite its startedAt)
 * - stale (>24h) abandoned sessions are never resumed: they are closed at
 *   their last logged set (or deleted when empty) and a fresh session starts
 * - concurrent starts converge on a single open session (no ghost duplicates)
 * - a start whose resume check missed the winner converges on it instead of
 *   closing it underneath the caller that holds it
 * - the auto-close is scoped to the row the resume check actually observed, so
 *   a session created after that read is never closed by a caller that never
 *   saw it
 * - a start whose retry budget is spent converges on the open session instead
 *   of letting a raw P2002 surface as a 500
 * - switching routines never destroys user-authored notes — including a note
 *   written after the resume read — and a rejected routineDayId never leaves
 *   the user without their live session
 * - a start that cannot converge on a matching session fails loudly instead of
 *   answering 201 with a session for a routine the caller never asked for
 * - the raw-SQL partial unique index the whole path relies on is exercised by a
 *   real write, with its name pinned separately
 */

import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest';
import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { workoutService, isOpenSessionConflict } from '../services/workouts.service';

describe('Workout session lifecycle', () => {
    let userId: string;
    let exerciseId: string;
    let routineId: string;

    beforeAll(async () => {
        const user = await prisma.user.create({
            data: { email: `lifecycle.${Date.now()}@example.com`, password: 'password123' },
        });
        userId = user.id;

        const exercise = await prisma.exercise.create({
            data: { name: `Lifecycle ${Date.now()}`, category: 'PECHO', primaryMuscles: ['pecho'] },
        });
        exerciseId = exercise.id;

        const routine = await prisma.routine.create({
            data: { name: 'Lifecycle Routine', userId },
        });
        routineId = routine.id;
    });

    afterAll(async () => {
        await prisma.workoutSet.deleteMany({ where: { session: { userId } } });
        await prisma.workoutSession.deleteMany({ where: { userId } });
        await prisma.routine.deleteMany({ where: { userId } });
        await prisma.exercise.delete({ where: { id: exerciseId } });
        await prisma.user.delete({ where: { id: userId } });
    });

    // Every nested describe opens from a clean slate through beforeEach. Resetting
    // at the END of a test is unreliable: the reset never runs when the body
    // throws, so one failure silently poisons the tests that follow it.
    // The two tests directly below are the deliberate exception — they run in
    // declaration order and the second finishes the session the first opened.
    const closeAllOpenSessions = async () => {
        await prisma.workoutSession.updateMany({
            where: { userId, finishedAt: null },
            data: { finishedAt: new Date() },
        });
    };

    it('resumes the active session instead of creating a duplicate', async () => {
        const first = await workoutService.startWorkout(userId, routineId);
        const second = await workoutService.startWorkout(userId, routineId);

        expect(second.id).toBe(first.id);

        const count = await prisma.workoutSession.count({ where: { userId } });
        expect(count).toBe(1);
    });

    it('creates a new session after today\'s session was finished, preserving the old one', async () => {
        const countBefore = await prisma.workoutSession.count({ where: { userId } });
        const active = await prisma.workoutSession.findFirst({ where: { userId, finishedAt: null } });
        // Ordered pair: this reads the session the previous test opened. Say so on
        // failure instead of dying on a null dereference three lines down.
        expect(active, 'expected the previous test to leave exactly one open session').not.toBeNull();

        // The set is what makes this a workout rather than a session nobody trained:
        // `finishWorkout` DISCARDS an empty one, and there would be no history left to
        // assert is preserved.
        await prisma.workoutSet.create({
            data: { sessionId: active!.id, exerciseId, setNumber: 1, weightKg: 60, reps: 10 },
        });

        const finished = await workoutService.finishWorkout(active!.id, userId);
        const originalStartedAt = finished.startedAt.toISOString();
        const originalFinishedAt = finished.finishedAt!.toISOString();

        const next = await workoutService.startWorkout(userId, routineId);

        // A brand-new session, not the reopened old one
        expect(next.id).not.toBe(finished.id);
        expect(next.finishedAt).toBeNull();

        // The finished session's history must remain untouched
        const untouched = await prisma.workoutSession.findUnique({ where: { id: finished.id } });
        expect(untouched!.startedAt.toISOString()).toBe(originalStartedAt);
        expect(untouched!.finishedAt?.toISOString()).toBe(originalFinishedAt);

        const count = await prisma.workoutSession.count({ where: { userId } });
        expect(count).toBe(countBefore + 1);
    });

    describe('stale (abandoned) sessions', () => {
        beforeEach(closeAllOpenSessions);

        it('does not resume a stale open session: closes it at its last set and starts fresh', async () => {
            const staleStart = new Date(Date.now() - 26 * 60 * 60 * 1000);
            const lastSetAt = new Date(Date.now() - 25 * 60 * 60 * 1000);
            const ghost = await prisma.workoutSession.create({
                data: { userId, routineId, startedAt: staleStart, finishedAt: null },
            });
            await prisma.workoutSet.create({
                data: {
                    sessionId: ghost.id, exerciseId, setNumber: 1,
                    weightKg: 60, reps: 10, createdAt: lastSetAt,
                },
            });

            const next = await workoutService.startWorkout(userId, routineId);

            expect(next.id).not.toBe(ghost.id);
            expect(next.finishedAt).toBeNull();
            // Timer must start from now, not from the ghost's startedAt
            expect(Date.now() - next.startedAt.getTime()).toBeLessThan(60 * 1000);

            // The ghost is closed at its last real activity, not at "now"
            // (closing at now would fabricate a 26-hour workout in history)
            const closed = await prisma.workoutSession.findUnique({ where: { id: ghost.id } });
            expect(closed!.finishedAt?.toISOString()).toBe(lastSetAt.toISOString());
            expect(closed!.notes).toBe('Auto-closed: abandoned session');
        });

        it('keeps a note the user left on the abandoned session it closes', async () => {
            const staleStart = new Date(Date.now() - 26 * 60 * 60 * 1000);
            const lastSetAt = new Date(Date.now() - 25 * 60 * 60 * 1000);
            const ghost = await prisma.workoutSession.create({
                data: {
                    userId, routineId, startedAt: staleStart, finishedAt: null,
                    notes: 'shoulder hurt, stopped early',
                },
            });
            await prisma.workoutSet.create({
                data: {
                    sessionId: ghost.id, exerciseId, setNumber: 1,
                    weightKg: 60, reps: 10, createdAt: lastSetAt,
                },
            });

            await workoutService.startWorkout(userId, routineId);

            // This close runs the same COALESCE path as the step-5 close: the marker
            // is only applied when `notes` is still empty at write time. Reading the
            // value and writing it back would work here too — but not when the note
            // lands after the read, which is why neither site does that any more.
            const closed = await prisma.workoutSession.findUnique({ where: { id: ghost.id } });
            expect(closed!.finishedAt?.toISOString()).toBe(lastSetAt.toISOString());
            expect(closed!.notes).toBe('shoulder hurt, stopped early');
        });

        it('deletes a stale open session with no sets instead of resuming it', async () => {
            const ghost = await prisma.workoutSession.create({
                data: {
                    userId, routineId,
                    startedAt: new Date(Date.now() - 48 * 60 * 60 * 1000),
                    finishedAt: null,
                },
            });

            const next = await workoutService.startWorkout(userId, routineId);

            expect(next.id).not.toBe(ghost.id);
            const gone = await prisma.workoutSession.findUnique({ where: { id: ghost.id } });
            expect(gone).toBeNull();
        });

        it('does not report a session older than the resume window as the active one', async () => {
            await prisma.workoutSession.create({
                data: {
                    userId, routineId,
                    startedAt: new Date(Date.now() - 26 * 60 * 60 * 1000),
                    finishedAt: null,
                },
            });

            // The ACTIVE_SESSION_WINDOW_MS contract at the top of the service: a
            // session this old is invisible here AND never resumed by startWorkout.
            // Both must share the window or stale sessions become resumable ghosts
            // and the timer shows hundreds of hours. Deleting the startedAt filter
            // from this read used to leave the entire suite green.
            expect(await workoutService.getActiveWorkout(userId)).toBeNull();
        });

        it('never resumes a stale free session when starting a free workout', async () => {
            const ghost = await prisma.workoutSession.create({
                data: {
                    userId,
                    startedAt: new Date(Date.now() - 30 * 60 * 60 * 1000),
                    finishedAt: null,
                },
            });

            const next = await workoutService.startWorkout(userId);

            expect(next.id).not.toBe(ghost.id);
            expect(Date.now() - next.startedAt.getTime()).toBeLessThan(60 * 1000);
        });
    });

    describe('concurrent starts', () => {
        beforeEach(closeAllOpenSessions);

        it('two simultaneous starts converge on a single open session', async () => {
            const results = await Promise.all(
                Array.from({ length: 4 }, () => workoutService.startWorkout(userId, routineId))
            );

            const uniqueIds = new Set(results.map(s => s.id));
            expect(uniqueIds.size).toBe(1);

            const openCount = await prisma.workoutSession.count({
                where: { userId, finishedAt: null },
            });
            expect(openCount).toBe(1);
        });

        it('converges on the open session when the retry budget is spent, never raising P2002', async () => {
            const winner = await workoutService.startWorkout(userId, routineId);
            const countBefore = await prisma.workoutSession.count({ where: { userId } });

            // Blind the resume check of BOTH the first attempt and its retry, so
            // every create runs into the partial index the winner holds and the
            // single retry is spent. Only resume-shaped reads are blinded and only
            // twice: the convergence lookup that follows uses the same shape and
            // must see the real row. Everything else runs unmocked.
            const realFindFirst = prisma.workoutSession.findFirst.bind(prisma.workoutSession);
            let blinded = 0;
            const findFirstSpy = vi
                .spyOn(prisma.workoutSession, 'findFirst')
                .mockImplementation((async (args: Prisma.WorkoutSessionFindFirstArgs) => {
                    const where = args?.where ?? {};
                    const isResumeCheck = where.finishedAt === null && where.startedAt != null;
                    if (isResumeCheck && blinded < 2) {
                        blinded++;
                        return null;
                    }
                    return await realFindFirst(args);
                }) as unknown as typeof prisma.workoutSession.findFirst);

            // createSessionWithPlan is the only $transaction user on this path, so
            // this counts REAL create attempts. Observed, never stubbed. This is
            // what pins the test to the retry-exhaustion path — `blinded` alone
            // cannot, because it counts how often the mock fired, not which call
            // sites it hit. Any new resume-shaped read added upstream would eat the
            // blind budget and silently downgrade this to the ordinary resume path
            // while `blinded === 2` still held.
            const transactionSpy = vi.spyOn(prisma, '$transaction');

            let transactionCalls = -1;
            let result: Awaited<ReturnType<typeof workoutService.startWorkout>> | undefined;
            try {
                result = await workoutService.startWorkout(userId, routineId);
            } finally {
                // mockRestore() wipes call history, so snapshot it first.
                transactionCalls = transactionSpy.mock.calls.length;
                findFirstSpy.mockRestore();
                transactionSpy.mockRestore();
            }

            // Two creates attempted and two rejected by the index: the first
            // attempt and its single retry. Anything less and the retry budget was
            // never spent, so this would not be the branch under test.
            expect(transactionCalls).toBe(2);
            expect(blinded).toBe(2);

            // Letting the P2002 escape here is an HTTP 500 for a user who just
            // tapped "start" while their own session was being created.
            expect(result!.id).toBe(winner.id);

            // Re-read from the database. Asserting `result.finishedAt` is null
            // proves nothing: `result` comes from a query whose WHERE already
            // contains `finishedAt: null`, so the value cannot be anything else.
            const winnerRow = await prisma.workoutSession.findUnique({ where: { id: winner.id } });
            expect(winnerRow!.finishedAt).toBeNull();

            // Both aborted creates rolled back; no third session was spawned.
            const countAfter = await prisma.workoutSession.count({ where: { userId } });
            expect(countAfter).toBe(countBefore);
            const openCount = await prisma.workoutSession.count({ where: { userId, finishedAt: null } });
            expect(openCount).toBe(1);
        });

        it('surfaces the conflict, not the lookup failure, when the convergence read throws', async () => {
            await workoutService.startWorkout(userId, routineId);

            const realFindFirst = prisma.workoutSession.findFirst.bind(prisma.workoutSession);
            let resumeReads = 0;
            const findFirstSpy = vi
                .spyOn(prisma.workoutSession, 'findFirst')
                .mockImplementation((async (args: Prisma.WorkoutSessionFindFirstArgs) => {
                    const where = args?.where ?? {};
                    const isResumeCheck = where.finishedAt === null && where.startedAt != null;
                    if (isResumeCheck) {
                        resumeReads++;
                        // Reads 1 and 2 are the two attempts' resume checks; read 3
                        // is the convergence lookup, which fails here as a pool
                        // timeout right after a conflict burst would.
                        if (resumeReads <= 2) return null;
                        throw new Error('CONNECTION_POOL_TIMEOUT');
                    }
                    return await realFindFirst(args);
                }) as unknown as typeof prisma.workoutSession.findFirst);

            const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

            let raised: unknown;
            let loggedCount = -1;
            try {
                await workoutService.startWorkout(userId, routineId);
            } catch (error) {
                raised = error;
            } finally {
                // mockRestore() wipes call history, so snapshot it first.
                loggedCount = errorSpy.mock.calls.length;
                findFirstSpy.mockRestore();
                errorSpy.mockRestore();
            }

            expect(resumeReads).toBe(3);

            // The conflict is what actually happened. A failed lookup is not
            // evidence about it, so it must not replace it as the raised error.
            expect(isOpenSessionConflict(raised)).toBe(true);
            expect((raised as Error).message).not.toContain('CONNECTION_POOL_TIMEOUT');

            // ...but it must not vanish either.
            expect(loggedCount).toBeGreaterThan(0);
        });

        it('anchors the convergence to the same cutoff as the resume check', async () => {
            // A holder that sits just INSIDE the 24h window at the instant this
            // invocation starts. If the convergence recomputes its own cutoff rather
            // than sharing the invocation's, the time that passes while the two
            // contended creates fail pushes the holder outside THAT cutoff: the
            // convergence finds nothing and the P2002 escapes as a 500. In
            // production the drift is milliseconds, so the clock offset below is
            // what makes the difference observable at all.
            // Only Date.now() is offset — Prisma writes timestamps via `new Date()`,
            // so stored values stay on the real clock.
            const winner = await prisma.workoutSession.create({
                data: {
                    userId, routineId,
                    startedAt: new Date(Date.now() - (24 * 60 * 60 * 1000 - 5000)),
                    finishedAt: null,
                },
            });

            const realNow = Date.now;
            let offsetMs = 0;
            const nowSpy = vi.spyOn(Date, 'now').mockImplementation(() => realNow() + offsetMs);

            const realFindFirst = prisma.workoutSession.findFirst.bind(prisma.workoutSession);
            let blinded = 0;
            const findFirstSpy = vi
                .spyOn(prisma.workoutSession, 'findFirst')
                .mockImplementation((async (args: Prisma.WorkoutSessionFindFirstArgs) => {
                    const where = args?.where ?? {};
                    const isResumeCheck = where.finishedAt === null && where.startedAt != null;
                    if (isResumeCheck && blinded < 2) {
                        blinded++;
                        // Both attempts have now read blind; let the clock move on
                        // before the convergence, as contention would.
                        if (blinded === 2) offsetMs = 10_000;
                        return null;
                    }
                    return await realFindFirst(args);
                }) as unknown as typeof prisma.workoutSession.findFirst);

            let result: Awaited<ReturnType<typeof workoutService.startWorkout>> | undefined;
            try {
                result = await workoutService.startWorkout(userId, routineId);
            } finally {
                findFirstSpy.mockRestore();
                nowSpy.mockRestore();
            }

            expect(blinded).toBe(2);
            // The holder was resumable when this invocation began, so it is still
            // the answer when the invocation converges.
            expect(result!.id).toBe(winner.id);
        });

        it('refuses to converge on a holder that belongs to a different routine', async () => {
            const otherRoutine = await prisma.routine.create({
                data: { name: 'Switch Routine (convergence)', userId },
            });
            const otherDay = await prisma.routineDay.create({
                data: { routineId: otherRoutine.id, name: 'Day 1', order: 0 },
            });

            const winner = await workoutService.startWorkout(userId, routineId);

            const realFindFirst = prisma.workoutSession.findFirst.bind(prisma.workoutSession);
            let blinded = 0;
            const findFirstSpy = vi
                .spyOn(prisma.workoutSession, 'findFirst')
                .mockImplementation((async (args: Prisma.WorkoutSessionFindFirstArgs) => {
                    const where = args?.where ?? {};
                    const isResumeCheck = where.finishedAt === null && where.startedAt != null;
                    if (isResumeCheck && blinded < 2) {
                        blinded++;
                        return null;
                    }
                    return await realFindFirst(args);
                }) as unknown as typeof prisma.workoutSession.findFirst);

            const transactionSpy = vi.spyOn(prisma, '$transaction');
            let transactionCalls = -1;
            let raised: unknown;
            try {
                await workoutService.startWorkout(
                    userId, otherRoutine.id, undefined, otherDay.id
                );
            } catch (error) {
                raised = error;
            } finally {
                transactionCalls = transactionSpy.mock.calls.length;
                findFirstSpy.mockRestore();
                transactionSpy.mockRestore();
            }

            expect(transactionCalls).toBe(2);
            expect(blinded).toBe(2);

            // The caller asked for `otherRoutine` AND a routineDayId validated
            // against it. Handing back the holder's session for a different routine
            // would answer 201 with someone else's workout and silently drop that
            // day — a failure disguised as success. It fails instead, with a message
            // the route maps to 409 so the client can retry the switch.
            expect((raised as Error | undefined)?.message).toBe('START_ROUTINE_CONFLICT');

            // The holder is left untouched and still open.
            const winnerRow = await prisma.workoutSession.findUnique({ where: { id: winner.id } });
            expect(winnerRow!.finishedAt).toBeNull();
            expect(winnerRow!.routineId).toBe(routineId);
        });

        // meta shape empirically probed: a violation of the raw-SQL partial index
        // WorkoutSession_one_open_per_user surfaces as P2002 with
        // { modelName: 'WorkoutSession', target: ['userId'] }
        it('retries only on the one-open-session index, not on other P2002s', () => {
            const makeP2002 = (meta: Record<string, unknown>) =>
                new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
                    code: 'P2002',
                    clientVersion: Prisma.prismaVersion.client,
                    meta,
                });

            expect(isOpenSessionConflict(
                makeP2002({ modelName: 'WorkoutSession', target: ['userId'] })
            )).toBe(true);

            expect(isOpenSessionConflict(
                makeP2002({ modelName: 'WorkoutSessionExercise', target: ['sessionId', 'exerciseId'] })
            )).toBe(false);

            expect(isOpenSessionConflict(new Error('anything else'))).toBe(false);
        });
    });

    // Serialized simulations of two interleavings in which step 2's resume read is
    // already stale by the time execution moves past it. Neither is a real
    // concurrency test: the read is intercepted so the world can be shifted at
    // exactly the point a competing start would have shifted it.
    // The two are NOT the same setup, and the difference decides what they cover:
    //   - the first FABRICATES the read (returns null) to make step 2 blind. That
    //     leaves `activeSession` null, so the step-5 close never runs at all; the
    //     test exercises the create / P2002 / retry path.
    //   - the second performs the REAL read and only then moves the world on, so
    //     `activeSession` is a genuine row and step 5 does write.
    // In both, the writes and the partial unique index are real.
    describe('stale resume read', () => {
        beforeEach(closeAllOpenSessions);

        it('resumes the winner instead of closing it when the resume check missed it', async () => {
            const first = await workoutService.startWorkout(userId, routineId);
            const countBefore = await prisma.workoutSession.count({ where: { userId } });

            // Intercept step 2 only: return null as if `first` did not exist yet,
            // and keep its `where` so the test can prove the mock landed there.
            let interceptedWhere: Prisma.WorkoutSessionWhereInput | undefined;
            // The cast is only needed because the delegate returns a Prisma client
            // thenable rather than a bare Promise; the argument stays fully typed,
            // which is what the assertions below read.
            const findFirstSpy = vi
                .spyOn(prisma.workoutSession, 'findFirst')
                .mockImplementationOnce(((args: Prisma.WorkoutSessionFindFirstArgs) => {
                    interceptedWhere = args.where;
                    return Promise.resolve(null);
                }) as unknown as typeof prisma.workoutSession.findFirst);

            // createSessionWithPlan is the only $transaction user on this path, so
            // this counts create attempts. Observed, never stubbed.
            const transactionSpy = vi.spyOn(prisma, '$transaction');

            let transactionCalls = -1;
            let second: Awaited<ReturnType<typeof workoutService.startWorkout>> | undefined;
            try {
                second = await workoutService.startWorkout(userId, routineId);
            } finally {
                // mockRestore() wipes call history, so snapshot it first.
                transactionCalls = transactionSpy.mock.calls.length;
                findFirstSpy.mockRestore();
                transactionSpy.mockRestore();
            }

            // The mock must have landed on step 2's resume check, not on some other
            // findFirst. Without this the test would pass on the plain resume path.
            expect(interceptedWhere).toBeDefined();
            expect(interceptedWhere!.finishedAt).toBeNull();
            const startedAtFilter = interceptedWhere!.startedAt as Prisma.DateTimeFilter;
            expect(startedAtFilter.gte).toBeInstanceOf(Date);

            // The create was really attempted and really rejected by the partial
            // index; the retry then resolved without a second create. The plain
            // resume path calls $transaction zero times.
            expect(transactionCalls).toBe(1);

            expect(second!.id).toBe(first.id);

            const firstRow = await prisma.workoutSession.findUnique({ where: { id: first.id } });
            expect(firstRow?.finishedAt).toBeNull();

            // The aborted create must not have left a row behind.
            const countAfter = await prisma.workoutSession.count({ where: { userId } });
            expect(countAfter).toBe(countBefore);

            const openCount = await prisma.workoutSession.count({ where: { userId, finishedAt: null } });
            expect(openCount).toBe(1);
        });

        it('closes only the session it observed, never one created after that read', async () => {
            const otherRoutine = await prisma.routine.create({
                data: { name: 'Switch Routine (close scope)', userId },
            });

            // Setup: the live session on `routineId`. The start under test below
            // requests `otherRoutine`, and that mismatch is the only way execution
            // reaches the close at step 5.
            const observed = await workoutService.startWorkout(userId, routineId);

            // Bind the real delegate before spying so the interception can still
            // perform the genuine read instead of inventing a row.
            const realFindFirst = prisma.workoutSession.findFirst.bind(prisma.workoutSession);

            let interceptedWhere: Prisma.WorkoutSessionWhereInput | undefined;
            let winnerId: string | undefined;
            let observedClosedAt: Date | null = null;

            // Step 2 reads a snapshot. Hand back the row it really read, then move
            // the world on exactly as a competing start would have: the observed
            // session is finished and a different one is created and left open.
            // From here the caller runs against a read that no longer reflects the
            // database — which is the whole production race, made deterministic.
            const findFirstSpy = vi
                .spyOn(prisma.workoutSession, 'findFirst')
                .mockImplementationOnce((async (args: Prisma.WorkoutSessionFindFirstArgs) => {
                    interceptedWhere = args.where;
                    const row = await realFindFirst(args);

                    await prisma.workoutSession.updateMany({
                        where: { id: observed.id, finishedAt: null },
                        data: { finishedAt: new Date() },
                    });
                    // Read back what the database actually stored, so the assertion
                    // below compares against a real column value rather than a JS
                    // Date that may not survive the round trip identically.
                    const closedRow = await prisma.workoutSession.findUnique({
                        where: { id: observed.id },
                    });
                    observedClosedAt = closedRow!.finishedAt;

                    const winner = await prisma.workoutSession.create({
                        data: {
                            userId, routineId: otherRoutine.id,
                            startedAt: new Date(), finishedAt: null,
                        },
                    });
                    winnerId = winner.id;

                    return row;
                }) as unknown as typeof prisma.workoutSession.findFirst);

            let result: Awaited<ReturnType<typeof workoutService.startWorkout>> | undefined;
            try {
                result = await workoutService.startWorkout(userId, otherRoutine.id);
            } finally {
                findFirstSpy.mockRestore();
            }

            // The interception must have landed on step 2's resume check, and the
            // row it returned must be the one the close is expected to scope to.
            expect(interceptedWhere).toBeDefined();
            expect(interceptedWhere!.finishedAt).toBeNull();
            expect((interceptedWhere!.startedAt as Prisma.DateTimeFilter).gte).toBeInstanceOf(Date);
            expect(winnerId).toBeDefined();
            expect(winnerId).not.toBe(observed.id);

            // THE CLAIM OF THIS BRANCH. The close targets the id step 2 observed,
            // so an already-closed target makes it a no-op. A blanket
            // `where: { userId, finishedAt: null }` matches the winner instead —
            // a session this caller never saw — and closes it underneath whoever
            // holds it, which is the ghost-timer bug.
            const winnerRow = await prisma.workoutSession.findUnique({ where: { id: winnerId! } });
            expect(winnerRow!.finishedAt).toBeNull();

            // The close also carries `finishedAt IS NULL`, which is what makes an
            // already-closed target a no-op rather than an overwrite. Drop that
            // predicate and the session the user genuinely finished at 10:00 gets
            // its timestamp silently rewritten to the auto-close time on their next
            // start — corrupted duration and history, the exact damage this file
            // exists to prevent.
            expect(observedClosedAt).toBeInstanceOf(Date);
            const observedRow = await prisma.workoutSession.findUnique({ where: { id: observed.id } });
            expect(observedRow!.finishedAt?.toISOString()).toBe(observedClosedAt!.toISOString());
            // The same predicate is what stops COALESCE from stamping the marker
            // onto a row that was already closed without one.
            expect(observedRow!.notes).toBeNull();

            // With the winner left alone the create hits the partial index, and the
            // retry resolves onto it rather than spawning a third session.
            expect(result!.id).toBe(winnerId);
            const stillOpen = await prisma.workoutSession.count({ where: { userId, finishedAt: null } });
            expect(stillOpen).toBe(1);
        });
    });

    describe('routine switch', () => {
        beforeEach(closeAllOpenSessions);

        it('preserves user-authored notes on the session it auto-closes', async () => {
            const otherRoutine = await prisma.routine.create({
                data: { name: 'Switch Routine (notes)', userId },
            });

            const live = await workoutService.startWorkout(userId, routineId);
            // A zero-set session is DELETED, not closed (see 'deletes an empty open
            // session instead of auto-closing it', below); this guarantee is about a
            // close that carries a note forward, so it needs a set to take that path.
            await prisma.workoutSet.create({
                data: { sessionId: live.id, exerciseId, setNumber: 1, weightKg: 60, reps: 10 },
            });
            await prisma.workoutSession.update({
                where: { id: live.id },
                data: { notes: 'felt strong, bumped the top set' },
            });

            const switched = await workoutService.startWorkout(userId, otherRoutine.id);
            expect(switched.id).not.toBe(live.id);

            const closed = await prisma.workoutSession.findUnique({ where: { id: live.id } });
            expect(closed!.finishedAt).not.toBeNull();
            expect(closed!.notes).toBe('felt strong, bumped the top set');
        });

        it('does not overwrite a note written after the resume read', async () => {
            const otherRoutine = await prisma.routine.create({
                data: { name: 'Switch Routine (late note)', userId },
            });

            const live = await workoutService.startWorkout(userId, routineId);
            expect(live.notes).toBeNull();

            // A zero-set session is DELETED, not closed (see 'deletes an empty open
            // session instead of auto-closing it', below); this guarantee is about a
            // close that must not overwrite a late note, so it needs a set to take
            // that path.
            await prisma.workoutSet.create({
                data: { sessionId: live.id, exerciseId, setNumber: 1, weightKg: 60, reps: 10 },
            });

            // Step 2 reads notes = null; the user writes one before step 5 closes
            // the session. A close that carries the value read at step 2 back into
            // the write stamps the system marker over that note — a lost update.
            // Deciding `notes IS NULL` in the WHERE instead reads it at write time.
            const realFindFirst = prisma.workoutSession.findFirst.bind(prisma.workoutSession);
            const findFirstSpy = vi
                .spyOn(prisma.workoutSession, 'findFirst')
                .mockImplementationOnce((async (args: Prisma.WorkoutSessionFindFirstArgs) => {
                    const row = await realFindFirst(args);
                    await prisma.workoutSession.update({
                        where: { id: live.id },
                        data: { notes: 'last set felt heavy' },
                    });
                    return row;
                }) as unknown as typeof prisma.workoutSession.findFirst);

            try {
                await workoutService.startWorkout(userId, otherRoutine.id);
            } finally {
                findFirstSpy.mockRestore();
            }

            const closed = await prisma.workoutSession.findUnique({ where: { id: live.id } });
            expect(closed!.finishedAt).not.toBeNull();
            expect(closed!.notes).toBe('last set felt heavy');
        });

        it('stamps the auto-close marker when the session carries no note', async () => {
            const otherRoutine = await prisma.routine.create({
                data: { name: 'Switch Routine (marker)', userId },
            });

            const live = await workoutService.startWorkout(userId, routineId);
            expect(live.notes).toBeNull();

            // A zero-set session is DELETED, not closed (see 'deletes an empty open
            // session instead of auto-closing it', below), so this test needs at
            // least one set to take the close path the marker guarantee is about.
            // The exact finish timestamp is a different guarantee, pinned by
            // 'closes at the true max set createdAt...' above — this test only
            // needs to prove the marker itself lands.
            await prisma.workoutSet.create({
                data: { sessionId: live.id, exerciseId, setNumber: 1, weightKg: 60, reps: 10 },
            });

            await workoutService.startWorkout(userId, otherRoutine.id);

            const closed = await prisma.workoutSession.findUnique({ where: { id: live.id } });
            expect(closed!.notes).toBe('Auto-closed to prevent duplication');
            expect(closed!.finishedAt).not.toBeNull();
        });

        it('does not close the live session when the requested routine day is rejected', async () => {
            const otherRoutine = await prisma.routine.create({
                data: { name: 'Switch Routine (mismatch)', userId },
            });

            const live = await workoutService.startWorkout(userId, routineId);
            await workoutService.addWorkoutSet(live.id, userId, {
                exerciseId, setNumber: 1, weightKg: 70, reps: 8,
            });
            await prisma.workoutSession.update({
                where: { id: live.id },
                data: { notes: 'in the middle of this one' },
            });

            // Well-formed uuid that is not a day of `otherRoutine`.
            const foreignDayId = '00000000-0000-4000-8000-000000000000';
            await expect(
                workoutService.startWorkout(userId, otherRoutine.id, undefined, foreignDayId)
            ).rejects.toThrow('ROUTINE_DAY_MISMATCH');

            // A 400 must not cost the user their live workout.
            const stillLive = await prisma.workoutSession.findUnique({ where: { id: live.id } });
            expect(stillLive!.finishedAt).toBeNull();
            expect(stillLive!.notes).toBe('in the middle of this one');
        });

        it('closes at the true max set createdAt, not by array position (interleaved setNumbers break naive positional fixes)', async () => {
            const otherRoutine = await prisma.routine.create({
                data: { name: 'Switch Routine (max set time)', userId },
            });

            const live = await workoutService.startWorkout(userId, routineId);

            // Four sets on ONE exercise with DISTINCT setNumbers (1..4), so
            // `orderBy: { setNumber: 'asc' }` is fully deterministic -- no Postgres
            // tie-break ambiguity. `createdAt` is deliberately NOT monotonic with
            // `setNumber`, so the true max sits at an interior array index, never
            // sets[0] nor sets[sets.length - 1]. Both naive positional "fixes" -- take
            // the first element, take the last element -- are therefore provably wrong
            // if the code under test uses either instead of the real max by time.
            const t1 = new Date(Date.now() - 3 * 60 * 60 * 1000); // setNumber 1
            const t2 = new Date(Date.now() - 1 * 60 * 60 * 1000); // setNumber 2 -- the max
            const t3 = new Date(Date.now() - 2 * 60 * 60 * 1000); // setNumber 3
            const t4 = new Date(Date.now() - 2.5 * 60 * 60 * 1000); // setNumber 4

            await prisma.workoutSet.create({
                data: { sessionId: live.id, exerciseId, setNumber: 1, weightKg: 60, reps: 10, createdAt: t1 },
            });
            await prisma.workoutSet.create({
                data: { sessionId: live.id, exerciseId, setNumber: 2, weightKg: 60, reps: 10, createdAt: t2 },
            });
            await prisma.workoutSet.create({
                data: { sessionId: live.id, exerciseId, setNumber: 3, weightKg: 60, reps: 10, createdAt: t3 },
            });
            await prisma.workoutSet.create({
                data: { sessionId: live.id, exerciseId, setNumber: 4, weightKg: 60, reps: 10, createdAt: t4 },
            });

            // Prove the fixture actually has the property this test depends on, via
            // the exact read path startWorkout's step 5 uses (findResumableSession,
            // exposed here through getActiveWorkout). If this fails, the FIXTURE is
            // wrong -- fix it, not this assertion.
            const activeBeforeSwitch = await workoutService.getActiveWorkout(userId);
            expect(activeBeforeSwitch!.id).toBe(live.id);
            const sets = activeBeforeSwitch!.sets;
            expect(sets).toHaveLength(4);
            const maxCreatedAtMs = Math.max(...sets.map(s => s.createdAt.getTime()));
            expect(sets[0]!.createdAt.getTime()).toBeLessThan(maxCreatedAtMs);
            expect(sets[sets.length - 1]!.createdAt.getTime()).toBeLessThan(maxCreatedAtMs);
            expect(maxCreatedAtMs).toBe(t2.getTime());

            // Backdate startedAt well inside the resume window, far enough from `now`
            // that a close using `new Date()` cannot be confused with a close using
            // the max set's createdAt.
            const startedAt = new Date(Date.now() - 4 * 60 * 60 * 1000);
            await prisma.workoutSession.update({
                where: { id: live.id },
                data: { startedAt },
            });

            await workoutService.startWorkout(userId, otherRoutine.id);

            const closed = await prisma.workoutSession.findUnique({ where: { id: live.id } });
            expect(closed!.finishedAt).not.toBeNull();
            expect(closed!.finishedAt!.toISOString()).toBe(new Date(maxCreatedAtMs).toISOString());
        });

        it('deletes an empty open session instead of auto-closing it', async () => {
            const otherRoutine = await prisma.routine.create({
                data: { name: 'Switch Routine (empty deletion)', userId },
            });

            const live = await workoutService.startWorkout(userId, routineId);
            expect(live.finishedAt).toBeNull();

            // Backdate well inside the resume window, matching the sibling tests'
            // style in this block.
            const startedAt = new Date(Date.now() - 2 * 60 * 60 * 1000);
            await prisma.workoutSession.update({
                where: { id: live.id },
                data: { startedAt },
            });

            const switched = await workoutService.startWorkout(userId, otherRoutine.id);

            // The empty session must be GONE, not closed-with-a-marker: an auto-close
            // with zero sets has no training data and no finish time to preserve.
            const gone = await prisma.workoutSession.findUnique({ where: { id: live.id } });
            expect(gone).toBeNull();

            // The switch itself must still have succeeded, or this test could pass by
            // everything blowing up instead of proving the deletion.
            expect(switched.id).not.toBe(live.id);
            expect(switched.finishedAt).toBeNull();
            const stillOpen = await prisma.workoutSession.findUnique({ where: { id: switched.id } });
            expect(stillOpen).not.toBeNull();
            expect(stillOpen!.finishedAt).toBeNull();
        });

        // GUARANTEE G4: the empty-session delete is atomic. `activeSession.sets`
        // is a JS snapshot taken at step 2 — if a set lands for real on that exact
        // session between the read and step 5's `deleteMany`, the snapshot is
        // still empty but the row now holds real training data. The WHERE's
        // `sets: { none: {} }` re-check is what keeps the delete from matching
        // that row; drop it and this interleaving destroys a session with a
        // logged set in it. Same injection shape as `interceptGuardRead` below
        // (real read, then mutate the world, then return the real row) — this one
        // targets step 2's `findFirst`, not the `findUnique` guard reads.
        it('never deletes a session that gained a set between the resume read and the delete', async () => {
            const otherRoutine = await prisma.routine.create({
                data: { name: 'Switch Routine (race delete)', userId },
            });

            const live = await workoutService.startWorkout(userId, routineId);
            expect(live.finishedAt).toBeNull();

            // Backdate well inside the resume window, matching the sibling tests'
            // style in this block.
            const startedAt = new Date(Date.now() - 2 * 60 * 60 * 1000);
            await prisma.workoutSession.update({
                where: { id: live.id },
                data: { startedAt },
            });

            const realFindFirst = prisma.workoutSession.findFirst.bind(prisma.workoutSession);
            let interceptedWhere: Prisma.WorkoutSessionWhereInput | undefined;
            const findFirstSpy = vi
                .spyOn(prisma.workoutSession, 'findFirst')
                .mockImplementationOnce((async (args: Prisma.WorkoutSessionFindFirstArgs) => {
                    interceptedWhere = args.where;
                    const row = await realFindFirst(args);

                    // The interleaving under test: a set lands for real, on the
                    // exact session step 2 just read as empty, before step 5 acts
                    // on that (now stale) snapshot.
                    await prisma.workoutSet.create({
                        data: { sessionId: live.id, exerciseId, setNumber: 1, weightKg: 60, reps: 10 },
                    });

                    return row;
                }) as unknown as typeof prisma.workoutSession.findFirst);

            let findFirstCallsWhenDone = -1;
            try {
                await workoutService.startWorkout(userId, otherRoutine.id);
            } finally {
                // mockRestore() wipes call history, so snapshot it first.
                findFirstCallsWhenDone = findFirstSpy.mock.calls.length;
                findFirstSpy.mockRestore();
            }

            // The interception must have landed on step 2's resume check.
            expect(interceptedWhere).toBeDefined();
            expect(interceptedWhere!.finishedAt).toBeNull();
            expect((interceptedWhere!.startedAt as Prisma.DateTimeFilter).gte).toBeInstanceOf(Date);

            // THE CLAIM. `activeSession.sets` is a step-2 snapshot; the set that
            // landed during the window is real training data, and the delete's
            // WHERE must re-check for it at write time rather than trust the
            // snapshot the JS code is holding.
            const sessionRow = await prisma.workoutSession.findUnique({ where: { id: live.id } });
            expect(sessionRow).not.toBeNull();

            const setRow = await prisma.workoutSet.findFirst({ where: { sessionId: live.id } });
            expect(setRow).not.toBeNull();

            // The spy actually fired — guards this test against silently
            // degrading into a no-op if step 2's read shape ever changes.
            expect(findFirstCallsWhenDone).toBeGreaterThan(0);
        });

        // GUARANTEE G4 from its other side. The test above pins `sets: { none: {} }`,
        // which keeps the delete off a session that gained training data; this one
        // pins `finishedAt: null`, which keeps it off a session that stopped being
        // open. Step 5's authority to delete comes entirely from step 2 having
        // observed the row OPEN — once a concurrent Finalizar has closed it, it is
        // finished history belonging to the call that closed it, and this caller
        // never saw that state. The interleaving is one user on two devices: tap
        // Finalizar on the phone while the tablet starts a different routine.
        //
        // Written because the mutation review had to
        // declare this guard's only kill as low quality: it died solely through
        // 'closes only the session it observed, never one created after that read',
        // a concurrency test written for a different claim, and it died by CRASH
        // (TypeError: Cannot read properties of null) rather than by any assertion
        // about the guard. A crash in somebody else's test is not coverage — reshape
        // that test for any unrelated reason and the guard loses its only witness
        // with nothing going red. This one asserts the guarantee directly.
        it('never deletes a session that was finished between the resume read and the delete', async () => {
            const otherRoutine = await prisma.routine.create({
                data: { name: 'Switch Routine (race finish)', userId },
            });

            const live = await workoutService.startWorkout(userId, routineId);
            expect(live.finishedAt).toBeNull();
            // Zero sets on purpose: with a set logged, `sets: { none: {} }` already
            // blocks the delete and this test would pass without exercising
            // `finishedAt: null` at all. Empty is the only shape where this
            // predicate is the last thing standing between the row and deletion.
            const setsBefore = await prisma.workoutSet.count({ where: { sessionId: live.id } });
            expect(setsBefore).toBe(0);

            // Backdate well inside the resume window, matching the sibling tests'
            // style in this block.
            const startedAt = new Date(Date.now() - 2 * 60 * 60 * 1000);
            await prisma.workoutSession.update({
                where: { id: live.id },
                data: { startedAt },
            });

            const realFindFirst = prisma.workoutSession.findFirst.bind(prisma.workoutSession);
            let interceptedWhere: Prisma.WorkoutSessionWhereInput | undefined;
            let finishedInWindowAt: Date | null = null;
            const findFirstSpy = vi
                .spyOn(prisma.workoutSession, 'findFirst')
                .mockImplementationOnce((async (args: Prisma.WorkoutSessionFindFirstArgs) => {
                    interceptedWhere = args.where;
                    const row = await realFindFirst(args);

                    // A raw close, and the swap away from the real `finishWorkout` IS
                    // the finding. Finishing a session with zero sets now DISCARDS the
                    // row, so the production closer can no longer produce the state
                    // this guard defends against: finished AND empty. Nothing in the
                    // codebase can — the sweep and step 5 delete empty sessions, the
                    // shared helper is only reachable with sets, and PATCH /workouts/:id
                    // cannot write `finishedAt` (its schema carries `notes` and
                    // `routineId` only). The predicate stays because it costs nothing
                    // and any future writer that closes without deleting would need it,
                    // so the test pins it DIRECTLY rather than through a path that
                    // stopped leading here. Read back from the stored column rather
                    // than trusting a JS Date to survive the round trip identically.
                    const closedRow = await prisma.workoutSession.update({
                        where: { id: live.id },
                        data: { finishedAt: new Date() },
                    });
                    finishedInWindowAt = closedRow.finishedAt;

                    return row;
                }) as unknown as typeof prisma.workoutSession.findFirst);

            let findFirstCallsWhenDone = -1;
            try {
                await workoutService.startWorkout(userId, otherRoutine.id);
            } finally {
                // mockRestore() wipes call history, so snapshot it first.
                findFirstCallsWhenDone = findFirstSpy.mock.calls.length;
                findFirstSpy.mockRestore();
            }

            // The interception must have landed on step 2's resume check, or the
            // window under test was never opened.
            expect(interceptedWhere).toBeDefined();
            expect(interceptedWhere!.finishedAt).toBeNull();
            expect((interceptedWhere!.startedAt as Prisma.DateTimeFilter).gte).toBeInstanceOf(Date);
            // ...and the injected finish must have actually landed.
            expect(finishedInWindowAt).toBeInstanceOf(Date);

            // THE CLAIM. `activeSession` is a step-2 snapshot that still reads
            // open; the row is finished by write time, and the delete's WHERE has
            // to re-check that rather than act on the snapshot. Without the
            // predicate the workout the user just finished is destroyed — and
            // WorkoutSet.session is onDelete: Cascade, so the same delete would
            // take any set landing alongside the finish with it.
            const sessionRow = await prisma.workoutSession.findUnique({ where: { id: live.id } });
            expect(sessionRow).not.toBeNull();

            // Untouched, not merely alive: the timestamp the user's finish stored
            // has to survive, and the auto-close branch must not have run either —
            // it would have stamped its marker onto a row with no note.
            expect(sessionRow!.finishedAt?.toISOString()).toBe(finishedInWindowAt!.toISOString());
            expect(sessionRow!.notes).toBeNull();

            // The spy actually fired — guards this test against silently
            // degrading into a no-op if step 2's read shape ever changes.
            expect(findFirstCallsWhenDone).toBeGreaterThan(0);
        });
    });

    // Step 5's
    // close used to commit on its own before createSessionWithPlan ran, so any
    // create failure that is NOT the open-session P2002 — bad routine data, a
    // transient outage, a P2028 — left the user with no session at all: the
    // observed one was already closed (or DELETED, since PR #20, when it had no
    // sets) and the new one was never born.
    //
    // The failure injected here is real and mock-free: a routine day carrying the
    // same exercise twice. RoutineExercise has no unique on (dayId, exerciseId),
    // so the shape is representable in the database (the route-level Zod refine
    // rejecting it arrived later than the tables), and isOpenSessionConflict's
    // own comment names it — "bad routine data" — as the canonical P2002 that
    // must NOT be retried. The snapshot loop then violates
    // WorkoutSessionExercise.sessionId_exerciseId AFTER the session row is
    // created, deterministically, inside the create transaction.
    describe('close-and-create atomicity', () => {
        beforeEach(closeAllOpenSessions);

        // The single day carries the same exercise twice, which makes
        // createSessionWithPlan fail with P2002 on sessionId_exerciseId every
        // time this routine's day is started.
        const createRoutineWithDuplicateDay = async (name: string) => {
            const routine = await prisma.routine.create({ data: { name, userId } });
            const day = await prisma.routineDay.create({
                data: { routineId: routine.id, name: 'Dup day', order: 1 },
            });
            await prisma.routineExercise.create({
                data: { routineId: routine.id, dayId: day.id, exerciseId, order: 0 },
            });
            await prisma.routineExercise.create({
                data: { routineId: routine.id, dayId: day.id, exerciseId, order: 1 },
            });
            return { routine, day };
        };

        it('a failed create must not close the session it observed out from under the user', async () => {
            const { routine: dupRoutine, day: dupDay } =
                await createRoutineWithDuplicateDay('Switch Routine (atomicity, sets)');

            const live = await workoutService.startWorkout(userId, routineId);
            await prisma.workoutSet.create({
                data: { sessionId: live.id, exerciseId, setNumber: 1, weightKg: 60, reps: 10 },
            });
            await prisma.workoutSession.update({
                where: { id: live.id },
                data: { notes: 'mid-workout note' },
            });
            const countBefore = await prisma.workoutSession.count({ where: { userId } });

            let raised: unknown;
            try {
                await workoutService.startWorkout(userId, dupRoutine.id, undefined, dupDay.id);
            } catch (error) {
                raised = error;
            }

            // The failure must be the real snapshot-loop P2002 — the one
            // isOpenSessionConflict refuses to retry — or this test is not
            // exercising the interleaving it claims to.
            expect(raised).toBeInstanceOf(Prisma.PrismaClientKnownRequestError);
            expect((raised as Prisma.PrismaClientKnownRequestError).code).toBe('P2002');
            expect(isOpenSessionConflict(raised)).toBe(false);

            // THE CLAIM: the failed start must not have committed its close. The
            // session the user was training stays open, notes intact — a 500 on a
            // routine switch must not cost the workout they were switching from.
            const stillLive = await prisma.workoutSession.findUnique({ where: { id: live.id } });
            expect(stillLive).not.toBeNull();
            expect(stillLive!.finishedAt).toBeNull();
            expect(stillLive!.notes).toBe('mid-workout note');

            // Resumable through the real read path, not merely present as a row.
            const resumed = await workoutService.getActiveWorkout(userId);
            expect(resumed!.id).toBe(live.id);

            // And the aborted create left nothing behind.
            const countAfter = await prisma.workoutSession.count({ where: { userId } });
            expect(countAfter).toBe(countBefore);
        });

        it('a failed create must not delete the empty session it observed', async () => {
            const { routine: dupRoutine, day: dupDay } =
                await createRoutineWithDuplicateDay('Switch Routine (atomicity, empty)');

            const live = await workoutService.startWorkout(userId, routineId);
            // Zero sets on purpose: since PR #20 the empty branch DELETES rather
            // than closes, so a close that outlives a failed create does not leave
            // a wrong row behind here — it leaves NO row. There is nothing to
            // reopen and nothing in history; the startedAt (and any note) is gone.
            const setsBefore = await prisma.workoutSet.count({ where: { sessionId: live.id } });
            expect(setsBefore).toBe(0);

            let raised: unknown;
            try {
                await workoutService.startWorkout(userId, dupRoutine.id, undefined, dupDay.id);
            } catch (error) {
                raised = error;
            }

            expect(raised).toBeInstanceOf(Prisma.PrismaClientKnownRequestError);
            expect((raised as Prisma.PrismaClientKnownRequestError).code).toBe('P2002');
            expect(isOpenSessionConflict(raised)).toBe(false);

            // THE CLAIM: the delete must roll back with the create it was making
            // room for. The user keeps the session they had.
            const stillThere = await prisma.workoutSession.findUnique({ where: { id: live.id } });
            expect(stillThere).not.toBeNull();
            expect(stillThere!.finishedAt).toBeNull();

            const resumed = await workoutService.getActiveWorkout(userId);
            expect(resumed!.id).toBe(live.id);
        });
    });

    // GUARANTEE G5: `findResumableSession`'s `sets` are ordered for the UI to
    // render (`setNumber` ascending), not by when they were logged. Deliberately
    // independent of any timestamp reasoning: a session whose sets were CREATED
    // out of setNumber order must still come back in setNumber order. Three
    // call sites depend on this include (`getActiveWorkout`, startWorkout's step
    // 2, and the P2002 convergence read) — this pins the contract directly,
    // rather than through a coincidence of some other test's fixture.
    describe('resumed session set ordering', () => {
        beforeEach(closeAllOpenSessions);

        it('orders sets by setNumber for the UI, regardless of logging order', async () => {
            const session = await workoutService.startWorkout(userId, routineId);

            const t1 = new Date(Date.now() - 3000);
            const t2 = new Date(Date.now() - 2000);
            const t3 = new Date(Date.now() - 1000);

            // Logged out of setNumber order: 3rd, then 1st, then 2nd. createdAt
            // ascending would read [3, 1, 2]; descending would read [2, 1, 3].
            // Neither matches the assertion below, so a pass here cannot be
            // explained by either createdAt direction — only by setNumber.
            await prisma.workoutSet.create({
                data: { sessionId: session.id, exerciseId, setNumber: 3, weightKg: 60, reps: 10, createdAt: t1 },
            });
            await prisma.workoutSet.create({
                data: { sessionId: session.id, exerciseId, setNumber: 1, weightKg: 60, reps: 10, createdAt: t2 },
            });
            await prisma.workoutSet.create({
                data: { sessionId: session.id, exerciseId, setNumber: 2, weightKg: 60, reps: 10, createdAt: t3 },
            });

            const active = await workoutService.getActiveWorkout(userId);

            expect(active!.sets.map(s => s.setNumber)).toEqual([1, 2, 3]);
        });
    });

    // The one-open-session guarantee lives in raw SQL (partial unique indexes are
    // not expressible in schema.prisma), so nothing in the Prisma layer protects
    // it. `prisma migrate dev` is known to re-emit a spurious DROP INDEX for it.
    // Without the index startWorkout silently produces two open sessions.
    describe('database invariants', () => {
        // Exercised, not described. The replaced test read pg_indexes and asserted
        // the definition contained "UNIQUE" and "finishedAt". It did filter by index
        // name — but a UNIQUE ("userId", "finishedAt") created under that same name
        // satisfies both strings while permitting unlimited open sessions, because
        // Postgres treats NULLs as distinct. Only a real write separates those two,
        // and that write also covers a dropped index and a wrong column set.
        // A write cannot see a rename, so the name is still pinned separately.
        beforeEach(closeAllOpenSessions);

        it('rejects a second open session for the same user', async () => {
            await prisma.workoutSession.create({
                data: { userId, routineId, startedAt: new Date(), finishedAt: null },
            });

            let raised: unknown;
            try {
                await prisma.workoutSession.create({
                    data: { userId, routineId, startedAt: new Date(), finishedAt: null },
                });
            } catch (error) {
                raised = error;
            }

            expect(raised).toBeInstanceOf(Prisma.PrismaClientKnownRequestError);
            // startWorkout arms its retry on this exact error shape, so the
            // invariant and the code leaning on it are pinned by one assertion.
            expect(isOpenSessionConflict(raised)).toBe(true);

            const openCount = await prisma.workoutSession.count({
                where: { userId, finishedAt: null },
            });
            expect(openCount).toBe(1);

            // The complement — a second session IS allowed once the first is
            // finished — is what "creates a new session after today's session was
            // finished" covers; together they pin the WHERE clause from both sides.

            // The migration that creates this index is raw SQL, and `prisma migrate
            // dev` is known to re-emit a spurious DROP for it. A rename would leave
            // every assertion above green while breaking that migration contract.
            const named = await prisma.$queryRaw<Array<{ indexname: string }>>`
                SELECT indexname FROM pg_indexes
                WHERE schemaname = 'public'
                  AND tablename = 'WorkoutSession'
                  AND indexname = 'WorkoutSession_one_open_per_user'
            `;
            expect(named).toHaveLength(1);
        });
    });

    // A finished session is history. Accepting writes into one produces sets whose
    // createdAt is LATER than the session's finishedAt — rows that no reader can
    // interpret, and that silently change a past workout's contents. The route
    // comment already promised "record a set in an ACTIVE session"; these tests
    // make the code keep that promise.
    describe('writes to a closed session', () => {
        beforeEach(closeAllOpenSessions);

        // Distinguishing "gone" from "closed" is the point: a closed session is
        // found, so answering 404 would tell the client to stop retrying a resource
        // that exists. 409 says the state — not the identity — is the problem.
        it('rejects a set added to a finished session, and writes nothing', async () => {
            const session = await workoutService.startWorkout(userId, routineId);
            // A session that logged nothing is DISCARDED by finishWorkout, and a deleted
            // row answers SESSION_NOT_FOUND — a different guard than the one under test.
            // One logged set is what leaves a finished session to be refused.
            await prisma.workoutSet.create({
                data: { sessionId: session.id, exerciseId, setNumber: 1, weightKg: 60, reps: 10 },
            });
            await workoutService.finishWorkout(session.id, userId);

            await expect(
                workoutService.addWorkoutSet(session.id, userId, {
                    exerciseId,
                    setNumber: 2,
                    weightKg: 60,
                    reps: 8,
                })
            ).rejects.toThrow('SESSION_CLOSED');

            // Rejecting but persisting anyway would be the worst outcome: the caller
            // sees an error and the corrupt row lands regardless. One set is the fixture's
            // own; a second would be the rejected write landing.
            const sets = await prisma.workoutSet.count({ where: { sessionId: session.id } });
            expect(sets).toBe(1);
            const links = await prisma.workoutSessionExercise.count({ where: { sessionId: session.id } });
            expect(links).toBe(0);
        });

        it('rejects linking an exercise to a finished session', async () => {
            const session = await workoutService.startWorkout(userId, routineId);
            // Same reason as the sibling above: without a logged set the finish discards
            // the row and this would assert against SESSION_NOT_FOUND instead.
            await prisma.workoutSet.create({
                data: { sessionId: session.id, exerciseId, setNumber: 1, weightKg: 60, reps: 10 },
            });
            await workoutService.finishWorkout(session.id, userId);

            await expect(
                workoutService.linkExerciseToSession(session.id, userId, exerciseId)
            ).rejects.toThrow('SESSION_CLOSED');

            const links = await prisma.workoutSessionExercise.count({ where: { sessionId: session.id } });
            expect(links).toBe(0);
        });

        it('still accepts sets while the session is open', async () => {
            const session = await workoutService.startWorkout(userId, routineId);

            const set = await workoutService.addWorkoutSet(session.id, userId, {
                exerciseId,
                setNumber: 1,
                weightKg: 60,
                reps: 8,
            });

            // Without this the guard could reject everything and the two tests above
            // would still pass.
            expect(set.sessionId).toBe(session.id);
            expect(set.reps).toBe(8);
        });

        // Undoing a write is the fallback for a session that closes MID-CALL, not the
        // guard. A session already finished when the request arrived has to be refused
        // before anything is written: write-then-undo would touch two tables per rejected
        // request and publish the corrupt row to every concurrent reader for as long as it
        // took to notice. Both leave the same rows behind — zero — so nothing but the
        // attempt itself separates "never written" from "written and taken back".
        it('refuses a write into an already-finished session without attempting it', async () => {
            const session = await workoutService.startWorkout(userId, routineId);
            // Logged set: a discarded session would be refused by a different guard.
            await prisma.workoutSet.create({
                data: { sessionId: session.id, exerciseId, setNumber: 1, weightKg: 60, reps: 10 },
            });
            await workoutService.finishWorkout(session.id, userId);

            const linkWrite = vi.spyOn(prisma.workoutSessionExercise, 'upsert');
            const setWrite = vi.spyOn(prisma.workoutSet, 'upsert');

            try {
                await expect(
                    workoutService.addWorkoutSet(session.id, userId, {
                        exerciseId, setNumber: 1, weightKg: 60, reps: 8,
                    })
                ).rejects.toThrow('SESSION_CLOSED');

                await expect(
                    workoutService.linkExerciseToSession(session.id, userId, exerciseId)
                ).rejects.toThrow('SESSION_CLOSED');

                expect(linkWrite).not.toHaveBeenCalled();
                expect(setWrite).not.toHaveBeenCalled();
            } finally {
                linkWrite.mockRestore();
                setWrite.mockRestore();
            }
        });

        // A session belonging to somebody else must stay indistinguishable from one
        // that does not exist. Reporting SESSION_CLOSED for a stranger's finished
        // session would confirm the id is real to anyone enumerating uuids.
        it('reports a missing session as missing, not as closed', async () => {
            const other = await prisma.user.create({
                data: { email: `closed.guard.${Date.now()}@example.com`, password: 'password123' },
            });
            const foreign = await prisma.workoutSession.create({
                data: { userId: other.id, startedAt: new Date(), finishedAt: new Date() },
            });

            try {
                await expect(
                    workoutService.linkExerciseToSession(foreign.id, userId, exerciseId)
                ).rejects.toThrow('SESSION_NOT_FOUND');
            } finally {
                await prisma.workoutSession.delete({ where: { id: foreign.id } });
                await prisma.user.delete({ where: { id: other.id } });
            }
        });
    });

    // The guard above is decided in JS between round trips, so it knows only what the
    // read saw. A close landing after that read is invisible to it and the writes go
    // through regardless — the same hole `finishWorkout` had, one function over.
    //
    // What makes this one worse than a merely late write is the row it leaves behind.
    // The set is stored with a `createdAt` LATER than its own session's `finishedAt`,
    // and from that instant every route that could repair it refuses: `assertSetIsWritable`
    // answers 409 to both PATCH and DELETE /workouts/sets/:id exactly because the session
    // is finished. The user is told the set was saved, sees it in their history, and has
    // no request left that changes or removes it.
    //
    // Closing it means conditioning the write on the parent's state rather than checking
    // that state in JS — the idiom `closeSessionPreservingNotes` and `finishWorkout`
    // already use, and the reason their comments can promise a concurrent close is a
    // no-op instead of an overwrite.
    describe('addWorkoutSet under a concurrent close', () => {
        beforeEach(closeAllOpenSessions);

        it('refuses a set whose session closed after the guard read', async () => {
            const session = await workoutService.startWorkout(userId, routineId);

            // The guard read is served genuinely — the session really is open at that
            // instant — and only then is it finished, exactly as a concurrent
            // POST /workouts/:id/finish or a routine switch would finish it. Nothing
            // downstream is stubbed: the ordering count, both upserts and the foreign
            // keys are real, so whether the set lands is decided by the code under test
            // and not by the harness.
            const realFindUnique = prisma.workoutSession.findUnique.bind(prisma.workoutSession);
            let interceptedWhere: Prisma.WorkoutSessionWhereUniqueInput | undefined;
            const guardReadSpy = vi
                .spyOn(prisma.workoutSession, 'findUnique')
                .mockImplementationOnce((async (args: Prisma.WorkoutSessionFindUniqueArgs) => {
                    interceptedWhere = args.where;
                    const row = await realFindUnique(args);
                    await prisma.workoutSession.updateMany({
                        where: { id: session.id, userId, finishedAt: null },
                        data: { finishedAt: new Date() },
                    });
                    return row;
                }) as unknown as typeof prisma.workoutSession.findUnique);

            let raised: unknown;
            try {
                await workoutService.addWorkoutSet(session.id, userId, {
                    exerciseId, setNumber: 1, weightKg: 100, reps: 5,
                });
            } catch (error) {
                raised = error;
            } finally {
                guardReadSpy.mockRestore();
            }

            // Pin the call site before reading anything into the outcome. The
            // interception has to have landed on the ownership-and-state read inside
            // `linkExerciseToSession`, and the argument order has to be right:
            // `addWorkoutSet(sessionId, userId, ...)` called with the first two swapped
            // throws SESSION_NOT_FOUND, which reads like a correct rejection while
            // proving nothing about this window.
            expect(interceptedWhere).toEqual({ id: session.id, userId });

            // ...and the injected close has to have actually landed, or the
            // interleaving under test never happened. Declared, not hidden: the
            // harness hangs off that read, so a fix that keeps a read of this shape —
            // as `finishWorkout` did, since 404-vs-409 still needs one — keeps this
            // injection point; one that removes it entirely has to move the injection
            // to whatever statement decides the write.
            const closed = await prisma.workoutSession.findUnique({ where: { id: session.id } });
            expect(closed!.finishedAt).toBeInstanceOf(Date);

            expect((raised as Error | undefined)?.message).toBe('SESSION_CLOSED');

            // Writing anyway is the damage; the error is only how the caller hears
            // about it. Rejecting AND persisting would be the worst of both.
            const sets = await prisma.workoutSet.count({ where: { sessionId: session.id } });
            expect(sets).toBe(0);
            // Same window, same dead end: no route deletes a WorkoutSessionExercise
            // either, so a link left here is as permanent as the set.
            const links = await prisma.workoutSessionExercise.count({ where: { sessionId: session.id } });
            expect(links).toBe(0);
        });

        // Same injection as above, factored for the tests that follow: the guard read is
        // served genuinely and only then does the session change underneath the caller.
        // Kept separate from the test above on purpose — that one pins the call site
        // (`interceptedWhere`) and must keep building its own spy to do it.
        const interceptGuardRead = (mutate: () => Promise<unknown>) => {
            const realFindUnique = prisma.workoutSession.findUnique.bind(prisma.workoutSession);
            return vi
                .spyOn(prisma.workoutSession, 'findUnique')
                .mockImplementationOnce((async (args: Prisma.WorkoutSessionFindUniqueArgs) => {
                    const row = await realFindUnique(args);
                    await mutate();
                    return row;
                }) as unknown as typeof prisma.workoutSession.findUnique);
        };

        const closeInWindow = (sessionId: string) => async () => {
            await prisma.workoutSession.updateMany({
                where: { id: sessionId, userId, finishedAt: null },
                data: { finishedAt: new Date() },
            });
        };

        // Undoing this call's write cannot mean "delete the row that is there now". A set
        // logged while the session was open is the user's training data, and it is exactly
        // the row the upsert lands on when the client re-sends a set number — a retry, or an
        // edit typed a second later. Deleting it would answer a rejected late write by
        // destroying earlier work, which is strictly worse than the row this whole path
        // exists to prevent.
        it('puts back a set that was already logged instead of deleting it', async () => {
            const session = await workoutService.startWorkout(userId, routineId);
            await workoutService.addWorkoutSet(session.id, userId, {
                exerciseId, setNumber: 1, weightKg: 100, reps: 5,
            });

            const guardReadSpy = interceptGuardRead(closeInWindow(session.id));

            let raised: unknown;
            try {
                await workoutService.addWorkoutSet(session.id, userId, {
                    exerciseId, setNumber: 1, weightKg: 140, reps: 12, rpe: 9,
                });
            } catch (error) {
                raised = error;
            } finally {
                guardReadSpy.mockRestore();
            }

            expect((raised as Error | undefined)?.message).toBe('SESSION_CLOSED');

            // Told "not saved" and left changed anyway is the same lie as told "saved" and
            // left unwritable — the row has to read the way the user left it.
            const sets = await prisma.workoutSet.findMany({ where: { sessionId: session.id } });
            expect(sets).toHaveLength(1);
            expect(sets[0]!.weightKg).toBe(100);
            expect(sets[0]!.reps).toBe(5);
            expect(sets[0]!.rpe).toBeNull();

            // The link belongs to the first call, not this one. It also pins the happy
            // path: a link that was never created in the first place would read 0 here.
            const links = await prisma.workoutSessionExercise.count({ where: { sessionId: session.id } });
            expect(links).toBe(1);
        });

        // The window does not end at the link. `addWorkoutSet` writes twice, and a close
        // landing between those two writes is invisible to any check made before the set
        // upsert — which is exactly the shape this had while it delegated its guard to
        // `linkExerciseToSession` and then wrote the set outside it. Injected at the set
        // write itself, so only a re-check that runs AFTER it can see this close.
        it('compensates a set that landed after the exercise link was already accepted', async () => {
            const session = await workoutService.startWorkout(userId, routineId);

            const realUpsert = prisma.workoutSet.upsert.bind(prisma.workoutSet);
            const setWriteSpy = vi
                .spyOn(prisma.workoutSet, 'upsert')
                .mockImplementationOnce((async (args: Prisma.WorkoutSetUpsertArgs) => {
                    const row = await realUpsert(args);
                    await closeInWindow(session.id)();
                    return row;
                }) as unknown as typeof prisma.workoutSet.upsert);

            let raised: unknown;
            try {
                await workoutService.addWorkoutSet(session.id, userId, {
                    exerciseId, setNumber: 1, weightKg: 90, reps: 6,
                });
            } catch (error) {
                raised = error;
            } finally {
                setWriteSpy.mockRestore();
            }

            expect((raised as Error | undefined)?.message).toBe('SESSION_CLOSED');

            const sets = await prisma.workoutSet.count({ where: { sessionId: session.id } });
            expect(sets).toBe(0);
            const links = await prisma.workoutSessionExercise.count({ where: { sessionId: session.id } });
            expect(links).toBe(0);
        });

        // POST /:id/exercises writes no set, so the row it can strand is the link — and
        // that one is worse off than a set: PATCH and DELETE /workouts/sets/:id at least
        // exist, while nothing in production deletes a WorkoutSessionExercise at all.
        it('removes a link whose session closed after the guard read', async () => {
            const session = await workoutService.startWorkout(userId, routineId);

            const guardReadSpy = interceptGuardRead(closeInWindow(session.id));

            let raised: unknown;
            try {
                await workoutService.linkExerciseToSession(session.id, userId, exerciseId);
            } catch (error) {
                raised = error;
            } finally {
                guardReadSpy.mockRestore();
            }

            expect((raised as Error | undefined)?.message).toBe('SESSION_CLOSED');

            const links = await prisma.workoutSessionExercise.count({ where: { sessionId: session.id } });
            expect(links).toBe(0);
        });

        it('leaves an exercise that was already linked alone when it compensates', async () => {
            const session = await workoutService.startWorkout(userId, routineId);
            await workoutService.linkExerciseToSession(session.id, userId, exerciseId);

            const guardReadSpy = interceptGuardRead(closeInWindow(session.id));

            let raised: unknown;
            try {
                await workoutService.linkExerciseToSession(session.id, userId, exerciseId);
            } catch (error) {
                raised = error;
            } finally {
                guardReadSpy.mockRestore();
            }

            expect((raised as Error | undefined)?.message).toBe('SESSION_CLOSED');

            const links = await prisma.workoutSessionExercise.count({ where: { sessionId: session.id } });
            expect(links).toBe(1);
        });

        // The other way a session stops accepting writes mid-call, and the reason the
        // re-check cannot just answer 409: the stale sweep DELETES an open session with no
        // sets. A link written into one does not stop it — that WHERE re-checks `sets`,
        // not `exercises` — so the row is cascaded away and the session the client named
        // is genuinely gone. 409 would tell the client its workout is finished and sitting
        // in history; it is not, and no retry will ever find it.
        //
        // Injected at the link write rather than at the guard read because the ordering is
        // the point: a session already deleted when the upsert runs fails on the foreign
        // key instead, which is a different story with a different answer.
        it('reports a session deleted inside the window as missing, not as closed', async () => {
            const session = await workoutService.startWorkout(userId, routineId);

            const realUpsert = prisma.workoutSessionExercise.upsert.bind(prisma.workoutSessionExercise);
            const linkWriteSpy = vi
                .spyOn(prisma.workoutSessionExercise, 'upsert')
                .mockImplementationOnce((async (args: Prisma.WorkoutSessionExerciseUpsertArgs) => {
                    const row = await realUpsert(args);
                    // `closeStaleOpenSessions`' own statement, verbatim.
                    await prisma.workoutSession.deleteMany({
                        where: { id: session.id, finishedAt: null, sets: { none: {} } },
                    });
                    return row;
                }) as unknown as typeof prisma.workoutSessionExercise.upsert);

            let raised: unknown;
            try {
                await workoutService.linkExerciseToSession(session.id, userId, exerciseId);
            } catch (error) {
                raised = error;
            } finally {
                linkWriteSpy.mockRestore();
            }

            // The delete has to have landed, or the interleaving under test never happened.
            const gone = await prisma.workoutSession.findUnique({ where: { id: session.id } });
            expect(gone).toBeNull();

            // Not a raw P2025 either: the compensation runs against rows the cascade
            // already took, so it has to tolerate finding nothing instead of turning the
            // 404 into a 500 on the way out.
            expect((raised as Error | undefined)?.message).toBe('SESSION_NOT_FOUND');
        });
    });

    // Finishing twice is not a client bug to punish — it is the shape of the UI. The
    // "Finalizar" button has no disabled state and no debounce, and the client aborts
    // at 10s without Express ever cancelling the request, so the second tap is routine
    // and the workout it names really did finish.
    //
    // That rules out 409, which the rest of this file uses for writes into a closed
    // session. There the answer must reject; here it must NOT: `handleFinish` is a bare
    // catch, so a 409 puts the user in a retry loop over a workout that is already in
    // their history. So: idempotent no-op for a session already finished, 404 only when
    // the id names nothing the caller owns.
    // The idempotency guard above is evaluated in JS between two round trips, so it
    // only sees what the read saw. A close that lands in that window is invisible to
    // it, and the write goes through unconditionally — which is the item-5 bug with
    // extra steps. `closeSessionPreservingNotes` defends itself from exactly this by
    // putting `finishedAt: null` in its WHERE; the defence has to be mutual.
    describe('finishWorkout under a concurrent close', () => {
        beforeEach(closeAllOpenSessions);

        it('does not overwrite a close that landed just before its write', async () => {
            const session = await workoutService.startWorkout(userId, routineId);
            // The set is required twice over: the sweep only closes sessions that HAVE
            // sets (it deletes the empty ones), and without one `finishWorkout` discards
            // the row before ever reaching the write this test intercepts.
            await prisma.workoutSet.create({
                data: { sessionId: session.id, exerciseId, setNumber: 1, weightKg: 60, reps: 10 },
            });
            // What the sweep stamps: the last set's createdAt, hours in the past.
            const sweepClosedAt = new Date(Date.now() - 25 * 60 * 60 * 1000);

            // Inject the sweep's close immediately BEFORE the real write runs, then let
            // it through untouched. Whether the write survives that is decided entirely
            // by its own WHERE — which is the point: a guard evaluated in JS against an
            // earlier snapshot cannot see this close, a predicate in the WHERE can.
            const realUpdateMany = prisma.workoutSession.updateMany.bind(prisma.workoutSession);
            const writeSpy = vi
                .spyOn(prisma.workoutSession, 'updateMany')
                .mockImplementationOnce((async (args: Prisma.WorkoutSessionUpdateManyArgs) => {
                    await prisma.workoutSession.update({
                        where: { id: session.id },
                        data: { finishedAt: sweepClosedAt, notes: 'Auto-closed: abandoned session' }
                    });
                    return realUpdateMany(args);
                }) as unknown as typeof prisma.workoutSession.updateMany);

            try {
                await workoutService.finishWorkout(session.id, userId);
            } finally {
                writeSpy.mockRestore();
            }

            const stored = await prisma.workoutSession.findUnique({ where: { id: session.id } });
            // The sweep's timestamp has to survive. Overwriting it with `now` turns a
            // workout that ended 25h ago into one ending this instant, and leaves the
            // auto-close note next to a duration that contradicts it.
            expect(stored?.finishedAt).toEqual(sweepClosedAt);
        });
    });

    describe('finishWorkout is idempotent', () => {
        beforeEach(closeAllOpenSessions);

        // Idempotency is a property of the CLOSE path, and after the empty-session
        // discard only a session with training data takes it. Every fixture in this
        // block logs a set for that reason: an empty one is deleted on the first call,
        // so the second would be asserting about a row that no longer exists.
        const logOneSet = (sessionId: string) =>
            prisma.workoutSet.create({
                data: { sessionId, exerciseId, setNumber: 1, weightKg: 60, reps: 10 },
            });

        it('sets finishedAt on an open session', async () => {
            const session = await workoutService.startWorkout(userId, routineId);
            expect(session.finishedAt).toBeNull();
            await logOneSet(session.id);

            const finished = await workoutService.finishWorkout(session.id, userId);

            expect(finished.finishedAt).toBeInstanceOf(Date);
            expect(finished.id).toBe(session.id);
        });

        // The item-5 bug: the second call used to rewrite finishedAt with `new Date()`,
        // silently stretching a workout that ended hours earlier. The returned row must
        // carry the ORIGINAL timestamp, not a fresh one.
        it('does not rewrite finishedAt when the session is already finished', async () => {
            const session = await workoutService.startWorkout(userId, routineId);
            await logOneSet(session.id);
            const first = await workoutService.finishWorkout(session.id, userId);

            const second = await workoutService.finishWorkout(session.id, userId);

            expect(second.finishedAt).toEqual(first.finishedAt);
            const stored = await prisma.workoutSession.findUnique({ where: { id: session.id } });
            expect(stored?.finishedAt).toEqual(first.finishedAt);
        });

        // Returning the row — rather than throwing — is what keeps the second tap a
        // success for the client. A sentinel here would land in the same bare catch as
        // a network failure.
        it('returns the existing session instead of throwing on the second call', async () => {
            const session = await workoutService.startWorkout(userId, routineId);
            await logOneSet(session.id);
            await workoutService.finishWorkout(session.id, userId);

            const again = await workoutService.finishWorkout(session.id, userId);

            expect(again.id).toBe(session.id);
        });

        it('throws SESSION_NOT_FOUND for an id that does not exist', async () => {
            await expect(
                workoutService.finishWorkout('00000000-0000-0000-0000-000000000000', userId)
            ).rejects.toThrow('SESSION_NOT_FOUND');
        });

        // Parametrized over the foreign session's state for the reason the set routes
        // are: ownership has to decide BEFORE state. Were the state read first, a
        // foreign FINISHED session would take the idempotent path and hand back another
        // user's row as a 200 — a leak that the OPEN case alone cannot catch.
        it.each([
            ['OPEN', null],
            ['FINISHED', new Date()],
        ] as const)('throws SESSION_NOT_FOUND for another user\'s session, %s', async (_label, finishedAt) => {
            const other = await prisma.user.create({
                data: {
                    email: `finish.other.${Date.now()}.${Math.random()}@example.com`,
                    password: 'password123',
                    name: 'Other',
                },
            });
            const foreign = await prisma.workoutSession.create({
                data: { userId: other.id, startedAt: new Date(Date.now() - 60_000), finishedAt },
            });

            try {
                await expect(
                    workoutService.finishWorkout(foreign.id, userId)
                ).rejects.toThrow('SESSION_NOT_FOUND');

                // Rejecting but writing anyway would be the worst outcome.
                const stored = await prisma.workoutSession.findUnique({ where: { id: foreign.id } });
                expect(stored?.finishedAt).toEqual(finishedAt);
            } finally {
                await prisma.workoutSession.delete({ where: { id: foreign.id } });
                await prisma.user.delete({ where: { id: other.id } });
            }
        });
    });
});
