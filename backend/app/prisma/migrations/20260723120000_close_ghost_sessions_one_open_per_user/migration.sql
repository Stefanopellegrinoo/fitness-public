-- Ghost-session cleanup + hard guarantee of at most ONE open session per user.
--
-- Context: startWorkout used check-then-create without serialization, so two
-- concurrent requests could both create an open session (finishedAt IS NULL).
-- Abandoned sessions also stayed open forever and were silently resumed weeks
-- later, making the workout timer show hundreds of hours.

-- 1. Stale open sessions (>24h old) that have logged sets: close them at their
--    last real activity. Closing at NOW() would fabricate multi-day workouts.
UPDATE "WorkoutSession" ws
SET "finishedAt" = ls.last_set,
    "notes" = COALESCE(ws."notes", 'Auto-closed: abandoned session')
FROM (
    SELECT "sessionId", MAX("createdAt") AS last_set
    FROM "WorkoutSet"
    GROUP BY "sessionId"
) ls
WHERE ws."finishedAt" IS NULL
  AND ws."startedAt" < NOW() - INTERVAL '24 hours'
  AND ls."sessionId" = ws.id;

-- 2. Open sessions with no sets that are stale, or that are duplicates (not the
--    newest open session of their user): delete them. They hold no training
--    data; they only exist because of the race/abandonment bugs.
DELETE FROM "WorkoutSession" ws
WHERE ws."finishedAt" IS NULL
  AND NOT EXISTS (SELECT 1 FROM "WorkoutSet" s WHERE s."sessionId" = ws.id)
  AND (
    ws."startedAt" < NOW() - INTERVAL '24 hours'
    OR ws.id NOT IN (
        SELECT DISTINCT ON ("userId") id
        FROM "WorkoutSession"
        WHERE "finishedAt" IS NULL
        ORDER BY "userId", "startedAt" DESC
    )
  );

-- 3. Any remaining duplicate open sessions (fresh, with sets): keep the newest
--    per user, close the rest at their last set (or their start when empty).
UPDATE "WorkoutSession" ws
SET "finishedAt" = COALESCE(
        (SELECT MAX("createdAt") FROM "WorkoutSet" s WHERE s."sessionId" = ws.id),
        ws."startedAt"
    ),
    "notes" = COALESCE(ws."notes", 'Auto-closed to prevent duplication')
WHERE ws."finishedAt" IS NULL
  AND ws.id NOT IN (
    SELECT DISTINCT ON ("userId") id
    FROM "WorkoutSession"
    WHERE "finishedAt" IS NULL
    ORDER BY "userId", "startedAt" DESC
  );

-- 4. From now on the database itself rejects a second open session per user.
--    (Partial unique indexes are not expressible in schema.prisma; Prisma maps
--    violations of this index to error P2002, which startWorkout handles.)
CREATE UNIQUE INDEX "WorkoutSession_one_open_per_user"
ON "WorkoutSession" ("userId")
WHERE "finishedAt" IS NULL;
