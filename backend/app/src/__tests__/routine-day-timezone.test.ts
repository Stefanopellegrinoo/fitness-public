import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import request from 'supertest';
import { app } from '../app';
import { prisma } from '../lib/prisma';
import { authService } from '../services/auth.service';
import { DayOfWeek } from '@prisma/client';

/**
 * Slice 4 of user-timezone-day-boundaries: the DAY-OF-WEEK mechanism.
 *
 * Slices 1-3 moved every day/week WINDOW into the caller's zone. This one is a
 * different mechanism -- a weekday enum, not a window -- and it was left reading
 * the process clock through `getCurrentDayOfWeekServer()`. Two defects, one root:
 *
 *  1. `GET /api/routines/:id/next-day` takes no zone at all, so the weekday that
 *     anchors the rotation is the SERVER's, not the caller's.
 *  2. `startWorkout` resolves `clientDay || <server weekday>` into `targetDay`,
 *     uses it for the weekday-anchored lookup, and then DISCARDS it: the fallback
 *     calls `suggestNextRoutineDay(userId, routineId)`, which derives "today" from
 *     the process clock all over again.
 *
 * The oracle for (1) is a pair of requests fired at the SAME instant that differ
 * only in `?tz=`: they must disagree. Code that ignores `tz` cannot make them.
 *
 * Zones: Pacific/Kiritimati (UTC+14) and Etc/GMT+12 (UTC-12) are 26h apart, so
 * they are NEVER on the same calendar day. `Etc/GMT+12` is already part of the
 * documented `?tz=` corpus (shape-legal fixed offset, tz-contract-uniformity).
 */
