import { describe, it, expect, vi } from 'vitest';
import { dayWindowInZone, isoWeekWindowInZone, assertIanaZone, formatLocalDate, resolveIanaZone } from '../lib/date';
import { checkZone } from './helpers/zone-invariants';

/**
 * The primitive every "what day is it" call in the backend should route
 * through: a local day starts at the FIRST instant whose local date in the
 * user's zone equals that date, and ends where the next calendar date
 * begins -- never at `23:59:59.999`, never at `+24h`.
 *
 * Measured (backend/start-of-day-in-zone, 418 zones, 2015-2035, 38444
 * checks): naive offset arithmetic breaks in 16 zones, `@date-fns/tz` breaks
 * in 7 (it returns a start AFTER the instant it was asked about), and this
 * definition breaks in none. `Intl` alone is enough; no dependency added.
 *
 * Every instant below is written in UTC, so these assertions hold
 * identically under the runner's default zone and under `TZ=UTC`.
 */

// The 23-zone regression corpus, each entry carrying the reason it is here
// (backend/start-of-day-in-zone, backend/degenerate-midnight-corpus).
const ZONE_CORPUS: Array<{ tz: string; why: string }> = [
  { tz: 'America/Asuncion', why: 'naive offset arithmetic broke here (16/418): transition at/near local midnight' },
  { tz: 'America/Santiago', why: 'naive offset arithmetic broke here (16/418)' },
  { tz: 'America/Sao_Paulo', why: 'naive offset arithmetic broke here (16/418)' },
  { tz: 'America/Havana', why: 'naive offset arithmetic broke here (16/418); spec named it a repeat, measured: it is a skip' },
  { tz: 'America/Cuiaba', why: 'naive offset arithmetic broke here (16/418)' },
  { tz: 'America/Punta_Arenas', why: 'naive offset arithmetic broke here (16/418)' },
  { tz: 'America/Campo_Grande', why: 'naive offset arithmetic broke here (16/418)' },
  { tz: 'America/Coyhaique', why: 'naive offset arithmetic broke here (16/418)' },
  { tz: 'America/Scoresbysund', why: '@date-fns/tz broke here (7/418): returned a start AFTER the instant' },
  { tz: 'Asia/Gaza', why: '@date-fns/tz broke here (7/418)' },
  { tz: 'Asia/Hebron', why: '@date-fns/tz broke here (7/418)' },
  { tz: 'Asia/Amman', why: '@date-fns/tz broke here (7/418)' },
  { tz: 'Atlantic/Azores', why: '@date-fns/tz broke here (7/418)' },
  { tz: 'Antarctica/Vostok', why: '@date-fns/tz broke here (7/418)' },
  { tz: 'Antarctica/Casey', why: 'a 3-hour jump in one step, producing 21h and 27h days -- kills `endExclusive = start + 24h` (M4)' },
  { tz: 'Africa/Cairo', why: 'the 25h day that already cost a blocker in this repo (nutrition-merge-window.test.ts)' },
  { tz: 'America/Argentina/Buenos_Aires', why: "the app's real user zone, and the alias supportedValuesOf('timeZone') rejects" },
  { tz: 'UTC', why: 'the control -- and the process clock in production' },
  { tz: 'Pacific/Chatham', why: 'a +12:45 offset -- kills anything that assumes whole hours' },
  { tz: 'Asia/Kathmandu', why: 'a +05:45 offset' },
  { tz: 'Asia/Calcutta', why: 'a +05:30 offset' },
  { tz: 'Pacific/Apia', why: 'skipped an entire calendar day crossing the date line in 2011' },
  { tz: 'Pacific/Kiritimati', why: 'the extreme, +14 -- pins the bisection bounds' },
];

describe.each(ZONE_CORPUS)('day boundary invariants in $tz ($why)', ({ tz }) => {
  it('start <= instant; start lands on the target date; start-1ms does not; days tesellate', () => {
    const violations = checkZone(tz, 2015, 2035);
    expect(violations).toEqual([]);
  });
});

