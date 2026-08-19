-- Delete the finished sessions that hold no training data.
--
-- Item 3 deliberately shipped WITHOUT this cleanup, and said why: `finishWorkout` was
-- still producing empty closed rows, so deleting once would clean today's snapshot and
-- tomorrow there would be a new one. That argument dies with this change. Every writer
-- of a non-null `finishedAt` was enumerated before writing this migration:
--
--   * `finishWorkout`               -> now DISCARDS a session with no sets
--   * `startWorkout` step 5         -> already deleted empty sessions (PR #20)
--   * the stale sweep               -> already deleted empty sessions
--   * `closeSessionPreservingNotes` -> only reachable with sets.length > 0
--   * `PATCH /workouts/:id`         -> its schema carries `notes` and `routineId` only
--
-- With no live producer left, this is permanent rather than a snapshot.
--
-- Measured on this database immediately before writing it: 12 sessions, of which 10 are
-- finished with zero sets, and 18 WorkoutSessionExercise rows hang off those 10 — people
-- opened exercises and logged nothing. Those links go with their session through
-- `onDelete: Cascade`, which is the wanted outcome: a session that does not exist has no
-- plan. No WorkoutSet row can be lost here, because having none is the condition.
--
-- OPEN sessions are deliberately untouched: an empty open session is a workout in
-- progress, not garbage. Only `finishedAt IS NOT NULL` qualifies.
DELETE FROM "WorkoutSession" ws
WHERE ws."finishedAt" IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM "WorkoutSet" s WHERE s."sessionId" = ws.id
  );
