/**
 * The largest amount of food a single request may state, in grams or in units.
 *
 * `positive()` alone is not a bound: zod imposes no ceiling, so `1e308` is a
 * valid request. Macros are COMPUTED from this figure —
 * `caloriesPer100g * (grams / 100)` — and that product OVERFLOWS to Infinity
 * after validation has already passed, where nothing is left to catch it.
 *
 * What that costs differs per route, and both are real:
 *
 *  - `POST /api/nutrition`: Prisma binds Infinity as SQL NULL, so
 *    `COALESCE("calories", 0) + NULL` is NULL and the merge ERASES the very
 *    column the COALESCE was added to protect. A row of 1000 kcal was measured
 *    coming back with `calories: null` and `grams` poisoned at 1e308, at
 *    HTTP 200.
 *  - `POST /api/recipes`: the recipe's figures leave the representable range and
 *    come back as JSON `null`. MEASURED against `computeRecipeMacros` with the
 *    densest food the catalog now accepts (900 kcal/100g):
 *
 *      1 ingredient  @ 1e308 g -> total Infinity, per100g Infinity
 *      50 ingredients@ 1e308 g -> total Infinity, per100g NaN
 *      50 ingredients@ MAX_GRAMS -> total 45000000, per100g 900   (finite)
 *
 *    Which of Infinity or NaN comes out depends on whether `totalGrams` ITSELF
 *    overflowed: `per100g` is `total * (100 / totalGrams)`, so once the divisor
 *    is Infinity the factor is 0 and `Infinity * 0` is NaN. Neither reaches the
 *    client as itself — `JSON.stringify` has no encoding for either and emits
 *    `null` for both, the picker rounds that to 0, and the recipe is logged as
 *    zero calories. The cost is not a recipe that cannot be eaten; it is one
 *    eaten for free, with nothing reporting an error.
 *
 * Lives here rather than in either route because the two must agree: a ceiling
 * enforced on one path and not the other is a ceiling with a way around it.
 *
 * 100000 is far past any real serving — 100 kg of food, or 100000 eggs — so it
 * costs no legitimate caller anything, and it keeps every product it can
 * produce comfortably inside the range a Float can hold.
 */
export const MAX_GRAMS = 100000;