describe('literal day windows (measured, not asserted from the function under test)', () => {
  /**
   * Spec R1's own scenario: Buenos Aires does not observe DST since 2009, so
   * this is the "boring" 24h case -- both a 15:00 and a 22:00 local instant
   * on the 5th must resolve to the SAME window, which is the fact the
   * dashboard fix (PR2) depends on to stop showing two different "today"
   * totals from two different clocks.
   */
  it('places two same-local-day instants (15:00 and 22:00 in Buenos Aires) in the same window', () => {
    const tz = 'America/Argentina/Buenos_Aires';
    const at1500 = new Date('2025-06-05T18:00:00.000Z');
    const at2200 = new Date('2025-06-06T01:00:00.000Z');
    const expected = {
      start: new Date('2025-06-05T03:00:00.000Z'),
      endExclusive: new Date('2025-06-06T03:00:00.000Z'),
    };

    expect(dayWindowInZone(at1500, tz)).toEqual(expected);
    expect(dayWindowInZone(at2200, tz)).toEqual(expected);
  });

  /**
   * The exact window `nutrition-merge-window.test.ts` already pins as the
   * literal output of this route's own client-side `dayBounds()` for
   * Africa/Cairo's 2026-10-29 fall-back -- reused here, not re-derived, so
   * the two suites cannot silently drift apart on what a 25-hour day is.
   */
  it('produces a 25-hour window for the Cairo day that falls back', () => {
    const window = dayWindowInZone(new Date('2026-10-29T12:00:00.000Z'), 'Africa/Cairo');

    expect(window).toEqual({
      start: new Date('2026-10-28T21:00:00.000Z'),
      endExclusive: new Date('2026-10-29T22:00:00.000Z'),
    });
    expect(window.endExclusive.getTime() - window.start.getTime()).toBe(25 * 60 * 60 * 1000);
  });

  /**
   * Antarctica/Casey moved its clock forward 3 hours in one step on
   * 2016-10-22 (UTC+8 -> UTC+11): the day the jump lands in is 21 hours wide
   * and starts at 03:00 LOCAL, not 00:00 -- the hours 00:00-02:59 never
   * happened. `endExclusive = start + 24h` (M4) would land three hours
   * inside the following day instead of at its start.
   */
  it('produces a 21-hour window starting at 03:00 local for the Casey day that jumps forward 3h', () => {
    const instant = new Date('2016-10-22T12:00:00.000Z');
    const window = dayWindowInZone(instant, 'Antarctica/Casey');

    expect(window).toEqual({
      start: new Date('2016-10-21T16:00:00.000Z'),
      endExclusive: new Date('2016-10-22T13:00:00.000Z'),
    });
    expect(window.endExclusive.getTime() - window.start.getTime()).toBe(21 * 60 * 60 * 1000);

    const localHour = new Intl.DateTimeFormat('en-US', {
      timeZone: 'Antarctica/Casey', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    }).format(window.start);
    expect(localHour).toBe('03:00');
  });

  /** The same station's later reversion (2018-03-11, UTC+11 -> UTC+8): the day loses the 3 hours back, becoming 27h wide. */
  it('produces a 27-hour window for the Casey day that jumps backward 3h', () => {
    const window = dayWindowInZone(new Date('2018-03-11T12:00:00.000Z'), 'Antarctica/Casey');

    expect(window).toEqual({
      start: new Date('2018-03-10T13:00:00.000Z'),
      endExclusive: new Date('2018-03-11T16:00:00.000Z'),
    });
    expect(window.endExclusive.getTime() - window.start.getTime()).toBe(27 * 60 * 60 * 1000);
  });

  /**
   * Consecutive days share their boundary exactly: the 21h day's
   * `endExclusive` above IS the following day's `start`, reached here from a
   * SEPARATE call with a SEPARATE instant, not by construction. This is what
   * a mutant that computes `endExclusive` some other way (M4, M5) breaks.
   */
  it('tesellates: the 21h Casey day ends exactly where the next one starts', () => {
    const day = dayWindowInZone(new Date('2016-10-22T12:00:00.000Z'), 'Antarctica/Casey');
    const nextDay = dayWindowInZone(new Date('2016-10-23T12:00:00.000Z'), 'Antarctica/Casey');

    expect(day.endExclusive).toEqual(nextDay.start);
  });
});

