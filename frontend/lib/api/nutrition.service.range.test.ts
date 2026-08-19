// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/api/client', () => ({ apiClient: vi.fn() }));

import { apiClient } from '@/lib/api/client';
import { getNutritionHistory, dayBounds } from './nutrition.service';

const mockedClient = vi.mocked(apiClient);
const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });
const url = () => mockedClient.mock.calls[0][0] as string;

/**
 * Runs a body with the process pinned to a given timezone and a given instant.
 *
 * Both halves are necessary. The suite's own timezone is America/Buenos_Aires,
 * which has not observed DST since 2009 — so a test that only asserts the
 * invariant under the ambient clock cannot fail for a DST reason no matter what
 * the implementation does. Only Date is faked, so setTimeout stays real and
 * anything awaiting a timer still resolves.
 */
function enZonaHoraria<T>(tz: string, instante: string, body: () => T): T {
  const original = process.env.TZ;
  process.env.TZ = tz;
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(instante));
  try {
    return body();
  } finally {
    vi.useRealTimers();
    if (original === undefined) delete process.env.TZ;
    else process.env.TZ = original;
  }
}

describe('dayBounds', () => {
  /**
   * The bounds are computed in the BROWSER's timezone, on purpose: the day the
   * user means is their local day. The server never decides this — it only
   * compares instants.
   */
  it('runs from the start of its local day to the start of the next', () => {
    const { from, to } = dayBounds(new Date(2026, 6, 30, 14, 0, 0));

    expect(new Date(from).getFullYear()).toBe(2026);
    expect(new Date(from).getMonth()).toBe(6);
    expect(new Date(from).getDate()).toBe(30);
    expect(new Date(from).getHours()).toBe(0);
    expect(new Date(from).getMinutes()).toBe(0);
    // The upper bound is midnight of the 31st, not 23:59 of the 30th. A day is
    // named by where it starts and where the next one starts, because a
    // wall-clock time near midnight is not a reliable way to point at an
    // instant — see the DST suite below.
    expect(new Date(to).getDate()).toBe(31);
    expect(new Date(to).getHours()).toBe(0);
    expect(new Date(to).getMinutes()).toBe(0);
  });

  /**
   * The interval is HALF-OPEN, so "does not bleed into the next day" is a
   * statement about what it CONTAINS, not about where it ends: everything
   * strictly before the upper bound is still the 30th, and the upper bound
   * itself is the 31st and is excluded. Asserting only that `to` falls on the
   * 30th would forbid the correct answer.
   */
  it('does not bleed into the next day', () => {
    const { to } = dayBounds(new Date(2026, 6, 30));

    const ultimoInstante = new Date(new Date(to).getTime() - 1);
    expect(ultimoInstante.getDate()).toBe(30);
    expect(ultimoInstante.getHours()).toBe(23);
    expect(new Date(to).getDate()).toBe(31);
  });

  it('sends the bounds as ISO instants', () => {
    const { from, to } = dayBounds(new Date(2026, 6, 30));
    expect(from).toMatch(/^\d{4}-\d{2}-\d{2}T.*Z$/);
    expect(to).toMatch(/^\d{4}-\d{2}-\d{2}T.*Z$/);
  });

  // An entry logged at 23:00 in Buenos Aires is already the next day in UTC.
  // The local day must still contain it.
  it('covers a local late-night instant that is already tomorrow in UTC', () => {
    const dia = new Date(2026, 6, 30);
    const tarde = new Date(2026, 6, 30, 23, 0, 0);
    const { from, to } = dayBounds(dia);

    expect(tarde.getTime()).toBeGreaterThanOrEqual(new Date(from).getTime());
    expect(tarde.getTime()).toBeLessThan(new Date(to).getTime());
  });
});

/**
 * A day is a HALF-OPEN interval: [start of day N, start of day N + 1).
 *
 * Naming its end by a local wall-clock time is what broke. In a zone that falls
 * back at or near local midnight, local 23:xx HAPPENS TWICE, and V8 resolves an
 * ambiguous local time to the FIRST, pre-transition occurrence. So an instant
 * living in the SECOND occurrence is GREATER than the bound that is supposed to
 * contain it, and `from <= now <= to` is simply false for that hour.
 *
 * These windows are also the merge window POST /api/nutrition validates the
 * entry against, so during that hour the save answered 400 and the food was
 * lost — retrying could not help, because the clock was the problem.
 *
 * 27 IANA zones are affected, 60 minutes a year each. The instants below are the
 * next occurrence in each.
 */
