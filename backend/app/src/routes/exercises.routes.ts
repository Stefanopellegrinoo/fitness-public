import { Router, Request, Response } from 'express';
import { prisma } from '../lib/prisma';
import { parsePaginationParams, buildPaginationMeta } from '../adapters/pagination.adapter';
import { z } from 'zod';
import { authMiddleware } from '../middlewares/auth.middleware';

const router = Router();

const ExerciseSchema = z.object({
    name: z.string(),
    category: z.enum(['PECHO', 'ESPALDA', 'HOMBROS', 'BRAZOS', 'PIERNAS', 'CORE', 'CARDIO']),
    primaryMuscles: z.array(z.string()).default([]),
    equipment: z.enum(['BARBELL', 'DUMBBELL', 'MACHINE', 'CABLE', 'BODYWEIGHT']).default('BARBELL'),
    isCompound: z.boolean().default(false),
    description: z.string().optional()
});

// Public: Get all exercises
router.get('/', async (req: Request, res: Response) => {
    try {
        const { offset, limit } = parsePaginationParams(
            req.query.offset as string | undefined,
            req.query.limit as string | undefined
        );

        const [exercises, total] = await Promise.all([
            prisma.exercise.findMany({
                orderBy: [{ name: 'asc' }, { id: 'asc' }],
                skip: offset,
                take: limit,
            }),
            prisma.exercise.count()
        ]);

        const pagination = buildPaginationMeta(offset, limit, total);
        res.json({ data: exercises, pagination });
    } catch (err: any) {
        console.error('Error fetching exercises:', err);
        res.status(500).json({ error: { message: 'Failed to fetch exercises' } });
    }
});

// Public: Get exercise by ID
router.get('/:id', async (req: Request, res: Response) => {
    try {
        const exercise = await prisma.exercise.findUnique({
            where: { id: req.params.id as string }
        });
        if (!exercise) {
            res.status(404).json({ error: { message: 'Exercise not found' } });
            return;
        }
        res.json({ data: exercise });
    } catch (err: any) {
        console.error('Error fetching exercise:', err);
        res.status(500).json({ error: { message: 'Failed to fetch exercise' } });
    }
});

// Protected: Create exercise (admin only - simplified here)
router.post('/', authMiddleware, async (req: Request, res: Response) => {
    const parseResult = ExerciseSchema.safeParse(req.body);
    if (!parseResult.success) {
        res.status(400).json({ error: { message: 'Validation error', details: parseResult.error.flatten() } });
        return;
    }

    try {
        const exercise = await prisma.exercise.create({
            data: parseResult.data
        });
        res.status(201).json({ data: exercise });
    } catch (err: any) {
        console.error('Error creating exercise:', err);
        res.status(500).json({ error: { message: 'Failed to create exercise' } });
    }
});

export default router;