describe('isoWeekWindowInZone', () => {
  /**
   * M9: computing the week as `start - 7*24h` instead of the calendar-first
   * Monday-to-Monday walk (D4). Measured: the week containing Santiago's
   * 2016-08-14 transition is 167 HOURS wide, not 168 -- `start + 7*24h`
   * lands an hour past the real boundary. Picked over Buenos Aires on
   * purpose: BA has not observed DST since 2009, so its weeks are always
   * exactly 168h and would not distinguish the correct calendar walk from
   * the naive one.
   */
  it('a week crossing a DST transition is not exactly 168 hours wide', () => {
    const window = isoWeekWindowInZone(new Date('2016-08-14T12:00:00.000Z'), 'America/Santiago');

    expect(window).toEqual({
      start: new Date('2016-08-08T04:00:00.000Z'),
      endExclusive: new Date('2016-08-15T03:00:00.000Z'),
    });
    expect(window.endExclusive.getTime() - window.start.getTime()).toBe(167 * 60 * 60 * 1000);
  });

  it('always starts on a Monday, in the zone it was asked about', () => {
    for (const { tz } of ZONE_CORPUS) {
      const window = isoWeekWindowInZone(new Date('2026-07-30T12:00:00.000Z'), tz);
      const weekday = new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short' }).format(window.start);
      expect(weekday, tz).toBe('Mon');
    }
  });
});

/**
 * M13, CORRECTED against the measured corpus: no real IANA zone repeats
 * local midnight between 2015 and 2035 (backend/degenerate-midnight-corpus
 * -- 19 zones SKIP it, 0 repeat it). The guard for "first occurrence wins"
 * has no real zone to exercise it, so this DECLARES the invariant with a
 * hand-built clock instead of pretending some zone measures it.
 *
 * The construction is adversarial on purpose: the fall-back transition sits
 * BEFORE the naive `Date.UTC(y, m, d)` guess for the affected date, not
 * after it -- the arrangement every real DST rule found in this sweep
 * happens to avoid, because real transitions are timed either by a fixed UTC
 * hour that falls after a small positive offset's midnight, or by a local
 * hour nowhere near midnight. A candidate-selection step that reads the
 * zone's offset only AT the guess itself (instead of a known-safe point
 * before it) silently returns the SECOND midnight in exactly this
 * arrangement -- proven by running both versions against this exact input
 * before writing the fix (see apply-progress). That silent wrong answer is
 * what M13 exists to kill.
 */
describe('the repeated-midnight guard (M13) -- a DECLARED invariant, not a measured zone', () => {
  const FAKE_TZ = 'Synthetic/RepeatsMidnight';
  const OFFSET_BEFORE_MS = 60 * 60 * 1000; // +1h
  const OFFSET_AFTER_MS = 0; // +0h
  const GUESS = Date.UTC(2030, 5, 15, 0, 0, 0); // Date.UTC(D) for the affected date
  const TRANSITION = GUESS - 30 * 60 * 1000; // BEFORE the guess -- the adversarial part
  const FIRST_MIDNIGHT = GUESS - OFFSET_BEFORE_MS; // the correct answer
  const SECOND_MIDNIGHT = GUESS; // what a guess-only seed silently returns instead

  function offsetAt(ms: number): number {
    return ms < TRANSITION ? OFFSET_BEFORE_MS : OFFSET_AFTER_MS;
  }

  function installFakeZone() {
    const RealDateTimeFormat = Intl.DateTimeFormat;
    // `function`, not an arrow: vi.spyOn's mock replaces a constructor
    // (`new Intl.DateTimeFormat(...)`), and only a real function is `new`-able.
    return vi.spyOn(Intl, 'DateTimeFormat').mockImplementation(function (
      this: unknown,
      locale?: string | string[],
      options?: Intl.DateTimeFormatOptions
    ) {
      if (!options || options.timeZone !== FAKE_TZ) {
        return new RealDateTimeFormat(locale, options);
      }
      return {
        formatToParts(date: Date) {
          const local = new Date(date.getTime() + offsetAt(date.getTime()));
          return [
            { type: 'year', value: String(local.getUTCFullYear()) },
            { type: 'month', value: String(local.getUTCMonth() + 1).padStart(2, '0') },
            { type: 'day', value: String(local.getUTCDate()).padStart(2, '0') },
            { type: 'hour', value: String(local.getUTCHours()).padStart(2, '0') },
            { type: 'minute', value: String(local.getUTCMinutes()).padStart(2, '0') },
            { type: 'second', value: String(local.getUTCSeconds()).padStart(2, '0') },
          ];
        },
      } as unknown as Intl.DateTimeFormat;
    } as never);
  }

  it('resolves the day to the FIRST midnight, not the second one the naive guess lands on', () => {
    const spy = installFakeZone();
    try {
      const window = dayWindowInZone(new Date(SECOND_MIDNIGHT), FAKE_TZ);
      expect(window.start.getTime()).toBe(FIRST_MIDNIGHT);
      expect(window.start.getTime()).not.toBe(SECOND_MIDNIGHT);
    } finally {
      spy.mockRestore();
    }
  });
});

