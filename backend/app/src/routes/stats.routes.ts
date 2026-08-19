import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { authMiddleware } from '../middlewares/auth.middleware';
import { asyncHandler } from '../middlewares/error.middleware';
import { getExerciseProgression, getExercisePRs, getWeeklyVolume } from '../services/stats.service';
import { resolveIanaZone } from '../lib/date';

const router = Router();

// Same clamping range as the sibling GET /api/workouts/sessions endpoint
// (src/adapters/pagination.adapter.ts), but defaulting to 50 (this endpoint's
// pre-existing service default) instead of erroring, since an invalid/out-of-range
// limit here is not a client error worth a 400 - it degrades gracefully instead.
const DEFAULT_LIMIT = 50;
const MIN_LIMIT = 1;
const MAX_LIMIT = 100;

const clampLimit = (value: number): number => Math.min(MAX_LIMIT, Math.max(MIN_LIMIT, value));

const ProgressionQuerySchema = z.object({
    from: z.coerce.date().optional(),
    to: z.coerce.date().optional(),
    limit: z.coerce.number().int().catch(DEFAULT_LIMIT).transform(clampLimit).optional(),
});

export function parseProgressionQuery(query: unknown) {
    return ProgressionQuerySchema.safeParse(query);
}

// Same clamp-instead-of-400 approach as `limit` above: an invalid/out-of-range `weeks`
// degrades to the default rather than erroring, and the upper bound keeps the lookback
// window (and the resulting Prisma query range) bounded.
const DEFAULT_WEEKS = 12;
const MIN_WEEKS = 1;
const MAX_WEEKS = 104;

const clampWeeks = (value: number): number => Math.min(MAX_WEEKS, Math.max(MIN_WEEKS, value));

const WeeklyVolumeQuerySchema = z.object({
    weeks: z.coerce.number().int().catch(DEFAULT_WEEKS).transform(clampWeeks).optional(),
});

export function parseWeeklyVolumeQuery(query: unknown) {
    return WeeklyVolumeQuerySchema.safeParse(query);
}

router.get('/exercises/:exerciseId/progression', authMiddleware, asyncHandler(async (req: Request, res: Response) => {
    const exerciseId = req.params.exerciseId as string;

    const parseResult = parseProgressionQuery(req.query);
    if (!parseResult.success) {
        res.status(400).json({ error: { message: 'Validation error', details: parseResult.error.flatten() } });
        return;
    }

    const { from, to, limit } = parseResult.data;

    const data = await getExerciseProgression(req.user!.userId, exerciseId, { from, to, limit });
    res.json({ data });
}));

router.get('/exercises/:exerciseId/prs', authMiddleware, asyncHandler(async (req: Request, res: Response) => {
    const data = await getExercisePRs(req.user!.userId, req.params.exerciseId as string);
    res.json({ data });
}));

router.get('/weekly-volume', authMiddleware, asyncHandler(async (req: Request, res: Response) => {
    // `tz` validated OUTSIDE the Zod schema (design D3): `weeks` below uses `.catch(DEFAULT_WEEKS)`,
    // so `safeParse` can never fail -- that 400 branch is unreachable dead code today. `tz`'s 400
    // is the only one this endpoint can actually return, so it must match the SAME shape
    // dashboard.routes.ts already uses for the same parameter (`details` as a string, never the
    // caller's raw value, never Zod's `flatten()` object).
    let zone: string;
    try {
        zone = resolveIanaZone(req.query.tz);
    } catch (err: any) {
        res.status(400).json({ error: { message: 'Validation error', details: err.message } });
        return;
    }

    const parseResult = parseWeeklyVolumeQuery(req.query);
    if (!parseResult.success) {
        res.status(400).json({ error: { message: 'Validation error', details: parseResult.error.flatten() } });
        return;
    }

    const weeks = parseResult.data.weeks ?? DEFAULT_WEEKS;
    const data = await getWeeklyVolume(req.user!.userId, weeks, zone);
    res.json({ data });
}));

export default router;
