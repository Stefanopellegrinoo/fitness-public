import { z } from 'zod';

export const SetTypeSchema = z.enum(['WARMUP', 'WORKING', 'TOP', 'BACKOFF', 'DROP', 'MYOREP', 'RESTPAUSE', 'AMRAP']);
export const WeekdaySchema = z.enum(['LUNES', 'MARTES', 'MIERCOLES', 'JUEVES', 'VIERNES', 'SABADO', 'DOMINGO']);

export const RoutineSetPlanSchema = z.object({
    order: z.number().int().positive(),
    setType: SetTypeSchema.default('WORKING'),
    repsMin: z.number().int().positive().optional(),
    repsMax: z.number().int().positive().optional(),
    targetRpe: z.number().min(1).max(10).optional(),
    targetRir: z.number().int().min(0).max(10).optional(),
    percentOfTopSet: z.number().min(1).max(100).optional(),
    targetWeightKg: z.number().positive().optional(),
    restSeconds: z.number().int().positive().optional(),
}).refine(
    (plan) => plan.repsMin === undefined || plan.repsMax === undefined || plan.repsMin <= plan.repsMax,
    { message: 'repsMin must be <= repsMax' }
);

export const RoutineExerciseInputSchema = z.object({
    exerciseId: z.string().uuid(),
    order: z.number().int().nonnegative(),
    restSeconds: z.number().int().positive().optional(),
    notes: z.string().max(500).optional(),
    setPlans: z.array(RoutineSetPlanSchema).default([]),
});

export const RoutineDayInputSchema = z.object({
    name: z.string().min(1, 'Day name is required'),
    order: z.number().int().positive(),
    weekday: WeekdaySchema.optional(),
    exercises: z.array(RoutineExerciseInputSchema).min(1, 'At least one exercise per day'),
}).refine(
    (day) => new Set(day.exercises.map((ex) => ex.exerciseId)).size === day.exercises.length,
    { message: 'An exercise may appear at most once per day' }
);

export const CreateRoutineSchema = z.object({
    name: z.string().min(3, 'Routine name must be at least 3 characters'),
    days: z.array(RoutineDayInputSchema).min(1, 'At least one day is required'),
});

export const UpdateRoutineSchema = z.object({
    name: z.string().min(3).optional(),
    days: z.array(RoutineDayInputSchema).min(1).optional(),
});

export type CreateRoutineInput = z.infer<typeof CreateRoutineSchema>;
export type UpdateRoutineInput = z.infer<typeof UpdateRoutineSchema>;
