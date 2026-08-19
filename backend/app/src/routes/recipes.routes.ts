import { Router, Request, Response } from 'express';
import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { parsePaginationParams, buildPaginationMeta } from '../adapters/pagination.adapter';
import { computeRecipeMacros } from '../lib/nutrition/recipeMacros';
import { MAX_GRAMS } from '../lib/nutrition/limits';
import { z } from 'zod';

const router = Router();

const RecipeIngredientInputSchema = z.object({
    foodItemId: z.string().uuid(),
    // Same ceiling POST /api/nutrition puts on a serving: an unbounded figure
    // here pushes the recipe's macros out of the range a double can hold, and
    // they reach the client as JSON `null` — which the picker rounds to 0 and
    // logs as a free meal. See lib/nutrition/limits.ts for the measured figures.
    grams: z.number().positive().max(MAX_GRAMS),
});

const CreateRecipeSchema = z.object({
    name: z.string().min(1).max(120),
    servings: z.number().int().min(1).max(100).default(1),
    ingredients: z.array(RecipeIngredientInputSchema).min(1).max(50),
});

/**
 * Declared field by field on purpose — NOT CreateRecipeSchema.partial().
 * `.partial()` keeps the `.default(1)` on servings, so a PATCH that only sends
 * a name would come out of zod carrying `servings: 1` and silently reset a
 * recipe that yields 8 servings back to 1.
 */
const UpdateRecipeSchema = z.object({
    name: z.string().min(1).max(120).optional(),
    servings: z.number().int().min(1).max(100).optional(),
    ingredients: z.array(RecipeIngredientInputSchema).min(1).max(50).optional(),
});

/** Single include shape — every read derives macros, so every read needs the food items. */
const withIngredients = {
    ingredients: { include: { foodItem: true } },
} satisfies Prisma.RecipeInclude;

type RecipeWithIngredients = Prisma.RecipeGetPayload<{ include: typeof withIngredients }>;

function toDetail(recipe: RecipeWithIngredients) {
    return {
        id: recipe.id,
        name: recipe.name,
        servings: recipe.servings,
        createdAt: recipe.createdAt,
        updatedAt: recipe.updatedAt,
        ingredients: recipe.ingredients.map((i) => ({
            id: i.id,
            foodItemId: i.foodItemId,
            grams: i.grams,
            foodItem: {
                id: i.foodItem.id,
                name: i.foodItem.name,
                brand: i.foodItem.brand,
                caloriesPer100g: i.foodItem.caloriesPer100g,
                proteinPer100g: i.foodItem.proteinPer100g,
                carbsPer100g: i.foodItem.carbsPer100g,
                fatPer100g: i.foodItem.fatPer100g,
            },
        })),
        nutrition: computeRecipeMacros(recipe.ingredients, recipe.servings),
    };
}

function toListItem(recipe: RecipeWithIngredients) {
    return {
        id: recipe.id,
        name: recipe.name,
        servings: recipe.servings,
        ingredientCount: recipe.ingredients.length,
        nutrition: computeRecipeMacros(recipe.ingredients, recipe.servings),
        createdAt: recipe.createdAt,
        updatedAt: recipe.updatedAt,
    };
}

/**
 * Fails with 400 (not a raw FK 500) when any referenced food item is missing.
 * Returns the list of ids that do not exist.
 */
async function findMissingFoodItemIds(ids: string[]): Promise<string[]> {
    const unique = [...new Set(ids)];
    const found = await prisma.foodItem.findMany({
        where: { id: { in: unique } },
        select: { id: true },
    });
    const foundIds = new Set(found.map((f) => f.id));
    return unique.filter((id) => !foundIds.has(id));
}

/**
 * Ownership and existence resolved in the same query: a recipe belonging to
 * another user is indistinguishable from one that does not exist (404, never
 * 403 — a 403 would confirm the id exists to anyone enumerating uuids).
 */
async function findOwnedRecipe(id: string, userId: string) {
    return prisma.recipe.findFirst({ where: { id, userId }, include: withIngredients });
}

const NOT_FOUND = { error: { message: 'Receta no encontrada' } };