describe('routine day-of-week resolution -- caller zone, not process clock', () => {
  const EAST = 'Pacific/Kiritimati';
  const WEST = 'Etc/GMT+12';
  // 20:00 Aug 6 in EAST, 18:00 Aug 5 in WEST: different weekdays, and both ~6h
  // from their nearest midnight so neither is sitting on a boundary.
  const NOW = '2026-08-06T06:00:00.000Z';
  const ORIGINAL_TZ = process.env.TZ;

  // Independent of lib/date.ts ON PURPOSE. A test that derives the expected
  // weekday with the same helper the route uses proves only that the helper
  // equals itself.
  const WEEKDAY: Record<string, DayOfWeek> = {
    Sunday: 'DOMINGO', Monday: 'LUNES', Tuesday: 'MARTES', Wednesday: 'MIERCOLES',
    Thursday: 'JUEVES', Friday: 'VIERNES', Saturday: 'SABADO',
  };
  function weekdayIn(tz: string): DayOfWeek {
    const name = new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'long' }).format(new Date(NOW));
    return WEEKDAY[name]!;
  }

  function freeze() {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(NOW));
  }

  let userId: string;
  let authToken: string;

  beforeAll(async () => {
    const stamp = `${Date.now()}.${Math.random()}`;
    const user = await prisma.user.create({
      data: { email: `tz.routineday.${stamp}@example.com`, password: 'password123' },
    });
    userId = user.id;
    // Issued against the REAL clock; NOW is in the past, so `exp` is still ahead
    // of the frozen clock. Freezing FORWARD past the expiry is what turns a
    // mutant table into a page of 401s that read as "the mutant survived".
    authToken = authService.generateTokens({ userId: user.id, email: user.email }).accessToken;
  });

  afterAll(async () => {
    await prisma.workoutSessionExercise.deleteMany({ where: { session: { userId } } });
    await prisma.workoutSet.deleteMany({ where: { session: { userId } } });
    await prisma.workoutSession.deleteMany({ where: { userId } });
    await prisma.routine.deleteMany({ where: { userId } });
    await prisma.user.delete({ where: { id: userId } });
  });

  afterEach(async () => {
    vi.useRealTimers();
    if (ORIGINAL_TZ === undefined) delete process.env.TZ;
    else process.env.TZ = ORIGINAL_TZ;
    await prisma.workoutSessionExercise.deleteMany({ where: { session: { userId } } });
    await prisma.workoutSet.deleteMany({ where: { session: { userId } } });
    await prisma.workoutSession.deleteMany({ where: { userId } });
    await prisma.routine.deleteMany({ where: { userId } });
  });

  /**
   * A routine with NO session history -- the only state in which the weekday
   * branch of `suggestNextRoutineDay` is reachable at all. `first` carries no
   * weekday and is order 1, so it is also the no-match fallback: any assertion
   * that lands on `east`/`west` proves a weekday actually matched.
   */
  async function seedRoutine() {
    const routine = await prisma.routine.create({ data: { name: 'TZ Rotation', userId } });
    const first = await prisma.routineDay.create({ data: { routineId: routine.id, name: 'A', order: 1 } });
    const east = await prisma.routineDay.create({
      data: { routineId: routine.id, name: 'East', order: 2, weekday: weekdayIn(EAST) },
    });
    const west = await prisma.routineDay.create({
      data: { routineId: routine.id, name: 'West', order: 3, weekday: weekdayIn(WEST) },
    });
    return { routineId: routine.id, first, east, west };
  }

  const nextDay = (routineId: string, query = '') =>
    request(app).get(`/api/routines/${routineId}/next-day${query}`).set('Cookie', [`auth_token=${authToken}`]);

  it('the two zones really are on different weekdays at this instant', () => {
    // Guard, not ceremony: every assertion below is invisible if this is false.
    expect(weekdayIn(EAST)).not.toBe(weekdayIn(WEST));
  });

  it('GET /next-day anchors on the weekday in the CALLER zone', async () => {
    // A THIRD zone, and specifically one with a NEGATIVE offset. MEASURED: with
    // the process on UTC or on EAST, mutating `dayOfWeekInZone`'s `getUTCDay()`
    // to `getDay()` is INVISIBLE -- the weekday is derived from a `Date.UTC`
    // midnight, which only reads differently where the process zone is behind
    // UTC. On UTC-3 both halves below die. A fixture that cannot see the
    // mutation measures nothing, however green it looks.
    process.env.TZ = 'America/Argentina/Buenos_Aires';
    freeze();
    const { routineId, east, west } = await seedRoutine();

    const [fromEast, fromWest] = await Promise.all([
      nextDay(routineId, `?tz=${encodeURIComponent(EAST)}`),
      nextDay(routineId, `?tz=${encodeURIComponent(WEST)}`),
    ]);

    expect(fromEast.status).toBe(200);
    expect(fromWest.status).toBe(200);
    // Same instant, same routine, same user: the ONLY difference is the zone,
    // so agreement here means the zone was never read.
    expect(fromEast.body.data.id).toBe(east.id);
    expect(fromWest.body.data.id).toBe(west.id);
  });

  it('a foreign routine is 404 even when tz is also invalid', async () => {
    // Guards the ORDER of the two checks in the route, which nothing else does:
    // the existing 404 test sends no `tz`, so hoisting the tz block above the
    // ownership check leaves it green while turning this case into a 400 --
    // and a 400-vs-404 split is exactly what tells an enumerator which routine
    // ids exist. Both defects have to be in the request for the order to show.
    const stranger = await prisma.user.create({
      data: { email: `tz.stranger.${Date.now()}@example.com`, password: 'password123' },
    });
    const foreign = await prisma.routine.create({ data: { name: 'Foreign', userId: stranger.id } });

    const res = await nextDay(foreign.id, '?tz=Nope%2FNope');
    expect(res.status).toBe(404);

    await prisma.routine.delete({ where: { id: foreign.id } });
    await prisma.user.delete({ where: { id: stranger.id } });
  });

  it('startWorkout keeps the clientDay it already resolved, instead of re-reading the server clock', async () => {
    // The process zone is EAST, so a server-clock fallback lands on `east`.
    // The client says it is the WEST weekday. Neither `first` nor anything else
    // matches WEST here -- `west` is deliberately NOT seeded -- so the honest
    // answer is the order-1 fallback, `first`.
    process.env.TZ = EAST;
    freeze();
    const routine = await prisma.routine.create({ data: { name: 'TZ Start', userId } });
    const first = await prisma.routineDay.create({ data: { routineId: routine.id, name: 'A', order: 1 } });
    const east = await prisma.routineDay.create({
      data: { routineId: routine.id, name: 'East', order: 2, weekday: weekdayIn(EAST) },
    });

    const res = await request(app)
      .post('/api/workouts/start')
      .set('Cookie', [`auth_token=${authToken}`])
      .send({ routineId: routine.id, clientDay: weekdayIn(WEST) });

    expect(res.status).toBe(201);
    expect(res.body.data.routineDayId).not.toBe(east.id);
    expect(res.body.data.routineDayId).toBe(first.id);
  });

  /*
   * MUTATION NOTE, measured, so the next reader does not re-derive it:
   *
   * Replacing `targetDay` with a literal the fixture does not contain ('LUNES')
   * leaves this file GREEN, and that is an EQUIVALENT mutant, not a coverage
   * hole. `startWorkout` only reaches the suggestion after its own weekday
   * lookup missed, and that lookup sees the same set of days, so any weekday
   * absent from the routine sends the suggestion down the identical `days[0]`
   * rung. Two mutants that are NOT equivalent both die here:
   *   - passing `dayOfWeekInZone(new Date(), resolveIanaZone(undefined))`,
   *     i.e. re-reading the server clock -- the exact regression this slice
   *     removed (1 failed)
   *   - passing a weekday the routine DOES have ('JUEVES') (2 failed)
   * The second is what makes threading `targetDay` load-bearing rather than
   * cosmetic: it stops the fallback anchoring on a weekday the lookup above
   * already ruled out.
   */
});
