import { DayOfWeek } from '@prisma/client';

/** Sunday-first, matching `Date.prototype.getUTCDay()`'s 0-6. */
const DAY_NAMES: DayOfWeek[] = ['DOMINGO', 'LUNES', 'MARTES', 'MIERCOLES', 'JUEVES', 'VIERNES', 'SABADO'];

const DAY_MS = 24 * 60 * 60 * 1000;

/** A calendar date, independent of any clock. `month` is 1-12 (not the JS 0-11). */
export interface LocalDate {
  year: number;
  month: number;
  day: number;
}

function sameLocalDate(a: LocalDate, b: LocalDate): boolean {
  return a.year === b.year && a.month === b.month && a.day === b.day;
}

function compareLocalDate(a: LocalDate, b: LocalDate): number {
  if (a.year !== b.year) return a.year - b.year;
  if (a.month !== b.month) return a.month - b.month;
  return a.day - b.day;
}

/**
 * `date`, shifted by `days` calendar days, through the UTC constructor so
 * month/year rollover (day 32, month 13) is the constructor's problem, not
 * this function's -- the same trick `endExclusive` and the week walk both
 * rely on to never hand-roll a calendar.
 */
export function addCalendarDays(date: LocalDate, days: number): LocalDate {
  const t = new Date(Date.UTC(date.year, date.month - 1, date.day + days));
  return { year: t.getUTCFullYear(), month: t.getUTCMonth() + 1, day: t.getUTCDate() };
}

/** `date` as `yyyy-MM-dd`, zero-padded. The only correct way to turn a
 * `LocalDate` into a bucket key: `date-fns`'s `format` reads the PROCESS
 * zone, which is the m8 bug written a different way. */
