import { prisma } from '../lib/prisma';
import { DayOfWeek, Prisma, WorkoutSet } from '@prisma/client';
import { dayOfWeekInZone, resolveIanaZone } from '../lib/date';
import { suggestNextRoutineDay } from './routines.service';
import { computeLegacyExerciseFields } from '../lib/legacy-targets';

// A session older than this that was never finished is considered abandoned:
// invisible to getActiveWorkout AND never resumed by startWorkout. Both must
// share the same window — if they drift, stale sessions become resumable
// ghosts and the timer shows hundreds of hours (now - old startedAt).
const ACTIVE_SESSION_WINDOW_MS = 24 * 60 * 60 * 1000;

function activeSessionCutoff(): Date {
  return new Date(Date.now() - ACTIVE_SESSION_WINDOW_MS);
}

// Closes one session, deciding `notes` at WRITE time. Reading `notes` at one
// point and writing it back at another loses any note saved in between, so
// `notes: null` lives in the WHERE, where Postgres evaluates it against the row
// as it exists when the UPDATE runs. If a note landed, the first statement stops
// matching and the second closes the row without naming `notes` at all, so the
// system marker is never stamped over it. `finishedAt: null` in both makes a
// concurrent close a no-op instead of an overwrite, which is what keeps a
// genuinely finished session's timestamp intact.
//
// Deliberately Prisma delegates, NOT the single `$executeRaw` with
// `COALESCE("notes", ...)` this replaced. That version bound the JS Date as
// `timestamptz` while "finishedAt" is `timestamp without time zone`, so Postgres
// resolved the cast with the SESSION time zone: on any non-UTC deployment every
// auto-close stored a shifted timestamp (measured at -3h under
// America/Buenos_Aires, which puts finishedAt BEFORE startedAt). It also detached
// the table and column names from schema.prisma and leaned on search_path. The
// price here is one extra round trip when the session carries a note; the common
// path still takes one.
//
// `db` lets startWorkout run this close inside its close-and-create transaction
// (both statements then commit or roll back with the create). The stale sweep
// keeps the default: each of its closes is an independent repair with nothing to
// be atomic WITH.
async function closeSessionPreservingNotes(
  userId: string,
  sessionId: string,
  finishedAt: Date,
  marker: string,
  db: Prisma.TransactionClient = prisma
) {
  const marked = await db.workoutSession.updateMany({
    where: { id: sessionId, userId, finishedAt: null, notes: null },
    data: { finishedAt, notes: marker }
  });
  if (marked.count > 0) return;

  await db.workoutSession.updateMany({
    where: { id: sessionId, userId, finishedAt: null },
    data: { finishedAt }
  });
}

// Abandoned sessions must not be closed at "now" (that fabricates multi-day
// workouts in history). Close them at their last logged set; a session with
// no sets holds no training data, so it is deleted outright.
async function closeStaleOpenSessions(userId: string, cutoff: Date) {
  const staleSessions = await prisma.workoutSession.findMany({
    where: { userId, finishedAt: null, startedAt: { lt: cutoff } },
    include: { sets: { orderBy: { createdAt: 'desc' }, take: 1 } }
  });

  for (const session of staleSessions) {
    if (session.sets.length === 0) {
      // Atomic re-check in the WHERE: skip if a set was logged or the session
      // was finished between the snapshot above and this write.
      await prisma.workoutSession.deleteMany({
        where: { id: session.id, finishedAt: null, sets: { none: {} } }
      });
    } else {
      await closeSessionPreservingNotes(
        userId,
        session.id,
        session.sets[0].createdAt,
        'Auto-closed: abandoned session'
      );
    }
  }
}

// The single definition of "a session this user may resume". Every read that has
// to answer that question goes through here with an explicit cutoff, so a caller
// can anchor several reads to ONE instant instead of drifting between them.
// The partial index already caps the result at one row; the ordering is what
// keeps it defined if that index is ever lost.
async function findResumableSession(userId: string, cutoff: Date) {
  return await prisma.workoutSession.findFirst({
    where: {
      userId,
      finishedAt: null,
      startedAt: { gte: cutoff }
    },
    orderBy: { startedAt: 'desc' },
    include: {
      exercises: {
        include: { exercise: true },
        orderBy: { order: 'asc' }
      },
      sets: {
        include: { exercise: true },
        orderBy: { setNumber: 'asc' },
      },
      routine: true,
    },
  });
}

