import { describe, it, expect, vi, afterEach } from 'vitest';
import { assertIanaZone, localDateInZone, dayWindowInZone } from '../lib/date';

/**
 * Two changes that only make sense TOGETHER, which is why they share a file.
 *
 * `date.ts` builds an `Intl.DateTimeFormat` on every `localDateInZone` and
 * every `offsetMs`. MEASURED on this Node: constructing one costs 0.057ms,
 * reusing one costs 0.010ms, and a single `GET /api/dashboard` builds 19 of
 * them -- about 1.15ms of synchronous event-loop CPU per request, against
 * 0.0002ms for the `setHours` arithmetic it replaced. V8 does NOT cache the
 * constructor when options are passed, so caching has to happen here.
 *
 * But a cache is only as bounded as its key, and the key is a zone the CALLER
 * supplies. `Intl` matches zone names case-insensitively, so `utc`, `Utc`,
 * `uTc`... are 2^n spellings of one zone. Returning the CANONICAL name from
 * `assertIanaZone` collapses them to one key before anything gets cached.
 * That is the whole coupling: memoising without canonicalising first turns an
 * optimisation into unbounded growth driven by attacker-controlled input.
 */

/**
 * Counts `Intl.DateTimeFormat` constructions while still building real ones.
 * Must be a `function`, never an arrow: the spy replaces a constructor and
 * has to be `new`-able (the same trap PR1's M13 test documents).
 */
function countingFormatters() {
  const real = Intl.DateTimeFormat;
  let built = 0;
  const spy = vi.spyOn(Intl, 'DateTimeFormat').mockImplementation(function (
    this: unknown,
    ...args: unknown[]
  ) {
    built++;
    return new (real as unknown as new (...a: unknown[]) => Intl.DateTimeFormat)(...args);
  } as unknown as typeof Intl.DateTimeFormat);
  return { built: () => built, restore: () => spy.mockRestore() };
}

afterEach(() => vi.restoreAllMocks());

describe('assertIanaZone returns the canonical zone, not the spelling it was sent', () => {
  // Measured against this Node's Intl, not hand-derived.
  it.each([
    ['utc', 'UTC'],
    ['UTC', 'UTC'],
    ['AMERICA/new_york', 'America/New_York'],
    ['america/argentina/buenos_aires', 'America/Buenos_Aires'],
    // The app's own user zone: accepted (supportedValuesOf would reject it),
    // and canonicalised to the SHORT alias. Same zone, identical windows --
    // but one key instead of two, and one spelling in any future log.
    ['America/Argentina/Buenos_Aires', 'America/Buenos_Aires'],
    // Already canonical, so canonicalising must be a no-op, not a rewrite.
    ['Etc/GMT+12', 'Etc/GMT+12'],
    ['Asia/Tokyo', 'Asia/Tokyo'],
  ])('%s -> %s', (raw, canonical) => {
    expect(assertIanaZone(raw, 'tz')).toBe(canonical);
  });

  it('is idempotent: canonicalising its own output changes nothing', () => {
    const once = assertIanaZone('America/Argentina/Buenos_Aires', 'tz');
    expect(assertIanaZone(once, 'tz')).toBe(once);
  });

  it('still rejects everything it rejected before, without echoing the input', () => {
    for (const bad of ['-03:00', 'Nope/Nope', '', 'America/New_York\n']) {
      expect(() => assertIanaZone(bad, 'tz')).toThrow(/tz/);
    }
  });
});

describe('formatters are built once per zone, then reused', () => {
  it('builds nothing new on a repeat call for a zone already seen', () => {
    // Warm the cache OUTSIDE the spy, so the count reflects steady state --
    // the state a served request actually runs in -- not a cold first hit.
    dayWindowInZone(new Date('2026-08-06T12:00:00Z'), 'Asia/Tokyo');

    const spy = countingFormatters();
    dayWindowInZone(new Date('2026-08-07T12:00:00Z'), 'Asia/Tokyo');
    const built = spy.built();
    spy.restore();

    // Before caching this was 9 per dayWindowInZone call.
    expect(built).toBe(0);
  });

  it('still answers identically whether the formatter was cached or fresh', () => {
    const at = new Date('2026-10-29T12:00:00Z');
    const cold = dayWindowInZone(at, 'Africa/Cairo');
    const warm = dayWindowInZone(at, 'Africa/Cairo');
    expect(warm).toEqual(cold);
    // The 25h Cairo fall-back day, pinned in day-window-in-zone.test.ts --
    // repeated here so a cache that quietly returned a stale window could not
    // pass by merely being self-consistent.
    expect(warm).toEqual({
      start: new Date('2026-10-28T21:00:00.000Z'),
      endExclusive: new Date('2026-10-29T22:00:00.000Z'),
    });
  });
});

describe('the cache defends its own bound', () => {
  /** Flips the case of `base`'s letters per the bits of `n`. */
  function spelling(base: string, n: number): string {
    const chars = [...base];
    const letters = chars.map((c, i) => (/[a-z]/i.test(c) ? i : -1)).filter((i) => i >= 0);
    letters.forEach((pos, bit) => {
      if (bit < 30) chars[pos] = n & (1 << bit) ? chars[pos].toUpperCase() : chars[pos].toLowerCase();
    });
    return chars.join('');
  }

  it('drops what it holds rather than growing without limit on unvalidated zones', () => {
    // `localDateInZone` is exported and takes a bare string: a future caller
    // could reach it WITHOUT going through assertIanaZone. Canonicalising at
    // the route is the first line of defence; this is the second, kept local
    // to the cache so it does not depend on a precondition three files away.
    localDateInZone(new Date(), 'Pacific/Auckland');

    const base = 'America/Argentina/Buenos_Aires';
    for (let n = 0; n < 1100; n++) {
      localDateInZone(new Date(), spelling(base, n));
    }

    // Auckland was cached before the flood. If the cache were unbounded it
    // would still be there and nothing would be rebuilt.
    const spy = countingFormatters();
    localDateInZone(new Date(), 'Pacific/Auckland');
    const built = spy.built();
    spy.restore();

    expect(built).toBeGreaterThan(0);
  });
});