describe('assertIanaZone', () => {
  it('accepts a canonical IANA identifier', () => {
    expect(assertIanaZone('UTC', 'tz')).toBe('UTC');
  });

  it('accepts the alias supportedValuesOf rejects but is the real user zone (backend/timezone-validation)', () => {
    // The point of this test is that the alias is ACCEPTED -- a
    // `supportedValuesOf('timeZone')` Set.has() check would reject the app's
    // own user zone. What comes BACK is now the canonical short alias (see
    // zone-formatter-cache.test.ts for why), so the second assertion pins
    // that the rename is semantically a no-op rather than taking it on faith.
    expect(assertIanaZone('America/Argentina/Buenos_Aires', 'tz')).toBe('America/Buenos_Aires');

    const at = new Date('2025-06-05T18:00:00.000Z');
    expect(dayWindowInZone(at, 'America/Argentina/Buenos_Aires'))
      .toEqual(dayWindowInZone(at, 'America/Buenos_Aires'));
  });

  it('rejects a value that is not a string (duplicate query params parse as an array)', () => {
    expect(() => assertIanaZone(['a', 'b'], 'tz')).toThrow(/tz/);
  });

  it('rejects the bare offset syntax -- Intl accepts it, but it has no DST', () => {
    expect(() => assertIanaZone('-03:00', 'tz')).toThrow(/tz/);
    expect(() => assertIanaZone('+05:30', 'tz')).toThrow(/tz/);
  });

  it('rejects an identifier Intl does not recognise', () => {
    expect(() => assertIanaZone('Nope/Nope', 'tz')).toThrow(/tz/);
  });

  it('never echoes the rejected value back', () => {
    expect(() => assertIanaZone('__totally_bogus_zone__', 'tz')).toThrow(/tz/);

    let message = '';
    try {
      assertIanaZone('__totally_bogus_zone__', 'tz');
    } catch (err) {
      message = (err as Error).message;
    }
    // A message that merely FAILED TO THROW WITH A MESSAGE AT ALL would also
    // vacuously satisfy "does not contain the bogus value" -- the toThrow
    // above rules that out before this checks the disclosure itself.
    expect(message).not.toContain('__totally_bogus_zone__');
  });
});

describe('formatLocalDate', () => {
  // M21: a hand-rolled `${month}-${day}` without zero-padding produces
  // '2026-8-5' instead of '2026-08-05' -- any assertion against a literal
  // bucket key would silently never match.
  it('zero-pads single-digit month and day', () => {
    expect(formatLocalDate({ year: 2026, month: 8, day: 5 })).toBe('2026-08-05');
  });

  it('does not zero-pad double-digit month and day (regression against over-padding)', () => {
    expect(formatLocalDate({ year: 2026, month: 12, day: 25 })).toBe('2026-12-25');
  });

  it('rejects a hand-built key missing zero-padding as a literal match', () => {
    expect(formatLocalDate({ year: 2026, month: 8, day: 5 })).not.toBe('2026-8-5');
  });
});

describe('resolveIanaZone', () => {
  it('returns the canonical zone for an explicit valid value', () => {
    expect(resolveIanaZone('America/Argentina/Buenos_Aires')).toBe('America/Buenos_Aires');
  });

  it('falls back to the process zone when raw is undefined', () => {
    expect(resolveIanaZone(undefined)).toBe(Intl.DateTimeFormat().resolvedOptions().timeZone);
  });

  it('throws, naming the field, for an invalid value (delegates to assertIanaZone)', () => {
    expect(() => resolveIanaZone('Nope/Nope')).toThrow(/tz/);
  });
});