export async function getActiveWorkout(userId: string) {
  return await findResumableSession(userId, activeSessionCutoff());
}

// A routineId arriving from a client is an FK onto a user-owned table, so it has to be
// proved to belong to the caller before it is written anywhere. Scoping the lookup by
// userId rather than checking ownership afterwards keeps "does not exist" and "is not
// yours" the same answer, so the error cannot be used to probe which routine ids are real.
//
// One definition on purpose: `startWorkout` and `PATCH /workouts/:id` both write this
// column, and the second one shipped without the check. A session carrying a foreign
// routineId leaks on every read that does `include: { routine: true }` —
// `GET /workouts/sessions`, `getActiveWorkout`, and a resumed start all do.
export async function assertRoutineOwnership(routineId: string, userId: string): Promise<void> {
  const routine = await prisma.routine.findFirst({ where: { id: routineId, userId } });
  if (!routine) throw new Error('ROUTINE_NOT_FOUND');
}

export async function startWorkout(
  userId: string,
  routineId?: string,
  clientDay?: DayOfWeek,
  routineDayId?: string,
  isRetryAfterConflict = false
): Promise<NonNullable<Awaited<ReturnType<typeof getActiveWorkout>>>> {
  // 0. Ownership check: routineId must belong to the requesting user before anything else
  // touches it (prevents starting/snapshotting another user's routine).
  if (routineId) await assertRoutineOwnership(routineId, userId);

  // Every read in this invocation shares ONE cutoff. Evaluating
  // activeSessionCutoff() separately per read (T1, then T2 > T1) opens a blind
  // band [T1-24h, T2-24h): a session inside it is neither stale enough to be
  // closed by the sweep nor fresh enough to be resumed. This value is threaded
  // into all three reads that need it — the stale sweep, the resume check, and
  // the conflict convergence. An earlier revision left the convergence calling
  // getActiveWorkout(), which computed a THIRD cutoff and reopened exactly that
  // band at the one place where falling into it costs an HTTP 500.
  // Guarded by "anchors the convergence to the same cutoff as the resume check".
  const cutoff = activeSessionCutoff();

  // 0b. Validate the requested day BEFORE anything reads or writes session state.
  // This used to live at step 4, below the resume early-return, which made the
  // answer depend on state the caller cannot see: the same body was a 400 with no
  // open session and a 201 — silently dropping the day — with one. Only one of
  // those can be right, and it is the 400: the rejection is the documented
  // contract, and returning 201 after discarding an already-parsed field means
  // accepting input the route never honours.
  //
  // Ahead of step 1 as well as step 2, not merely ahead of the resume. Validated
  // after the sweep the caller still gets its 400, but abandoned sessions have
  // already been deleted on the way to an error that was always going to happen.
  // A rejected request now costs nothing.
  //
  // Still AFTER the ownership check above, and still scoped by `routineId`: a
  // routine that is not the caller's must answer 404 like one that does not
  // exist, and reordering these two would answer 400 instead — a difference that
  // tells an enumerator which routine ids are real.
  let resolvedDayId: string | null = null;
  if (routineDayId) {
    // Without a routineId there is nothing to scope the lookup to, so the day
    // cannot be honoured. It was previously dropped in silence on every path —
    // measured, including another user's day. Rejecting follows the same rule:
    // a field that cannot be applied must not be accepted.
    if (!routineId) throw new Error('ROUTINE_DAY_WITHOUT_ROUTINE');
    const day = await prisma.routineDay.findFirst({ where: { id: routineDayId, routineId } });
    if (!day) throw new Error('ROUTINE_DAY_MISMATCH');
    resolvedDayId = day.id;
  }

  // 1. Abandoned sessions are dead history, never a resume target.
  await closeStaleOpenSessions(userId, cutoff);

  // 2. Check for an active session within the resume window
  const activeSession = await findResumableSession(userId, cutoff);

  // If there is an active session and it matches the requested routine (or no routine specified), resume it
  if (activeSession && (!routineId || activeSession.routineId === routineId)) {
    return activeSession;
  }

  // 3. A session finished today is history — starting again creates a NEW session.
  // Reopening/reusing it would merge distinct workouts into one row and overwrite
  // the original startedAt, corrupting duration and history.

  // 4. The requested day was already validated and resolved at step 0b, above
  //    every read and every write on this path. What remains here is only the
  //    weekday used when the client pinned no day, resolved at step 6.
  // `clientDay` IS the zone signal on this route: the browser derives it from
  // its own clock, so a request that carries it needs no `tz` on top. Only when
  // it is absent is there no zone information at all in the request, and then
  // the process zone is the same fallback the seven `?tz=` endpoints already use
  // for an absent param -- read HERE, per call, never at module scope (M10).
  const targetDay = clientDay || dayOfWeekInZone(new Date(), resolveIanaZone(undefined));

  // 6. Resolve which RoutineDay to train when the client did not pin one.
  //    Numbered as in the original path but HOISTED above step 5: it is
  //    read-only, and every statement that lives inside the close-and-create
  //    transaction below extends the window during which the partial index
  //    entry is held against concurrent starts (the P2028 risk measured below), so
  //    nothing that only reads belongs in there. Resolving BEFORE the close
  //    cannot change the answer: both reads are scoped to the requested
  //    `routineId`, and the session step 5 closes always belongs to a DIFFERENT
  //    routine — that mismatch is the only way execution gets past the resume
  //    early-return at step 2.
  if (routineId && !routineDayId) {
    const anchored = await prisma.routineDay.findFirst({ where: { routineId, weekday: targetDay } });
    // `targetDay` is threaded into the suggestion instead of being dropped: the
    // suggestion used to re-derive "today" from the process clock, so a client
    // in a zone ahead of or behind the server got its day honoured by the
    // anchored lookup above and silently overruled by this fallback.
    resolvedDayId = anchored?.id ?? (await suggestNextRoutineDay(userId, routineId, targetDay))?.id ?? null;
  }

  // 5 + 7. Close the session step 2 observed and create the new one, as ONE
  // transaction. The close used to commit on its own before the create ran, so
  // any create failure that is not the retried P2002 — bad routine data tripping
  // WorkoutSessionExercise.sessionId_exerciseId, a transient outage, a P2028 —
  // left the user with no session at all: the observed one already closed (or
  // deleted, when it had no sets — unrecoverable, nothing to reopen) and the new
  // one never born. Sharing the transaction makes the close's commit conditional
  // on the create's: a failed switch now leaves the session the user was
  // switching from exactly as it was.
  //
  // When the create fails with the open-session P2002 the rolled-back close was
  // ALWAYS a no-op: the conflict means some other open session held the index,
  // and the partial index caps open sessions at one per user, so the row this
  // caller observed open cannot still have been open at write time (`finishedAt:
  // null` in the close's WHERE already made it miss). The retry below therefore
  // loses nothing to the rollback, and the convergence path is unchanged.
  //
  // Cost, measured before shipping: the transaction adds one UPDATE or DELETE
  // (~1-3ms) to an index-hold window that is ~5-11ms for the largest real
  // routine day (4 exercises; ~0.5ms per snapshotted exercise). Reaching
  // Prisma's 5s interactive-transaction budget — the P2028 risk step 6 guards
  // against — needs the window held ~500x longer than the express.json() 100kb
  // body cap even allows a day to produce (~1,700 exercises ≈ 0.9s).
  //
  // Inside the transaction, step 5 keeps its TWO separate guards doing two
  // different jobs — conflating them is what a previous revision of this
  // comment got wrong:
  //   - `if (activeSession)` covers the caller whose step-2 read saw NOTHING. It
  //     closes nothing at all, so a session created concurrently just after that
  //     read survives and the partial index still has something to reject, which
  //     is what keeps the P2002 retry armed. The id scoping does no work here.
  //   - `id: activeSession.id` (inside the helper) covers the caller that DID
  //     observe a row. Its job is to MISS the replacement: a blanket
  //     `where: { userId, finishedAt: null }` would hit whatever session is open
  //     right now, which may be one this caller never observed. What makes the
  //     write a no-op once the observed row is already closed is the separate
  //     `finishedAt: null` predicate, not the id.
  // NOT covered: step 2 observes a session that a concurrent caller resumed
  // microseconds earlier — that caller still gets its session closed underneath
  // it (ghost timer). Serializing observe-and-close was ruled out by
  // measurement: the resume is a pure SELECT, so there is no state for a CAS
  // to detect.
  //
  // Step 7's contract is unchanged: the partial unique index
  // WorkoutSession_one_open_per_user makes a second open session impossible. If
  // a concurrent start wins the race the create fails with P2002 and this caller
  // re-enters at step 2. That re-entry RESUMES the winner only when the routine
  // matches; on a mismatch it closes the winner and creates its own, which is
  // the ghost-timer interleaving described at step 5.
  try {
    return await prisma.$transaction(async (tx) => {
      if (activeSession) {
        if (activeSession.sets.length === 0) {
          // No training data to close: mirror the stale sweep's own
          // empty-session branch above. Re-checking `finishedAt: null` and
          // `sets: { none: {} }` in the WHERE is what keeps this atomic — a set
          // logged or a finish landed between the step-2 read and this write
          // leaves the row alone.
          await tx.workoutSession.deleteMany({
            where: { id: activeSession.id, finishedAt: null, sets: { none: {} } }
          });
        } else {
          // The true last-activity time, not `sets[0]`. `findResumableSession`
          // orders `sets` by `setNumber: 'asc'` (the UI needs that order), not
          // by `createdAt`, so neither the first nor the last array element is
          // reliably the latest set in time. The sets are already loaded here —
          // take the max over them instead of trusting array position.
          const lastSetAt = new Date(
            Math.max(...activeSession.sets.map(set => set.createdAt.getTime()))
          );
          await closeSessionPreservingNotes(
            userId,
            activeSession.id,
            lastSetAt,
            'Auto-closed to prevent duplication',
            tx
          );
        }
      }

      return await createSessionWithPlan(tx, userId, routineId, resolvedDayId);
    });
  } catch (error) {
    if (isOpenSessionConflict(error)) {
      if (!isRetryAfterConflict) {
        return await startWorkout(userId, routineId, clientDay, routineDayId, true);
      }
      // Retry spent: someone holds the one open session. Reaching here needs THREE
      // or more interleaved start attempts — with only two, the loser's step-2 read
      // either sees the winner (and resumes it, or closes it by id and creates) or
      // the winner did not exist yet, and a lone second create cannot also lose.
      //
      // The lookup is anchored to THIS invocation's cutoff, so it can never return
      // a session this same invocation would have called stale, and it cannot fall
      // into a cutoff-drift band. (It can still be older than 24h by however long
      // the request itself took — milliseconds — which is the tolerance the shared
      // cutoff buys everywhere else on this path too.)
      //
      // Converge only on a session the caller would have accepted at step 2. A
      // holder for a DIFFERENT routine is not this caller's workout: returning it
      // as 201 would render someone else's routine as a successful start and
      // silently discard an already-validated routineDayId. Failing loudly is
      // better, and a distinct message lets the route answer 409 instead of 500.
      //
      // Two residuals, both narrow, both ending in the P2002 surfacing as a 500:
      // the holder stops being open — finished, or deleted by a concurrent stale
      // sweep — between the failed create and this read; or it is older than
      // `cutoff` because step 1's own sweep raced past it (a set landing in an
      // empty stale session between that sweep's snapshot and its delete leaves
      // the row open, blocking the create while staying invisible here).
      let winner: Awaited<ReturnType<typeof findResumableSession>> = null;
      try {
        winner = await findResumableSession(userId, cutoff);
      } catch (lookupError) {
        // The lookup failing is not evidence about contention either way, so the
        // P2002 stays the error the caller gets. Log rather than swallow: an
        // outage here would otherwise be invisible, indistinguishable from simply
        // finding no holder.
        console.error('[startWorkout] convergence lookup failed after P2002:', lookupError);
        throw error;
      }
      if (winner) {
        if (!routineId || winner.routineId === routineId) return winner;
        throw new Error('START_ROUTINE_CONFLICT');
      }
    }
    throw error;
  }
}

