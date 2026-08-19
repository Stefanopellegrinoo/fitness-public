import { Router, Request, Response } from 'express';
import { Prisma, type FoodItem } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { parsePaginationParams, buildPaginationMeta } from '../adapters/pagination.adapter';
import { offProxyLimiter } from '../middlewares/rate-limit.middleware';
import { upsertFoods } from '../lib/nutrition/foodSeed';
import { fetchOffProductByBarcode, searchOffProducts } from '../lib/nutrition/openfoodfacts';
import { MAX_KCAL as MAX_KCAL_PER_100G, MAX_MACRO as MAX_MACRO_PER_100G } from '../lib/nutrition/offMacros';
import { z } from 'zod';

const router = Router();

const OFF_AUGMENT_THRESHOLD = 10;
const OFF_SEARCH_LIMIT = 20;

/**
 * `FoodItem` has no `userId`: this is ONE shared catalog, so these four figures
 * are not the caller's own data — they are what every other user's diary and
 * recipes will compute from. They are bounded with the same physical ceilings
 * `offMacros.hasSaneMacros` already applies to third-party rows, because a
 * logged-in user should not be able to write what OpenFoodFacts cannot.
 *
 * Unbounded, they overflow downstream rather than here: `caloriesPer100g: 1e308`
 * validates, stores at 201, and only leaves the representable range when a
 * recipe multiplies it by a serving. `JSON.stringify` has no encoding for
 * Infinity, so it ships `null`, the client rounds it to 0, and the meal is
 * logged as zero calories with nothing anywhere reporting an error.
 *
 * `nonnegative` rather than `hasSaneMacros`'s `kcal > 0`: a zero here is water
 * or black coffee, whereas a zero from OFF is a missing figure.
 */
const FoodSchema = z.object({
    name: z.string(),
    brand: z.string().optional(),
    barcode: z.string().optional(),
    caloriesPer100g: z.number().nonnegative().max(MAX_KCAL_PER_100G).optional(),
    proteinPer100g: z.number().nonnegative().max(MAX_MACRO_PER_100G).optional(),
    carbsPer100g: z.number().nonnegative().max(MAX_MACRO_PER_100G).optional(),
    fatPer100g: z.number().nonnegative().max(MAX_MACRO_PER_100G).optional(),
    servingName: z.string().default('100g'),
    isGramBased: z.boolean().default(true)
});

const FavoriteSchema = z.object({ foodItemId: z.string().uuid() });

/**
 * In-memory ranking of catalog rows for a query:
 * exact-name-match=0, name startsWith q=1, source==='GENERIC'=2, else=3.
 * Ties broken by name.localeCompare. Pure — returns a new array.
 */
function rankFoods(foods: FoodItem[], q?: string): FoodItem[] {
    if (!q) return foods;
    const ql = q.toLowerCase();
    const score = (f: FoodItem): number => {
        const nl = f.name.toLowerCase();
        if (nl === ql) return 0;
        if (nl.startsWith(ql)) return 1;
        if (f.source === 'GENERIC') return 2;
        return 3;
    };
    return [...foods].sort((a, b) => {
        const diff = score(a) - score(b);
        return diff !== 0 ? diff : a.name.localeCompare(b.name);
    });
}

// Hybrid search: local catalog, augmented from OpenFoodFacts when sparse.
router.get('/', offProxyLimiter, async (req: Request, res: Response) => {
    const q = typeof req.query.q === 'string' ? req.query.q : undefined;

    try {
        const { offset, limit } = parsePaginationParams(
            req.query.offset as string | undefined,
            req.query.limit as string | undefined
        );

        const where: Prisma.FoodItemWhereInput = q
            ? { name: { contains: q, mode: 'insensitive' } }
            : {};

        if (q && offset === 0) {
            const localCount = await prisma.foodItem.count({ where });
            if (localCount < OFF_AUGMENT_THRESHOLD) {
                const off = await searchOffProducts(q, OFF_SEARCH_LIMIT);
                if (off.length) await upsertFoods(prisma, off);
            }
        }

        const [foods, total] = await Promise.all([
            prisma.foodItem.findMany({ where, orderBy: [{ name: 'asc' }, { id: 'asc' }], skip: offset, take: limit }),
            prisma.foodItem.count({ where }),
        ]);

        const pagination = buildPaginationMeta(offset, limit, total);
        res.json({ data: rankFoods(foods, q), pagination });
    } catch (err: any) {
        console.error('Error fetching foods:', err);
        res.status(500).json({ error: { message: 'Failed to fetch foods' } });
    }
});

