import { LocalDate, dayWindowInZone, localDateInZone, startOfLocalDate } from '../../lib/date';

/**
 * A place `startOfLocalDate` (or its derived `dayWindowInZone`) disagreed
 * with the definition it claims to implement, at a concrete zone and instant.
 */
export interface Violation {
  tz: string;
  probe: string; // ISO instant that triggered the check
  invariant: 1 | 2 | 3 | 4;
  detail: string;
}

const sameDate = (a: LocalDate, b: LocalDate) => a.year === b.year && a.month === b.month && a.day === b.day;
const fmt = (d: LocalDate) => `${d.year}-${String(d.month).padStart(2, '0')}-${String(d.day).padStart(2, '0')}`;

/**
 * offset(t) = the instant `tz`'s wall clock reads at `t`, minus `t` itself --
 * both FLOORED TO THE SECOND first.
 *
 * MEASURED GOTCHA (backend/degenerate-midnight-corpus): without the floor,
 * `t`'s own millisecond residue leaks into the offset, so comparing two
 * offsets compares that residue instead of the real DST shift, and a
 * transition search built on the comparison converges on garbage (observed:
 * transitions reported at instants like `03:56:15.659Z` instead of
 * `04:00:00.000Z`, and 0 zones flagged where 19 are degenerate).
 *
 * This is a SEPARATE implementation from `lib/date.ts`'s own offset lookup --
 * intentionally: the sweep below has to find transitions independently of
 * the primitive it is checking, not by trusting the primitive's own idea of
 * where they are.
 */
function offsetMsAt(ms: number, formatter: Intl.DateTimeFormat): number {
  const floored = Math.floor(ms / 1000) * 1000;
  const parts = formatter.formatToParts(new Date(floored));
  const get = (type: string) => Number(parts.find((p) => p.type === type)!.value);
  const wallAsUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
  return wallAsUtc - floored;
}

/** The first millisecond in (loMs, hiMs] whose offset already matches hiMs's. */
function bisectTransition(loMs: number, hiMs: number, formatter: Intl.DateTimeFormat): number {
  const target = offsetMsAt(hiMs, formatter);
  let lo = loMs;
  let hi = hiMs;
  while (hi - lo > 1) {
    const mid = Math.floor((lo + hi) / 2);
    if (offsetMsAt(mid, formatter) === target) hi = mid;
    else lo = mid;
  }
  return hi;
}

function checkInvariants(tz: string, instantMs: number, violations: Violation[]): void {
  const instant = new Date(instantMs);
  const probe = instant.toISOString();
  const date = localDateInZone(instant, tz);
  const start = startOfLocalDate(date, tz);

  // I1: the day cannot start after the instant that reported it.
  if (start.getTime() > instantMs) {
    violations.push({ tz, probe, invariant: 1, detail: `start ${start.toISOString()} is AFTER the instant it was derived from` });
  }
  // I2: start must itself read as the target date.
  if (!sameDate(localDateInZone(start, tz), date)) {
    violations.push({ tz, probe, invariant: 2, detail: `start ${start.toISOString()} does not land on ${fmt(date)}` });
  }
  // I3: start must be the FIRST such instant -- one ms earlier belongs to a different date.
  if (sameDate(localDateInZone(new Date(start.getTime() - 1), tz), date)) {
    violations.push({ tz, probe, invariant: 3, detail: `the millisecond before start is still ${fmt(date)} -- start is not minimal` });
  }
  // I4: tesellation -- today's endExclusive, reached from THIS instant, must
  // equal tomorrow's start, reached from an INDEPENDENTLY chosen instant
  // (one ms into the next window). Two separate calls agreeing is what
  // catches a mutant like `endExclusive = start + 24h` (M4): on a day that is
  // not 24h long, `start + 24h` would land somewhere INSIDE the next day
  // rather than at its start, and the two calls would disagree.
  const window = dayWindowInZone(instant, tz);
  const nextWindow = dayWindowInZone(new Date(window.endExclusive.getTime() + 1), tz);
  if (nextWindow.start.getTime() !== window.endExclusive.getTime()) {
    violations.push({
      tz, probe, invariant: 4,
      detail: `endExclusive ${window.endExclusive.toISOString()} != next day's start ${nextWindow.start.toISOString()}`,
    });
  }
}

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Sweeps `tz` from `fromYear`-01-01 to `toYear`-12-31: finds every offset
 * transition by bisection (weekly coarse pass -- no real zone shifts twice
 * inside a week, not even Casey's 3-hour jump or Apia's 2011 date-line
 * skip), and checks the 4 invariants above at each one. Zones with zero
 * transitions in range (UTC, fixed-offset zones) still get a monthly grid so
 * they are not silently vacuous.
 */
export function checkZone(tz: string, fromYear: number, toYear: number): Violation[] {
  const violations: Violation[] = [];
  const from = Date.UTC(fromYear, 0, 1, 12);
  const to = Date.UTC(toYear + 1, 0, 1, 12);
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  });

  let prevOffset = offsetMsAt(from, formatter);
  let transitionsFound = 0;
  for (let t = from + WEEK_MS; t <= to; t += WEEK_MS) {
    const offset = offsetMsAt(t, formatter);
    if (offset !== prevOffset) {
      transitionsFound += 1;
      const transition = bisectTransition(t - WEEK_MS, t, formatter);
      checkInvariants(tz, transition - 1, violations);
      checkInvariants(tz, transition, violations);
      checkInvariants(tz, transition + 1, violations);
    }
    prevOffset = offset;
  }

  if (transitionsFound === 0) {
    for (let y = fromYear; y <= toYear; y++) {
      for (let m = 0; m < 12; m++) checkInvariants(tz, Date.UTC(y, m, 15, 12), violations);
    }
  }

  return violations;
}