// Only the partial index guarding "one open session per user" should trigger
// the start retry. Any other P2002 (e.g. WorkoutSessionExercise sessionId+
// exerciseId from bad routine data) is a real error and must surface.
// Prisma reports the violated index as its column list, not its name:
// { modelName: 'WorkoutSession', target: ['userId'] }.
export function isOpenSessionConflict(error: unknown): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') {
    return false;
  }
  const meta = error.meta as { modelName?: string; target?: unknown } | undefined;
  return meta?.modelName === 'WorkoutSession'
    && Array.isArray(meta.target)
    && meta.target.includes('userId');
}

// Runs on the transaction client its caller owns: the close at startWorkout's
// step 5 has to commit or roll back WITH this create, so the transaction cannot
// live in here. There is exactly one caller; if another ever appears, it decides
// its own transaction boundary the same way.
async function createSessionWithPlan(
  tx: Prisma.TransactionClient,
  userId: string,
  routineId: string | undefined,
  resolvedDayId: string | null
) {
  const session = await tx.workoutSession.create({
    data: {
      userId,
      routineId,
      routineDayId: resolvedDayId,
      startedAt: new Date(),
      finishedAt: null,
    }
  });

  if (resolvedDayId) {
    const dayExercises = await tx.routineExercise.findMany({
      where: { dayId: resolvedDayId },
      orderBy: { order: 'asc' },
      include: { setPlans: { orderBy: { order: 'asc' } } },
    });

    for (const re of dayExercises) {
      const snapshot = re.setPlans.map(sp => ({
        order: sp.order,
        setType: sp.setType,
        repsMin: sp.repsMin,
        repsMax: sp.repsMax,
        targetRpe: sp.targetRpe,
        targetRir: sp.targetRir,
        percentOfTopSet: sp.percentOfTopSet,
        targetWeightKg: sp.targetWeightKg,
        restSeconds: sp.restSeconds,
      }));
      await tx.workoutSessionExercise.create({
        data: {
          sessionId: session.id,
          exerciseId: re.exerciseId,
          order: re.order,
          planSnapshot: snapshot,
          // Derived legacy dual-write: current frontend renders these until phase 5
          ...computeLegacyExerciseFields(re.setPlans),
        },
      });
    }
  }

  return tx.workoutSession.findUniqueOrThrow({
    where: { id: session.id },
    include: {
      exercises: { include: { exercise: true }, orderBy: { order: 'asc' } },
      sets: { include: { exercise: true }, orderBy: { setNumber: 'asc' } },
      routine: true
    }
  });
}

