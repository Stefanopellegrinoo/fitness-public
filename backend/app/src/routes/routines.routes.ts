import { Router, Request, Response } from 'express';
import { prisma } from '../lib/prisma';
import { parsePaginationParams, buildPaginationMeta } from '../adapters/pagination.adapter';
import { authMiddleware } from '../middlewares/auth.middleware';
import { asyncHandler } from '../middlewares/error.middleware';
import { CreateRoutineSchema, UpdateRoutineSchema, CreateRoutineInput } from '../validations/routine.validation';
import { suggestNextRoutineDay } from '../services/routines.service';
import { dayOfWeekInZone, resolveIanaZone } from '../lib/date';
import { computeLegacyExerciseFields } from '../lib/legacy-targets';

const router = Router();

export const ROUTINE_INCLUDE = {
    days: {
        orderBy: { order: 'asc' as const },
        include: {
            exercises: {
                orderBy: { order: 'asc' as const },
                include: {
                    exercise: true,
                    setPlans: { orderBy: { order: 'asc' as const } },
                },
            },
        },
    },
    // Legacy flat list — kept until the frontend migrates (phase 4), dropped in phase 6
    exercises: {
        include: { exercise: true },
        orderBy: { order: 'asc' as const },
    },
} as const;

async function createRoutineDays(
    tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0],
    routineId: string,
    days: CreateRoutineInput['days']
) {
    for (const day of days) {
        const createdDay = await tx.routineDay.create({
            data: { routineId, name: day.name, order: day.order, weekday: day.weekday ?? null },
        });
        for (const ex of day.exercises) {
            await tx.routineExercise.create({
                data: {
                    routineId, // legacy dual-write until phase-6 contract migration
                    dayId: createdDay.id,
                    exerciseId: ex.exerciseId,
                    order: ex.order,
                    restSeconds: ex.restSeconds ?? null,
                    notes: ex.notes ?? null,
                    dayOfWeek: day.weekday ?? null, // legacy dual-write until phase-6 contract migration
                    ...computeLegacyExerciseFields(ex.setPlans),
                    setPlans: { create: ex.setPlans },
                },
            });
        }
    }
}

// GET all routines for the authenticated user
router.get('/', authMiddleware, asyncHandler(async (req: Request, res: Response) => {
    const { offset, limit } = parsePaginationParams(
        req.query.offset as string | undefined,
        req.query.limit as string | undefined
    );

    const [routines, total] = await Promise.all([
        prisma.routine.findMany({
            where: { userId: req.user!.userId },
            include: ROUTINE_INCLUDE,
            orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
            skip: offset,
            take: limit,
        }),
        prisma.routine.count({ where: { userId: req.user!.userId } }),
    ]);

    const pagination = buildPaginationMeta(offset, limit, total);
    res.json({ data: routines, pagination });
}));

// GET a specific routine
router.get('/:id', authMiddleware, asyncHandler(async (req: Request, res: Response) => {
    const routine = await prisma.routine.findUnique({
        where: { id: req.params.id as string },
        include: ROUTINE_INCLUDE,
    });

    if (!routine || routine.userId !== req.user!.userId) {
        res.status(404).json({ error: { message: 'Routine not found' } });
        return;
    }

    res.json({ data: routine });
}));

// GET the suggested next day to train for a routine
router.get('/:id/next-day', authMiddleware, asyncHandler(async (req: Request, res: Response) => {
    const routine = await prisma.routine.findUnique({ where: { id: req.params.id as string } });
    if (!routine || routine.userId !== req.user!.userId) {
        res.status(404).json({ error: { message: 'Routine not found' } });
        return;
    }

    // The seventh `?tz=` route. The weekday that anchors the rotation is the
    // CALLER's, not the server's: same instant, two zones, two answers.
    // Validated AFTER the ownership 404 and before any suggestion work, so a
    // routine that is not the caller's answers 404 like one that does not
    // exist -- reordering these two would leak which routine ids are real.
    // The try/catch -> 400 is repeated here rather than extracted (D2), and
    // tz-contract-uniformity.test.ts is what keeps the seven copies identical.
    let zone: string;
    try {
        zone = resolveIanaZone(req.query.tz);
    } catch (err: any) {
        res.status(400).json({ error: { message: 'Validation error', details: err.message } });
        return;
    }

    const day = await suggestNextRoutineDay(req.user!.userId, routine.id, dayOfWeekInZone(new Date(), zone));
    res.json({ data: day });
}));

// POST: Create a new routine (nested days contract)
router.post('/', authMiddleware, asyncHandler(async (req: Request, res: Response) => {
    const parseResult = CreateRoutineSchema.safeParse(req.body);
    if (!parseResult.success) {
        res.status(400).json({ error: { message: 'Validation error', details: parseResult.error.flatten() } });
        return;
    }

    const { name, days } = parseResult.data;
    const userId = req.user!.userId;

    const routine = await prisma.$transaction(async (tx) => {
        const created = await tx.routine.create({ data: { name, userId } });
        await createRoutineDays(tx, created.id, days);
        return tx.routine.findUniqueOrThrow({ where: { id: created.id }, include: ROUTINE_INCLUDE });
    });

    res.status(201).json({ data: routine });
}));

// PUT: Update an existing routine (transactional full replace of days)
router.put('/:id', authMiddleware, asyncHandler(async (req: Request, res: Response) => {
    const parseResult = UpdateRoutineSchema.safeParse(req.body);
    if (!parseResult.success) {
        res.status(400).json({ error: { message: 'Validation error', details: parseResult.error.flatten() } });
        return;
    }

    const { name, days } = parseResult.data;
    const routineId = req.params.id as string;
    const userId = req.user!.userId;

    const existing = await prisma.routine.findUnique({ where: { id: routineId } });
    if (!existing || existing.userId !== userId) {
        res.status(404).json({ error: { message: 'Routine not found' } });
        return;
    }

    const result = await prisma.$transaction(async (tx) => {
        if (name) {
            await tx.routine.update({ where: { id: routineId }, data: { name } });
        }
        if (days) {
            // Full replace: deleting days cascades day-linked exercises and their set plans;
            // the extra deleteMany catches legacy rows that never got a dayId.
            await tx.routineDay.deleteMany({ where: { routineId } });
            await tx.routineExercise.deleteMany({ where: { routineId } });
            await createRoutineDays(tx, routineId, days);
        }
        return tx.routine.findUniqueOrThrow({ where: { id: routineId }, include: ROUTINE_INCLUDE });
    });

    res.json({ data: result });
}));

// DELETE a routine
router.delete('/:id', authMiddleware, asyncHandler(async (req: Request, res: Response) => {
    const routine = await prisma.routine.findUnique({ where: { id: req.params.id as string } });
    if (!routine || routine.userId !== req.user!.userId) {
        res.status(404).json({ error: { message: 'Routine not found' } });
        return;
    }

    await prisma.routine.delete({ where: { id: req.params.id as string } });
    res.json({ message: 'Routine deleted successfully' });
}));

export default router;