router.get('/', async (req: Request, res: Response) => {
    try {
        const { offset, limit } = parsePaginationParams(
            req.query.offset as string | undefined,
            req.query.limit as string | undefined
        );
        const q = typeof req.query.q === 'string' ? req.query.q.trim() : undefined;
        const where: Prisma.RecipeWhereInput = {
            userId: req.user!.userId,
            ...(q ? { name: { contains: q, mode: 'insensitive' as const } } : {}),
        };

        const [recipes, total] = await Promise.all([
            prisma.recipe.findMany({
                where,
                include: withIngredients,
                orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
                skip: offset,
                take: limit,
            }),
            prisma.recipe.count({ where }),
        ]);

        res.json({ data: recipes.map(toListItem), pagination: buildPaginationMeta(offset, limit, total) });
    } catch (err: any) {
        console.error('Error fetching recipes:', err);
        res.status(500).json({ error: { message: 'Failed to fetch recipes' } });
    }
});

router.post('/', async (req: Request, res: Response) => {
    const parsed = CreateRecipeSchema.safeParse(req.body);
    if (!parsed.success) {
        res.status(400).json({ error: { message: 'Validation error', details: parsed.error.flatten() } });
        return;
    }
    const { name, servings, ingredients } = parsed.data;

    try {
        const missing = await findMissingFoodItemIds(ingredients.map((i) => i.foodItemId));
        if (missing.length > 0) {
            res.status(400).json({ error: { message: 'Alimento inexistente', details: { missingFoodItemIds: missing } } });
            return;
        }

        const created = await prisma.recipe.create({
            data: {
                userId: req.user!.userId,
                name,
                servings,
                ingredients: { create: ingredients.map((i) => ({ foodItemId: i.foodItemId, grams: i.grams })) },
            },
            include: withIngredients,
        });

        res.status(201).json({ data: toDetail(created) });
    } catch (err: any) {
        console.error('Error creating recipe:', err);
        res.status(500).json({ error: { message: 'Failed to create recipe' } });
    }
});

router.get('/:id', async (req: Request, res: Response) => {
    try {
        const recipe = await findOwnedRecipe(req.params.id as string, req.user!.userId);
        if (!recipe) {
            res.status(404).json(NOT_FOUND);
            return;
        }
        res.json({ data: toDetail(recipe) });
    } catch (err: any) {
        console.error('Error fetching recipe:', err);
        res.status(500).json({ error: { message: 'Failed to fetch recipe' } });
    }
});

router.patch('/:id', async (req: Request, res: Response) => {
    const parsed = UpdateRecipeSchema.safeParse(req.body);
    if (!parsed.success) {
        res.status(400).json({ error: { message: 'Validation error', details: parsed.error.flatten() } });
        return;
    }
    const { name, servings, ingredients } = parsed.data;

    try {
        const existing = await findOwnedRecipe(req.params.id as string, req.user!.userId);
        if (!existing) {
            res.status(404).json(NOT_FOUND);
            return;
        }

        if (ingredients) {
            const missing = await findMissingFoodItemIds(ingredients.map((i) => i.foodItemId));
            if (missing.length > 0) {
                res.status(400).json({ error: { message: 'Alimento inexistente', details: { missingFoodItemIds: missing } } });
                return;
            }
        }

        // Ingredients are replaced wholesale, never diffed: with <=50 rows the
        // diff buys nothing and complicates the contract.
        const updated = await prisma.$transaction(async (tx) => {
            if (ingredients) {
                await tx.recipeIngredient.deleteMany({ where: { recipeId: existing.id } });
                await tx.recipeIngredient.createMany({
                    data: ingredients.map((i) => ({ recipeId: existing.id, foodItemId: i.foodItemId, grams: i.grams })),
                });
            }
            return tx.recipe.update({
                where: { id: existing.id },
                data: {
                    ...(name !== undefined ? { name } : {}),
                    ...(servings !== undefined ? { servings } : {}),
                },
                include: withIngredients,
            });
        });

        res.json({ data: toDetail(updated) });
    } catch (err: any) {
        console.error('Error updating recipe:', err);
        res.status(500).json({ error: { message: 'Failed to update recipe' } });
    }
});

router.delete('/:id', async (req: Request, res: Response) => {
    try {
        const existing = await findOwnedRecipe(req.params.id as string, req.user!.userId);
        if (!existing) {
            res.status(404).json(NOT_FOUND);
            return;
        }
        await prisma.recipe.delete({ where: { id: existing.id } });
        res.status(204).send();
    } catch (err: any) {
        console.error('Error deleting recipe:', err);
        res.status(500).json({ error: { message: 'Failed to delete recipe' } });
    }
});

export default router;