// The read every write into a session starts from. Two distinct failures,
// deliberately not collapsed. Someone else's session must be indistinguishable from
// one that does not exist (hence `userId` in the WHERE, not a separate check) or the
// error confirms the id to anyone enumerating uuids. A session that IS the caller's
// but finished is a different answer: the resource is there, its state refuses the
// write — 409, not 404.
async function assertSessionAcceptsWrites(sessionId: string, userId: string): Promise<void> {
  const session = await prisma.workoutSession.findUnique({
    where: { id: sessionId, userId }
  });
  if (!session) throw new Error('SESSION_NOT_FOUND');
  if (session.finishedAt) throw new Error('SESSION_CLOSED');
}

// The guard above is decided in JS between round trips, so it knows only what its
// read saw: a close landing after it is invisible and the writes go through anyway.
// It cannot be fixed the way `closeSessionPreservingNotes` and `finishWorkout` fix
// theirs — those are UPDATEs on the very row the predicate is about, while these are
// INSERTs into a child table, and no Prisma create can be conditioned on another
// table's column.
//
// So the window is not closed here, it is COMPENSATED: read the parent again after
// the write and, if it stopped accepting writes in between, undo what this call wrote
// and answer as if nothing had been attempted. Declared, not hidden: a set can still
// be visible inside a closed session for the length of one round trip. What is gone is
// that it stays there — `assertSetIsWritable` answers 409 to both PATCH and DELETE
// /workouts/sets/:id once the session is finished, so a row surviving this window was
// one the user was told about, could see in their history, and could never edit or
// remove again.
//
// `undo` belongs to the caller because only the caller knows what its own upserts
// produced. It must be safe to run against rows that are already gone — reaching the
// null branch below means the session was deleted, and both child tables cascade with it.
async function assertSessionStillAcceptsWrites(
  sessionId: string,
  userId: string,
  undo: () => Promise<void>
): Promise<void> {
  const session = await prisma.workoutSession.findUnique({
    where: { id: sessionId, userId }
  });
  if (session && !session.finishedAt) return;

  await undo();
  // A session that is simply GONE is a 404, not "already finished": the stale sweep
  // deletes an open session with no sets, and a link written into one does not stop it
  // (its WHERE re-checks `sets`, not `exercises`).
  throw new Error(session ? 'SESSION_CLOSED' : 'SESSION_NOT_FOUND');
}

