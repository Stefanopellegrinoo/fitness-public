import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { app } from '../app';
import { prisma } from '../lib/prisma';
import { authService } from '../services/auth.service';

/**
 * The first backend tests for /api/nutrition. The route had none.
 *
 * The filter takes an explicit INSTANT RANGE, not a calendar date, and that is
 * the whole point: only the client knows the user's timezone, so only the client
 * can say where a day starts. The server does a plain range comparison and never
 * calls setHours, which is why these assertions hold identically under UTC and
 * under TZ=America/Buenos_Aires.
 *
 * The range is HALF-OPEN — [from, to) — because a day is, and this filter exists
 * to serve one. Its end is the START OF THE NEXT DAY, which is the only name for
 * it that survives a DST fall-back: a local wall-clock time near midnight can
 * happen twice, and then it denotes the earlier of the two and stops short of an
 * hour that really exists.
 */
describe('GET /api/nutrition with a date range', () => {
  let userId: string;
  let otherUserId: string;
  let authToken: string;
  const stamp = Date.now();

  // Three fixed instants. The middle one is what a Buenos Aires user logs at
  // 23:00 on the 30th: it is already the 31st in UTC, so any server-side
  // "start of day" would file it under the wrong day.
  const elDia29 = new Date('2026-07-29T15:00:00.000Z');
  const cerca23hEnBuenosAires = new Date('2026-07-31T02:00:00.000Z');
  const elDia31 = new Date('2026-07-31T15:00:00.000Z');

  beforeAll(async () => {
    const user = await prisma.user.create({
      data: { email: `nutri.range.${stamp}@example.com`, password: 'password123', name: 'Range Tester' },
    });
    const other = await prisma.user.create({
      data: { email: `nutri.range.other.${stamp}@example.com`, password: 'password123', name: 'Other' },
    });
    userId = user.id;
    otherUserId = other.id;
    authToken = authService.generateTokens({ userId: user.id, email: user.email }).accessToken;

    const make = (uid: string, foodName: string, date: Date) =>
      prisma.nutritionEntry.create({
        data: {
          userId: uid, foodName, grams: 100, mealCategory: 'Desayuno',
          calories: 100, protein: 5, carbs: 10, fat: 2, date, status: 'COMPLETED',
        },
      });

    await make(userId, `dia29 ${stamp}`, elDia29);
    await make(userId, `borde ${stamp}`, cerca23hEnBuenosAires);
    await make(userId, `dia31 ${stamp}`, elDia31);
    await make(otherUserId, `ajena ${stamp}`, elDia31);
  });

  afterAll(async () => {
    await prisma.nutritionEntry.deleteMany({ where: { userId: { in: [userId, otherUserId] } } });
    await prisma.user.deleteMany({ where: { id: { in: [userId, otherUserId] } } });
  });

  const auth = (req: request.Test) => req.set('Cookie', [`auth_token=${authToken}`]);
  const names = (body: { data: { foodName: string }[] }) => body.data.map((e) => e.foodName).sort();

  it('returns every entry when no range is given', async () => {
    const res = await auth(request(app).get('/api/nutrition'));
    expect(res.status).toBe(200);
    expect(names(res.body)).toEqual([`borde ${stamp}`, `dia29 ${stamp}`, `dia31 ${stamp}`]);
  });

  it('keeps only the entries inside the range', async () => {
    const res = await auth(request(app).get(
      '/api/nutrition?from=2026-07-31T03:00:00.000Z&to=2026-08-01T03:00:00.000Z'
    ));
    expect(res.status).toBe(200);
    expect(names(res.body)).toEqual([`dia31 ${stamp}`]);
  });

  /**
   * The Buenos Aires day of the 30th runs from 03:00Z on the 30th up to, but not
   * including, 03:00Z on the 31st. The entry stored at 02:00Z on the 31st
   * belongs to it — and a server that computed the day itself would put it on
   * the 31st instead.
   */
  it('includes an entry that falls on another calendar day in UTC', async () => {
    const res = await auth(request(app).get(
      '/api/nutrition?from=2026-07-30T03:00:00.000Z&to=2026-07-31T03:00:00.000Z'
    ));
    expect(names(res.body)).toEqual([`borde ${stamp}`]);
  });

  /**
   * An entry sitting on either extreme is still returned — that was the point of
   * this test and it still is. What moves is how the upper extreme is reached:
   * the range is half-open, so it has to END AFTER the last entry rather than
   * ON it. A millisecond is enough here, and the real client overshoots by much
   * more: it ends the day at the start of the next one, which is later than
   * every instant that day can hold.
   */
  it('includes the entry at each end of the range', async () => {
    const to = new Date(elDia31.getTime() + 1).toISOString();

    const res = await auth(request(app).get(
      `/api/nutrition?from=${elDia29.toISOString()}&to=${to}`
    ));
    expect(names(res.body)).toEqual([`borde ${stamp}`, `dia29 ${stamp}`, `dia31 ${stamp}`]);
  });

  /**
   * The range is HALF-OPEN — [from, to) — because it is the same interval the
   * client computes for a local day, and the end of a day can only be named
   * safely as the START OF THE NEXT ONE. A wall-clock name like 23:59:59.999 is
   * ambiguous in any zone that falls back at or near local midnight, where that
   * hour happens twice; the same window is the merge window POST validates
   * against, so the two must agree exactly or a diary shows an entry the write
   * path refused to file.
   *
   * The seam is where it matters: the instant the range ends at belongs to the
   * NEXT range, so it must not appear in this one — otherwise the last meal of
   * one day is also the first meal of the next, and the day's totals are wrong
   * in both.
   */
  it('excludes the entry sitting exactly at the instant the range ends', async () => {
    const res = await auth(request(app).get(
      `/api/nutrition?from=${elDia29.toISOString()}&to=${elDia31.toISOString()}`
    ));

    expect(res.status).toBe(200);
    expect(names(res.body)).toEqual([`borde ${stamp}`, `dia29 ${stamp}`]);
  });

  it('includes the entry sitting exactly at the instant the range starts', async () => {
    const res = await auth(request(app).get(
      `/api/nutrition?from=${elDia31.toISOString()}&to=2026-08-01T03:00:00.000Z`
    ));

    expect(names(res.body)).toEqual([`dia31 ${stamp}`]);
  });

  /** Two adjacent ranges must partition the entries: every one in exactly one. */
  it('splits an entry into exactly one of two adjacent ranges', async () => {
    const juntura = '2026-07-31T03:00:00.000Z';
    const antes = await auth(request(app).get(`/api/nutrition?from=2026-07-30T03:00:00.000Z&to=${juntura}`));
    const despues = await auth(request(app).get(`/api/nutrition?from=${juntura}&to=2026-08-01T03:00:00.000Z`));

    expect(names(antes.body)).toEqual([`borde ${stamp}`]);
    expect(names(despues.body)).toEqual([`dia31 ${stamp}`]);
  });

  it('accepts a lower bound on its own', async () => {
    const res = await auth(request(app).get('/api/nutrition?from=2026-07-31T03:00:00.000Z'));
    expect(names(res.body)).toEqual([`dia31 ${stamp}`]);
  });

  it('accepts an upper bound on its own', async () => {
    const res = await auth(request(app).get('/api/nutrition?to=2026-07-30T00:00:00.000Z'));
    expect(names(res.body)).toEqual([`dia29 ${stamp}`]);
  });

  /**
   * The other user has an entry at this very instant. The range is narrowed to
   * the single millisecond that holds both, so the only thing separating them is
   * the tenancy filter — a range of one instant is written as [t, t + 1ms) now
   * that the upper bound is exclusive, since [t, t) is empty and would pass this
   * test without proving anything.
   */
  it('never returns another user\'s entries', async () => {
    const to = new Date(elDia31.getTime() + 1).toISOString();

    const res = await auth(request(app).get(
      `/api/nutrition?from=${elDia31.toISOString()}&to=${to}`
    ));
    expect(names(res.body)).toEqual([`dia31 ${stamp}`]);
  });

  /**
   * The count must describe the FILTERED set. A global total would tell the
   * client "you are seeing 3 of 400" for a day that holds exactly 3, which is
   * the same silent-incompleteness the client-side filtering had.
   */
  it('counts the filtered entries, not every entry the user has', async () => {
    const res = await auth(request(app).get(
      '/api/nutrition?from=2026-07-31T03:00:00.000Z&to=2026-08-01T03:00:00.000Z'
    ));
    expect(res.body.pagination.total).toBe(1);
  });

  /**
   * This endpoint SHIPPED before the merge window did, and it shares the merge
   * window's bound parser. Tightening that parser to demand an explicit timezone
   * was right; tightening it to demand the browser's exact spelling of
   * everything else was not, and it narrowed a contract that was already public.
   *
   * All three forms below are ISO-8601 instants with an unambiguous zone, all
   * three name the same instant as `elDia31`, and all three used to work here.
   * They are what `datetime.isoformat()` in Python, `RFC3339Nano` in Go,
   * `Instant.toString()` in Java, a Postgres `::text` cast and any client
   * following RFC 3339 §5.6 actually emit.
   *
   * The assertion is on the RESULT, not the status: a bound that were accepted
   * and then resolved somewhere else would answer 200 with the wrong day, which
   * is worse than the 400 it replaced.
   */
  const dialectos: [string, string][] = [
    ['six fractional digits', '2026-07-31T15:00:00.000000Z'],
    ['a lower case t and z', '2026-07-31t15:00:00.000z'],
    ['a basic-format offset', '2026-07-31T18:00:00.000+0300'],
  ];

  it('accepts the ISO instants other languages emit, and filters on the instant they name', async () => {
    for (const [dialecto, desde] of dialectos) {
      const res = await auth(request(app).get(
        `/api/nutrition?from=${encodeURIComponent(desde)}&to=2026-08-01T03:00:00.000Z`
      ));

      expect(res.status, dialecto).toBe(200);
      expect(names(res.body), dialecto).toEqual([`dia31 ${stamp}`]);
    }
  });

  /**
   * The upper bound is exclusive, so the same instant spelled in any dialect has
   * to leave the entry sitting on it OUT. Read and write share this parser, and
   * a dialect that shifted a bound would put the diary and the merge window on
   * different days.
   */
  it('keeps the upper bound exclusive in every dialect', async () => {
    for (const [dialecto, hasta] of dialectos) {
      const res = await auth(request(app).get(
        `/api/nutrition?from=${elDia29.toISOString()}&to=${encodeURIComponent(hasta)}`
      ));

      expect(res.status, dialecto).toBe(200);
      expect(names(res.body), dialecto).toEqual([`borde ${stamp}`, `dia29 ${stamp}`]);
    }
  });

  it('rejects a malformed bound instead of ignoring it', async () => {
    const res = await auth(request(app).get('/api/nutrition?from=ayer'));
    expect(res.status).toBe(400);
  });

  /**
   * A bound with no zone designator still means whatever the server's clock says
   * it means, which is the dependency this endpoint exists without. Widening the
   * dialects must not widen THAT — pinned here next to the widening, rather than
   * left to the merge-window suite, because this is the endpoint that shipped.
   */
  it('still refuses a bound with no timezone, however well formed', async () => {
    for (const raw of ['2026-07-31T15:00:00', '2026-07-31', 'July 31 2026', '1785456000000']) {
      const res = await auth(request(app).get(`/api/nutrition?from=${encodeURIComponent(raw)}`));
      expect(res.status, raw).toBe(400);
    }
  });

  /** An hour of 24 names the next day, not the one it spells. */
  it('refuses an hour of 24 on either bound', async () => {
    const desde = await auth(request(app).get('/api/nutrition?from=2026-07-31T24:00:00.000Z'));
    expect(desde.status).toBe(400);

    const hasta = await auth(request(app).get('/api/nutrition?to=2026-07-31T24:00:00.000Z'));
    expect(hasta.status).toBe(400);
  });

  it('rejects a range that ends before it starts', async () => {
    const res = await auth(request(app).get(
      '/api/nutrition?from=2026-07-31T00:00:00.000Z&to=2026-07-29T00:00:00.000Z'
    ));
    expect(res.status).toBe(400);
  });
});
