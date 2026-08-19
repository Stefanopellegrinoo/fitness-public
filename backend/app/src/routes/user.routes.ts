import { Router, Request, Response } from 'express';
import { prisma } from '../lib/prisma';
import { authMiddleware } from '../middlewares/auth.middleware';
import { z } from 'zod';

const router = Router();

const UpdateProfileSchema = z.object({
    name: z.string().optional(),
    currentWeightKg: z.number().positive().optional(),
    heightCm: z.number().positive().optional(),
    birthDate: z.string().optional(),
    activityLevel: z.enum(['SEDENTARY', 'LIGHT', 'MODERATE', 'ACTIVE', 'VERY_ACTIVE']).optional(),
    goal: z.enum(['BULK', 'CUT', 'MAINTENANCE']).optional(),
});

// Get user profile
router.get('/profile', authMiddleware, async (req: Request, res: Response) => {
    try {
        const user = await prisma.user.findUnique({
            where: { id: req.user!.userId },
            select: {
                id: true,
                email: true,
                name: true,
                currentWeightKg: true,
                heightCm: true,
                birthDate: true,
                activityLevel: true,
                goal: true,
                createdAt: true
            }
        });
        
        if (!user) {
            res.status(404).json({ error: { message: 'User not found' } });
            return;
        }
        
        res.json({ data: user });
    } catch (err: any) {
        console.error('Error fetching user profile:', err);
        res.status(500).json({ error: { message: 'Failed to fetch profile' } });
    }
});

// Update user profile
router.patch('/profile', authMiddleware, async (req: Request, res: Response) => {
    const parseResult = UpdateProfileSchema.safeParse(req.body);
    if (!parseResult.success) {
        res.status(400).json({ error: { message: 'Validation error', details: parseResult.error.flatten() } });
        return;
    }

    const userId = req.user!.userId;

    try {
        const updatedUser = await prisma.user.update({
            where: { id: userId },
            data: {
                ...parseResult.data,
                birthDate: parseResult.data.birthDate ? new Date(parseResult.data.birthDate) : undefined
            }
        });

        res.json({ data: updatedUser });
    } catch (err: any) {
        console.error('Error updating user profile:', err);
        res.status(500).json({ error: { message: 'Failed to update profile' } });
    }
});

export default router;