// Prisma does not report which branch an upsert took, and compensation needs exactly
// that. A link this call INSERTED has to go when the session turns out to be closed;
// one that was already there has to stay, because it belongs to an exercise the user
// really did train and deleting it would turn a rejected late write into the loss of
// earlier work. The read before the upsert is the only thing that tells the two apart,
// so `created` means "this call's read found nothing", not "the upsert inserted".
async function upsertSessionExerciseLink(sessionId: string, exerciseId: string) {
  const existing = await prisma.workoutSessionExercise.findUnique({
    where: { sessionId_exerciseId: { sessionId, exerciseId } },
    select: { id: true }
  });

  const link = await prisma.workoutSessionExercise.upsert({
    where: { sessionId_exerciseId: { sessionId, exerciseId } },
    update: {},
    create: {
      sessionId,
      exerciseId,
      order: await prisma.workoutSessionExercise.count({ where: { sessionId } })
    },
    include: { exercise: true }
  });

  return { link, created: existing === null };
}

// `deleteMany` rather than `delete` so a row that is already gone — cascaded away with
// its session — is a no-op instead of a P2025 that would replace the honest 404/409
// with a 500 on the way out.
async function undoSessionExerciseLink(link: { id: string }, created: boolean): Promise<void> {
  if (!created) return;
  await prisma.workoutSessionExercise.deleteMany({ where: { id: link.id } });
}

