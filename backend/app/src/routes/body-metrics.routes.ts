import { Router, Request, Response } from 'express';
import { prisma } from '../lib/prisma';
import { parsePaginationParams, buildPaginationMeta } from '../adapters/pagination.adapter';
import { authMiddleware } from '../middlewares/auth.middleware';
import { z } from 'zod';

const router = Router();

const BodyMetricSchema = z.object({
    weightKg: z.number().positive().optional(),
    muscleMassKg: z.number().positive().optional(),
    fatMassKg: z.number().positive().optional(),
    chestCm: z.number().positive().optional(),
    waistCm: z.number().positive().optional(),
    hipCm: z.number().positive().optional(),
    leftArmCm: z.number().positive().optional(),
    rightArmCm: z.number().positive().optional(),
    leftThighCm: z.number().positive().optional(),
    rightThighCm: z.number().positive().optional(),
    leftCalfCm: z.number().positive().optional(),
    rightCalfCm: z.number().positive().optional(),
    notes: z.string().optional(),
    date: z.string().optional() // ISO date string
}).refine(data => {
    const { notes, date, ...metrics } = data;
    return Object.values(metrics).some(v => v !== undefined);
}, {
    message: "At least one metric or measurement must be provided"
});

// Get user's body metrics history
router.get('/', authMiddleware, async (req: Request, res: Response) => {
    try {
        const { offset, limit } = parsePaginationParams(
            req.query.offset as string | undefined,
            req.query.limit as string | undefined
        );

        const [metrics, total] = await Promise.all([
            prisma.bodyMetrics.findMany({
                where: { userId: req.user!.userId },
                orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
                skip: offset,
                take: limit,
            }),
            prisma.bodyMetrics.count({
                where: { userId: req.user!.userId }
            })
        ]);

        const pagination = buildPaginationMeta(offset, limit, total);
        res.json({ data: metrics, pagination });
    } catch (err: any) {
        console.error('Error fetching body metrics:', err);
        res.status(500).json({ error: { message: 'Failed to fetch body metrics' } });
    }
});

// Create a new body metric record
router.post('/', authMiddleware, async (req: Request, res: Response) => {
    const parseResult = BodyMetricSchema.safeParse(req.body);
    if (!parseResult.success) {
        res.status(400).json({ error: { message: 'Validation error', details: parseResult.error.flatten() } });
        return;
    }

    const userId = req.user!.userId;
    const { date, ...metricsData } = parseResult.data;

    try {
        const result = await prisma.$transaction(async (tx) => {
            // 1. Create the historical metric record
            const metric = await tx.bodyMetrics.create({
                data: {
                    userId,
                    ...metricsData,
                    createdAt: date ? new Date(date) : undefined
                }
            });

            // 2. If weight is provided, update the User's current weight for consistency
            if (metricsData.weightKg) {
                await tx.user.update({
                    where: { id: userId },
                    data: { currentWeightKg: metricsData.weightKg }
                });
            }

            return metric;
        });

        res.status(201).json({ data: result });
    } catch (err: any) {
        console.error('Error logging body metrics:', err);
        res.status(500).json({ error: { message: 'Failed to save body metrics' } });
    }
});

export default router;