// Barcode lookup: local catalog first, then OpenFoodFacts (cached on hit).
router.get('/barcode/:code', offProxyLimiter, async (req: Request, res: Response) => {
    const code = req.params.code as string;

    try {
        let food = await prisma.foodItem.findUnique({ where: { barcode: code } });
        if (!food) {
            const off = await fetchOffProductByBarcode(code);
            if (off) {
                await upsertFoods(prisma, [off]);
                food = await prisma.foodItem.findUnique({ where: { externalId: off.externalId } });
            }
        }
        if (!food) {
            res.status(404).json({ error: { message: 'Alimento no encontrado para ese código de barras' } });
            return;
        }
        res.json({ data: food });
    } catch (err: any) {
        console.error('Error fetching food by barcode:', err);
        res.status(500).json({ error: { message: 'Failed to fetch food by barcode' } });
    }
});

// Recently logged foods for the current user (distinct, most recent first).
router.get('/recent', async (req: Request, res: Response) => {
    try {
        const take = Math.min(Math.max(parseInt((req.query.limit as string) ?? '10', 10) || 10, 1), 50);
        // `date` alone is not a total order, and here the ties are the RULE
        // rather than the exception: the diary freezes one `new Date()` when the
        // page mounts and stamps every entry of that visit with it, so the
        // breakfast, lunch and dinner logged in one sitting share a `date` down
        // to the millisecond while pointing at different foods. Truncating that
        // with `take` leaves WHICH foods survive the cut undefined -- not just
        // their order -- so the user sees a different set of recent foods for
        // the same history. `id` breaks the tie in the same direction.
        //
        // Prisma 5 resolves `distinct` in memory, so the LIMIT is not
        // pushed down -- this reads the user's whole nutrition history to return
        // `take` rows (measured: 600 rows transferred for 10). Fine at current
        // volumes; move to a raw `DISTINCT ON` subquery if a heavy user's
        // history makes it hurt.
        const entries = await prisma.nutritionEntry.findMany({
            where: { userId: req.user!.userId, foodItemId: { not: null } },
            orderBy: [{ date: 'desc' }, { id: 'desc' }],
            distinct: ['foodItemId'],
            take,
            include: { foodItem: true },
        });
        res.json({ data: entries.map(e => e.foodItem).filter(Boolean) });
    } catch (err: any) {
        console.error('Error fetching recent foods:', err);
        res.status(500).json({ error: { message: 'Failed to fetch recent foods' } });
    }
});

// Favorites for the current user (newest first).
router.get('/favorites', async (req: Request, res: Response) => {
    try {
        const favs = await prisma.foodFavorite.findMany({
            where: { userId: req.user!.userId },
            // Nothing is truncated here, so no row can go missing -- but two
            // favorites saved in the same millisecond would come back in
            // whichever order the plan happened to produce, and the list would
            // reshuffle between identical requests. Same tiebreaker as
            // everywhere else, so the rule holds without exceptions to remember.
            orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
            include: { foodItem: true },
        });
        res.json({ data: favs.map(f => f.foodItem) });
    } catch (err: any) {
        console.error('Error fetching favorite foods:', err);
        res.status(500).json({ error: { message: 'Failed to fetch favorite foods' } });
    }
});

// Add a favorite (idempotent via upsert on the userId_foodItemId compound key).
router.post('/favorites', async (req: Request, res: Response) => {
    const parsed = FavoriteSchema.safeParse(req.body);
    if (!parsed.success) {
        res.status(400).json({ error: { message: 'Validation error', details: parsed.error.flatten() } });
        return;
    }

    try {
        const fav = await prisma.foodFavorite.upsert({
            where: { userId_foodItemId: { userId: req.user!.userId, foodItemId: parsed.data.foodItemId } },
            update: {},
            create: { userId: req.user!.userId, foodItemId: parsed.data.foodItemId },
        });
        res.status(201).json({ data: fav });
    } catch (err: any) {
        console.error('Error saving favorite food:', err);
        res.status(500).json({ error: { message: 'Failed to save favorite food' } });
    }
});

// Remove a favorite.
router.delete('/favorites/:foodItemId', async (req: Request, res: Response) => {
    const foodItemId = req.params.foodItemId as string;
    try {
        await prisma.foodFavorite.deleteMany({
            where: { userId: req.user!.userId, foodItemId },
        });
        res.status(204).send();
    } catch (err: any) {
        console.error('Error removing favorite food:', err);
        res.status(500).json({ error: { message: 'Failed to remove favorite food' } });
    }
});

// Protected: Create food (admin/user-contributed). Auth comes from the /api/foods mount.
router.post('/', async (req: Request, res: Response) => {
    const parseResult = FoodSchema.safeParse(req.body);
    if (!parseResult.success) {
        res.status(400).json({ error: { message: 'Validation error', details: parseResult.error.flatten() } });
        return;
    }

    try {
        const food = await prisma.foodItem.create({
            data: parseResult.data
        });
        res.status(201).json({ data: food });
    } catch (err: any) {
        console.error('Error creating food:', err);
        res.status(500).json({ error: { message: 'Failed to create food' } });
    }
});

export default router;