// Same distinction as the link, plus one the link does not have: `update: {}` is a
// genuine no-op, but the set's update branch OVERWRITES values. For a set that already
// existed there is nothing to delete and something to put back — the exact fields that
// update branch writes, read from the row as this call found it. Restoring them is what
// keeps "rejected" and "persisted" from being true at once: the user is told the set was
// not saved, and the set they logged while the session was open still reads the way they
// left it.
//
// Residual, declared: the restore writes back what THIS call read, so a value another
// request wrote in between is lost. That needs a writer racing a writer inside the same
// millisecond-wide window, and the alternative — leaving a rejected write in place — is
// the failure this whole path exists to remove.
async function undoWorkoutSetWrite(set: { id: string }, previous: WorkoutSet | null): Promise<void> {
  if (!previous) {
    await prisma.workoutSet.deleteMany({ where: { id: set.id } });
    return;
  }

  await prisma.workoutSet.updateMany({
    where: { id: previous.id },
    data: {
      weightKg: previous.weightKg,
      reps: previous.reps,
      rpe: previous.rpe,
      isWarmup: previous.isWarmup,
      setType: previous.setType
    }
  });
}

export async function linkExerciseToSession(sessionId: string, userId: string, exerciseId: string) {
  await assertSessionAcceptsWrites(sessionId, userId);

  const { link, created } = await upsertSessionExerciseLink(sessionId, exerciseId);

  // A link left inside a closed session is as permanent as a set left there: no route
  // in production deletes a WorkoutSessionExercise, so this call is the only chance to
  // take it back.
  await assertSessionStillAcceptsWrites(sessionId, userId, () => undoSessionExerciseLink(link, created));

  return link;
}