describe('dayBounds across a DST transition at local midnight', () => {
  /** [zone, the instant the clock falls back, the local day it is falling back into] */
  const vuelvenAtras: [string, string][] = [
    ['Africa/Cairo', '2026-10-29T21:00:00.000Z'],
    ['Asia/Beirut', '2026-10-24T21:00:00.000Z'],
    ['America/Scoresbysund', '2026-10-25T01:00:00.000Z'],
    ['America/Santiago', '2027-04-04T03:00:00.000Z'],
  ];

  it.each(vuelvenAtras)(
    'contains an instant inside the repeated hour in %s',
    (tz, transicion) => {
      // Half an hour INTO the second occurrence of the ambiguous local hour.
      const dentro = new Date(new Date(transicion).getTime() + 30 * 60 * 1000).toISOString();

      const { from, to, ahora } = enZonaHoraria(tz, dentro, () => {
        const ahora = new Date();
        return { ...dayBounds(ahora), ahora };
      });

      expect(new Date(from).getTime()).toBeLessThanOrEqual(ahora.getTime());
      expect(ahora.getTime()).toBeLessThan(new Date(to).getTime());
    }
  );

  it.each(vuelvenAtras)('spans exactly 25 hours on the day %s falls back', (tz, transicion) => {
    const dentro = new Date(new Date(transicion).getTime() + 30 * 60 * 1000).toISOString();

    const { from, to } = enZonaHoraria(tz, dentro, () => dayBounds(new Date()));

    expect((new Date(to).getTime() - new Date(from).getTime()) / 3600000).toBe(25);
  });

  /**
   * The upper bound is the first instant of the NEXT day, and it belongs to that
   * day, not to this one. Without this the interval could be closed at the top
   * and two consecutive days would both claim one instant — the same food
   * counted twice, or merged into whichever day asked first.
   */
  it('excludes its own upper bound, which is the next day\'s first instant', () => {
    const { to, siguiente } = enZonaHoraria('Africa/Cairo', '2026-10-29T21:30:00.000Z', () => {
      const to = dayBounds(new Date()).to;
      return { to, siguiente: dayBounds(new Date(to)) };
    });

    expect(siguiente.from).toBe(to);
  });

  /**
   * SPRING FORWARD, the mirror question: local 00:00 may not exist at all.
   *
   * Deriving the end of the day by bumping the anchor's calendar day and only
   * then zeroing the clock is NOT safe. In America/Godthab the clock jumps from
   * 2024-03-30 22:59:59 to 2024-03-31 00:00, so local 23:00 on the 30th does not
   * exist. An anchor at 23:00 on the 29th, moved a day forward, lands in that
   * gap; V8 resolves it forward past midnight, the calendar date slips to the
   * 31st, and zeroing the clock afterwards is too late. The result was a
   * FORTY-SEVEN hour "day" — two days in one window, and small enough to sail
   * under the backend's 48-hour cap without a word.
   *
   * Building both bounds straight from the anchor's calendar fields carries no
   * time of day across the day change, so there is nothing to land in a gap.
   */
  it('does not swallow two days when the next local midnight does not exist', () => {
    const { from, to } = enZonaHoraria('America/Godthab', '2024-03-30T01:00:00.000Z', () =>
      dayBounds(new Date())
    );

    expect((new Date(to).getTime() - new Date(from).getTime()) / 3600000).toBe(24);
  });

  /**
   * And the day that BEGINS with a midnight that never happens still has to
   * start somewhere: at the first instant that exists, which is the moment the
   * clock jumped. A day cannot begin at a time that does not exist.
   */
  it('starts a day whose local midnight never happens at the instant the clock jumped', () => {
    const saltoDeCairo = '2027-04-29T22:00:00.000Z'; // 00:00 -> 01:00 local

    const { from, to } = enZonaHoraria('Africa/Cairo', '2027-04-30T04:00:00.000Z', () =>
      dayBounds(new Date())
    );

    expect(from).toBe(saltoDeCairo);
    expect((new Date(to).getTime() - new Date(from).getTime()) / 3600000).toBe(23);
  });
});

describe('getNutritionHistory with a range', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedClient.mockResolvedValue(ok({ data: [], pagination: { offset: 0, limit: 50, total: 0 } }));
  });

  it('passes the bounds to the endpoint', async () => {
    await getNutritionHistory(50, 0, { from: '2026-07-30T03:00:00.000Z', to: '2026-07-31T02:59:59.999Z' });

    expect(url()).toContain('from=2026-07-30T03%3A00%3A00.000Z');
    expect(url()).toContain('to=2026-07-31T02%3A59%3A59.999Z');
  });

  it('omits them entirely when no range is given', async () => {
    await getNutritionHistory();

    expect(url()).not.toContain('from=');
    expect(url()).not.toContain('to=');
  });
});