export function formatLocalDate(date: LocalDate): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.year}-${pad(date.month)}-${pad(date.day)}`;
}

/**
 * Formatters, kept per zone. MEASURED on this Node: building one costs
 * 0.057ms and reusing one costs 0.010ms, and a single `GET /api/dashboard`
 * built 19 of them -- roughly 1.15ms of synchronous event-loop CPU per
 * request, against 0.0002ms for the `setHours` arithmetic this module
 * replaced. V8 does not cache the constructor once options are passed, so it
 * has to happen here.
 *
 * The cap is not a memory-pressure knob: `Intl` matches zone names
 * case-insensitively, so `utc`/`Utc`/`uTc` are 2^n spellings of ONE zone and
 * the key comes from the caller. `assertIanaZone` collapses them by returning
 * the canonical name, which is the real fix -- but these functions are
 * exported and take a bare string, so a future caller could reach them
 * without that. Clearing is always correct here: this is an optimisation,
 * never a source of truth.
 */
const FORMATTER_CACHE_CAP = 1000;

function formatterFor(
  cache: Map<string, Intl.DateTimeFormat>,
  tz: string,
  build: () => Intl.DateTimeFormat
): Intl.DateTimeFormat {
  const hit = cache.get(tz);
  if (hit !== undefined) return hit;
  if (cache.size >= FORMATTER_CACHE_CAP) cache.clear();
  const fresh = build();
  cache.set(tz, fresh);
  return fresh;
}

const dateFormatters = new Map<string, Intl.DateTimeFormat>();
const wallClockFormatters = new Map<string, Intl.DateTimeFormat>();

/** The calendar date `instant` falls on when read through `tz`'s wall clock. */
export function localDateInZone(instant: Date, tz: string): LocalDate {
  const parts = formatterFor(dateFormatters, tz, () => new Intl.DateTimeFormat('en-US', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
  })).formatToParts(instant);
  const get = (type: string) => Number(parts.find((p) => p.type === type)!.value);
  return { year: get('year'), month: get('month'), day: get('day') };
}

/**
 * The weekday `instant` falls on when read through `tz`'s wall clock.
 *
 * Replaces the process-clock `getCurrentDayOfWeekServer()` that slices 1-3
 * left behind: a weekday enum is a DIFFERENT mechanism from a day window, and
 * it was the last thing in the API still answering from the server's calendar.
 *
 * Derived from `localDateInZone` rather than a `weekday` formatter of its own:
 * the calendar date already determines the weekday, so a second formatter
 * would be a second cache entry per zone (and a locale-dependent string to
 * parse) for an answer the first one already contains. `Date.UTC` is used
 * purely as a civil-calendar-to-weekday function here -- no zone, no offset,
 * no DST can reach it, because a calendar date has no clock.
 */
export function dayOfWeekInZone(instant: Date, tz: string): DayOfWeek {
  const { year, month, day } = localDateInZone(instant, tz);
  return DAY_NAMES[new Date(Date.UTC(year, month - 1, day)).getUTCDay()]!;
}

/**
 * offset(t) = the instant `tz`'s wall clock reads at `t`, minus `t` itself --
 * both FLOORED TO THE SECOND first.
 *
 * MEASURED GOTCHA (backend/degenerate-midnight-corpus): without the floor,
 * `t`'s own millisecond residue leaks into the offset, so comparing two
 * offsets compares that residue instead of the real DST shift.
 */
function offsetMs(t: Date, tz: string): number {
  const floored = Math.floor(t.getTime() / 1000) * 1000;
  const parts = formatterFor(wallClockFormatters, tz, () => new Intl.DateTimeFormat('en-US', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  })).formatToParts(new Date(floored));
  const get = (type: string) => Number(parts.find((p) => p.type === type)!.value);
  const wallAsUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
  return wallAsUtc - floored;
}

/**
 * min { t : localDateInZone(t, tz) === date } -- the first instant whose
 * local date in `tz` is `date`. Propose-and-VERIFY (design D2), not offset
 * arithmetic trusted blindly: the predicate below IS the definition, so both
 * degenerate cases stop being special-cased.
 *
 * The seed for the first candidate reads the zone's offset a full day BEFORE
 * `date`'s raw UTC midnight, not AT it. Reading at the raw midpoint itself
 * can silently land past a fall-back that should have been read from
 * before: proven with a hand-built zone in day-window-in-zone.test.ts's M13
 * suite, where seeding from `date` directly returns the SECOND occurrence of
 * a repeated local midnight instead of the first. Seeding from a day
 * earlier costs nothing in the well-behaved case (no transition in the
 * interim, same offset either way) and fixes the adversarial one.
 */
export function startOfLocalDate(date: LocalDate, tz: string): Date {
  const guess = Date.UTC(date.year, date.month - 1, date.day);

  const seedOffset = offsetMs(new Date(guess - DAY_MS), tz);
  const c1 = new Date(guess - seedOffset);
  const c2 = new Date(guess - offsetMs(c1, tz));

  const accepts = (c: Date) =>
    sameLocalDate(localDateInZone(c, tz), date) &&
    !sameLocalDate(localDateInZone(new Date(c.getTime() - 1), tz), date);

  const candidates = [c1, c2].sort((a, b) => a.getTime() - b.getTime());
  for (const c of candidates) {
    if (accepts(c)) return c;
  }

  // Bisection fallback: reached ONLY when local midnight was SKIPPED (a
  // forward jump crossed it, so no instant reads as this exact date's
  // 00:00:00.000). Safe here and only here: a forward jump makes the local
  // date monotonic across the gap, so "localDate(t) >= date" has exactly one
  // crossing, which is the instant the day begins. Bounds of +-26h cover
  // every real UTC offset (-12:00..+14:00) with room to spare.
  let lo = guess - 26 * 60 * 60 * 1000;
  let hi = guess + 26 * 60 * 60 * 1000;
  while (hi - lo > 1) {
    const mid = Math.floor((lo + hi) / 2);
    if (compareLocalDate(localDateInZone(new Date(mid), tz), date) >= 0) hi = mid;
    else lo = mid;
  }
  return new Date(hi);
}

/**
 * The semi-open window `[start, endExclusive)` covering `instant`'s local
 * date in `tz`. `endExclusive` comes from the NEXT CALENDAR DATE, never
 * `start + 24h`: real local days run from 21 to 27 hours (Antarctica/Casey
 * shifts 3 hours in one step), and `+24h` lands inside the following day
 * instead of at its start.
 */
export function dayWindowInZone(instant: Date, tz: string): { start: Date; endExclusive: Date } {
  const date = localDateInZone(instant, tz);
  return {
    start: startOfLocalDate(date, tz),
    endExclusive: startOfLocalDate(addCalendarDays(date, 1), tz),
  };
}

/**
 * The semi-open window `[start, endExclusive)` covering `instant`'s ISO
 * week (Monday-first) in `tz`. Calendar first, zone second (design D4): the
 * Monday is found by pure calendar arithmetic, then each end of the week is
 * resolved through `startOfLocalDate` -- never `start - 7*24h`, since a
 * week that crosses a transition is not exactly 168 hours (M9).
 */
export function isoWeekWindowInZone(instant: Date, tz: string): { start: Date; endExclusive: Date } {
  const date = localDateInZone(instant, tz);
  const dow = new Date(Date.UTC(date.year, date.month - 1, date.day)).getUTCDay(); // 0=Sun..6=Sat
  const daysSinceMonday = (dow + 6) % 7;
  const monday = addCalendarDays(date, -daysSinceMonday);
  const nextMonday = addCalendarDays(monday, 7);
  return {
    start: startOfLocalDate(monday, tz),
    endExclusive: startOfLocalDate(nextMonday, tz),
  };
}

const IANA_ZONE_SHAPE = /^[A-Za-z_]+(?:\/[A-Za-z0-9_+-]+)*$/;

/**
 * Validates a caller-supplied `tz`, returning the CANONICAL zone name on
 * success and throwing an `Error` naming `field` (never echoing the raw
 * value) on failure. Three filters, in order (design D5):
 *   1. must be a string (express parses `?tz=a&tz=b` as an array)
 *   2. must look like an IANA identifier -- MEASURED: `Intl.DateTimeFormat`
 *      also accepts the bare offset syntax `-03:00` / `+05:30`, which has no
 *      DST and would silently produce wrong boundaries for anyone in a zone
 *      that observes one; no real browser ever sends one
 *      (`resolvedOptions().timeZone` always returns an IANA name).
 *      This filter rejects that SYNTAX, not fixed-offset zones as a class:
 *      MEASURED, `Etc/GMT+12` and `Etc/GMT-14` still pass, since they are
 *      shaped like ordinary identifiers. Harmless -- a caller who sends one
 *      only skews their own numbers -- but do not read this as a guarantee
 *      that no fixed offset gets through.
 *   3. must be a zone `Intl.DateTimeFormat` actually recognises
 *
 * Deliberately NOT validated against `Intl.supportedValuesOf('timeZone')`:
 * MEASURED (backend/timezone-validation), it returns only canonical names,
 * and the canonical spelling is the SHORT alias -- `America/Buenos_Aires`,
 * not `America/Argentina/Buenos_Aires`, which is the app's real user zone.
 * A `Set.has()` check would reject it.
 */
export function assertIanaZone(raw: unknown, field: string): string {
  const invalid = () => new Error(`${field} must be a valid IANA time zone identifier, e.g. America/Argentina/Buenos_Aires`);

  if (typeof raw !== 'string') throw invalid();
  if (!IANA_ZONE_SHAPE.test(raw)) throw invalid();
  try {
    // The probe's own answer is the canonical name, so keep it instead of
    // throwing it away and returning the caller's spelling. `Intl` matches
    // zone names case-insensitively -- `utc`, `Utc`, `uTc` all resolve to
    // `UTC` -- so without this every caller-chosen casing is a distinct
    // string for anything downstream that keys on it (the formatter cache
    // above, a metric label, a log field, a stored column). MEASURED:
    // `America/Argentina/Buenos_Aires` canonicalises to the short alias
    // `America/Buenos_Aires`. Same zone, identical windows, one spelling.
    return new Intl.DateTimeFormat('en-US', { timeZone: raw }).resolvedOptions().timeZone;
  } catch {
    throw invalid();
  }
}

/**
 * Resolves the caller-supplied `tz` query value into a validated IANA zone
 * name: `undefined` (param absent) falls back to the process zone, resolved
 * FRESH on every call (never cache this at module scope -- M10); anything
 * else goes through `assertIanaZone` and either returns the canonical name
 * or throws. `field` is hardcoded to `'tz'`: all 6 call sites use that name,
 * so a parameter with one possible value is a constant, not config.
 */
export function resolveIanaZone(raw: unknown): string {
  return raw === undefined
    ? Intl.DateTimeFormat().resolvedOptions().timeZone
    : assertIanaZone(raw, 'tz');
}
