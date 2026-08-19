import { prisma } from '../lib/prisma';
import { SetType } from '@prisma/client';
import { addCalendarDays, formatLocalDate, isoWeekWindowInZone, localDateInZone, startOfLocalDate } from '../lib/date';

const TOP_SET_TYPES: SetType[] = ['TOP', 'WORKING', 'BACKOFF', 'AMRAP'];
const E1RM_MAX_REPS = 12;

export function epleyE1RM(weightKg: number, reps: number): number | null {
  if (reps < 1 || reps > E1RM_MAX_REPS || weightKg <= 0) return null;
  return weightKg * (1 + reps / 30);
}

export async function getExerciseProgression(
  userId: string,
  exerciseId: string,
  opts: { from?: Date; to?: Date; limit?: number } = {}
) {
  const sessions = await prisma.workoutSession.findMany({
    where: {
      userId,
      ...(opts.from || opts.to ? { startedAt: { ...(opts.from && { gte: opts.from }), ...(opts.to && { lte: opts.to }) } } : {}),
      sets: { some: { exerciseId } },
    },
    // `id` after `setNumber` because nothing constrains `setNumber` to be
    // unique within a session, and these sets are now rendered one by one
    // rather than only aggregated -- a tie would reshuffle the rows the user
    // reads.
    include: { sets: { where: { exerciseId }, orderBy: [{ setNumber: 'asc' }, { id: 'asc' }] } },
    // DESCENDING, then reversed below. `take` cuts this list, and a progression
    // is read to answer "am I getting stronger", so the end of the series is
    // the part that must survive the cut. Ascending kept the OLDEST `limit`
    // sessions instead: past 50 sessions of one exercise the chart froze months
    // in the past and never moved again, however much the user trained.
    //
    // Total order for the same reason as everywhere else -- two sessions
    // sharing a `startedAt` at the cut-off would make it undefined which one
    // the progression is computed from.
    orderBy: [{ startedAt: 'desc' }, { id: 'desc' }],
    take: opts.limit ?? 50,
  });

  // Oldest-first for the caller: a chart reads left to right, and reversing a
  // `[desc, desc]` order yields `[asc, asc]`, which is just as total.
  return [...sessions].reverse().map((session) => {
    const workSets = session.sets.filter((set) => set.setType !== 'WARMUP');
    const topCandidates = session.sets.filter((set) => TOP_SET_TYPES.includes(set.setType));
    const e1rms = workSets
      .map((set) => epleyE1RM(set.weightKg, set.reps))
      .filter((value): value is number => value !== null);

    return {
      sessionId: session.id,
      date: session.startedAt.toISOString(),
      topSetWeight: topCandidates.length > 0 ? Math.max(...topCandidates.map((set) => set.weightKg)) : null,
      e1rm: e1rms.length > 0 ? Math.round(Math.max(...e1rms) * 10) / 10 : null,
      volume: workSets.reduce((sum, set) => sum + set.weightKg * set.reps, 0),
      // The round trip already carried these -- the map used to drop them, so
      // the history sheet had no way to show a session set by set without a
      // second query for data that was already in hand. Warmups included:
      // aggregates exclude them, a history does not, since the user logged them.
      // Spelled out field by field rather than passed through, so the wire shape
      // is a decision here and not whatever columns the table happens to grow.
      sets: session.sets.map((set) => ({
        setNumber: set.setNumber,
        weightKg: set.weightKg,
        reps: set.reps,
        setType: set.setType,
      })),
    };
  });
}

export async function getExercisePRs(userId: string, exerciseId: string) {
  const sets = await prisma.workoutSet.findMany({
    where: { exerciseId, session: { userId }, setType: { not: 'WARMUP' } },
    include: { session: { select: { id: true } } },
  });
  // Sort by set.createdAt (immutable) rather than session.startedAt: the reopen-today path
  // (workouts.service.ts) mutates session.startedAt to "now", which would silently reorder
  // and drop earlier PRs if used as the sort/date key here.
  sets.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.setNumber - b.setNumber);

  let bestWeight = 0;
  let bestE1RM = 0;
  const weightPRs: Array<{ weightKg: number; reps: number; date: string; sessionId: string }> = [];
  const e1rmPRs: Array<{ e1rm: number; weightKg: number; reps: number; date: string; sessionId: string }> = [];
  const bestRepsAtWeight = new Map<number, { reps: number; date: string; sessionId: string }>();

  for (const set of sets) {
    const date = set.createdAt.toISOString();
    if (set.weightKg > bestWeight) {
      bestWeight = set.weightKg;
      weightPRs.push({ weightKg: set.weightKg, reps: set.reps, date, sessionId: set.session.id });
    }
    const e1rm = epleyE1RM(set.weightKg, set.reps);
    if (e1rm !== null && e1rm > bestE1RM) {
      bestE1RM = e1rm;
      e1rmPRs.push({ e1rm: Math.round(e1rm * 10) / 10, weightKg: set.weightKg, reps: set.reps, date, sessionId: set.session.id });
    }
    const previous = bestRepsAtWeight.get(set.weightKg);
    if (!previous || set.reps > previous.reps) {
      bestRepsAtWeight.set(set.weightKg, { reps: set.reps, date, sessionId: set.session.id });
    }
  }

  const repPRs = [...bestRepsAtWeight.entries()]
    .map(([weightKg, value]) => ({ weightKg, ...value }))
    .sort((a, b) => a.weightKg - b.weightKg);

  return { weightPRs, e1rmPRs, repPRs };
}

// Bucketed by set.createdAt (immutable), matching getExercisePRs above. session.startedAt is
// mutated by the reopen-today path (workouts.service.ts ~L74-89), so bucketing by it would
// misattribute a reopened session's sets into the week the reopen happened in rather than the
// week they were originally logged in. The window filter below also queries on set.createdAt
// (not session.startedAt) so a reopened session's older sets aren't excluded from the range.
export async function getWeeklyVolume(userId: string, weeks: number, tz: string) {
  // Floor aligned to the Monday of `weeks-1` weeks before the CURRENT week's Monday, by
  // calendar arithmetic in `tz` (D8) -- never `week.start - (weeks-1)*7*24h`, since a week
  // that crosses a transition is not exactly 168 hours (M9, slice 1), and never "now minus
  // (weeks-1)*7 raw days" unaligned (mutant m14): the Monday-snap step below is what m14 guards.
  const currentWeek = isoWeekWindowInZone(new Date(), tz);
  const monday = localDateInZone(currentWeek.start, tz);
  const floor = startOfLocalDate(addCalendarDays(monday, -(weeks - 1) * 7), tz);

  const sets = await prisma.workoutSet.findMany({
    where: {
      session: { userId },
      setType: { not: 'WARMUP' },
      createdAt: { gte: floor, lt: currentWeek.endExclusive },
    },
    include: {
      exercise: { select: { primaryMuscles: true } },
    },
  });

  const byWeek: Record<string, Record<string, { hardSets: number; volume: number }>> = {};
  for (const set of sets) {
    const weekKey = formatLocalDate(localDateInZone(isoWeekWindowInZone(set.createdAt, tz).start, tz));
    for (const muscle of set.exercise.primaryMuscles) {
      byWeek[weekKey] ??= {};
      byWeek[weekKey][muscle] ??= { hardSets: 0, volume: 0 };
      byWeek[weekKey][muscle].hardSets += 1;
      byWeek[weekKey][muscle].volume += set.weightKg * set.reps;
    }
  }

  return Object.entries(byWeek)
    .map(([week, muscles]) => ({ week, muscles }))
    .sort((a, b) => a.week.localeCompare(b.week));
}