// Deliberately NOT the 409 that `linkExerciseToSession` answers for a closed session.
// There the caller is trying to change a finished workout and must be stopped; here it
// is asking for a state the workout is already in, and the honest answer is "done".
// The UI makes that the common case, not an edge one: the Finalizar button has no
// disabled state and no debounce, and the client aborts at 10s without Express ever
// cancelling the request, so the second tap lands on a session the first tap closed.
// With a 409 that reaches `handleFinish`, whose catch does not branch on status, the
// user is told to retry a workout that is already in their history — forever.
//
// Write first, then read — NOT read-then-branch. One query cannot give both answers
// (`finishedAt: null` in the WHERE collapses "no such session" and "already finished"
// into the same no-match), but that only rules out doing it in ONE statement; it does
// not mean the read has to come first. Ordering it read-first is what reintroduced the
// bug this function exists to fix: the guard was evaluated in JS against a snapshot, so
// a close landing in between was invisible and the write went through unconditionally.
//
// The predicate belongs in the WHERE, where Postgres evaluates it against the row as it
// is at write time — the same idiom `closeSessionPreservingNotes` uses, and the reason
// its comment can promise that a concurrent close is "a no-op instead of an overwrite".
// That promise has to be mutual: the sweep stamps the last set's createdAt, hours in the
// past, and overwriting it with `now` turns a workout that ended yesterday into one
// ending this instant.
//
// `updateMany` rather than `update` is also what keeps a deleted row from becoming a
// 500: it raises no P2025, so a session the sweep removed between the two statements
// reads back as null and answers 404 — the honest answer — instead of telling the
// client to retry something that no longer exists.
//
// `userId` stays IN both WHEREs rather than being a separate check, so a session that is
// not the caller's is indistinguishable from one that does not exist, and ownership
// necessarily decides before state.
export async function finishWorkout(sessionId: string, userId: string) {
  // Tapping Start and walking back is not "I finished a workout": it is a session that
  // never happened. A session with zero sets holds no training data — the same thing
  // the stale sweep and step 5 already say with this exact predicate — so finishing it
  // DISCARDS the row rather than stamping a `finishedAt` onto an entry nobody trained.
  //
  // ONE statement, not read-then-delete. Every predicate lives in the WHERE, so Postgres
  // evaluates all three at write time:
  //   - `sets: { none: {} }` is why a set that landed first saves the row. `WorkoutSet`
  //     is `onDelete: Cascade`, so without it this delete would destroy logged sets
  //     along with their session — this guard is the difference between discarding
  //     nothing and losing data.
  //   - `finishedAt: null` keeps the idempotent path: an already-finished row is
  //     history, and history is not re-judged by a second tap.
  //   - `userId` makes ownership decide before state, so a stranger's empty session is
  //     a 404 and stays exactly where it is.
  // No match throws P2025 — nothing was discarded, so fall through to the close below.
  try {
    return await prisma.workoutSession.delete({
      where: { id: sessionId, userId, finishedAt: null, sets: { none: {} } }
    });
  } catch (err) {
    if (!(err instanceof Prisma.PrismaClientKnownRequestError) || err.code !== 'P2025') throw err;
  }

  await prisma.workoutSession.updateMany({
    where: { id: sessionId, userId, finishedAt: null },
    data: { finishedAt: new Date() }
  });

  const session = await prisma.workoutSession.findUnique({
    where: { id: sessionId, userId }
  });
  if (!session) throw new Error('SESSION_NOT_FOUND');
  return session;
}

export async function addWorkoutSet(sessionId: string, userId: string, setData: any) {
  await assertSessionAcceptsWrites(sessionId, userId);

  const { exerciseId, setNumber, weightKg, reps, rpe, isWarmup, setType } = setData;

  // Deliberately NOT `linkExerciseToSession`: that one re-checks and compensates on its
  // own, which would leave the set written below outside any compensation — a close
  // landing after ITS re-check and before this upsert would put back exactly the row
  // this path exists to prevent. One guard, both writes, one re-check that can undo both.
  const { link, created } = await upsertSessionExerciseLink(sessionId, exerciseId);

  const previousSet = await prisma.workoutSet.findUnique({
    where: { sessionId_exerciseId_setNumber: { sessionId, exerciseId, setNumber } }
  });

  // Use UPSERT to prevent duplicates for the same set number in the same session
  const set = await prisma.workoutSet.upsert({
    where: {
      sessionId_exerciseId_setNumber: {
        sessionId,
        exerciseId,
        setNumber
      }
    },
    update: { weightKg, reps, rpe, isWarmup, setType },
    create: { ...setData, sessionId },
    include: { exercise: true }
  });

  await assertSessionStillAcceptsWrites(sessionId, userId, async () => {
    await undoWorkoutSetWrite(set, previousSet);
    await undoSessionExerciseLink(link, created);
  });

  return set;
}

export async function getLastExerciseSessionSets(userId: string, exerciseId: string, currentSessionId?: string) {
  // 1. Find the most recent session (other than current) that contains this exercise
  const lastSessionWithExercise = await prisma.workoutSession.findFirst({
    where: {
      userId,
      id: currentSessionId ? { not: currentSessionId } : undefined,
      sets: {
        some: { exerciseId }
      }
    },
    orderBy: {
      startedAt: 'desc'
    },
    select: {
      id: true
    }
  });

  if (!lastSessionWithExercise) return [];

  // 2. Fetch all sets for that exercise in that session
  return await prisma.workoutSet.findMany({
    where: {
      sessionId: lastSessionWithExercise.id,
      exerciseId
    },
    orderBy: {
      setNumber: 'asc'
    }
  });
}

export const workoutService = {
  getActiveWorkout,
  startWorkout,
  assertRoutineOwnership,
  finishWorkout,
  addWorkoutSet,
  linkExerciseToSession,
  getLastExerciseSessionSets
};
