// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/api/client', () => ({ apiClient: vi.fn() }));

import { apiClient } from '@/lib/api/client';
import { getRecipes, getRecipe, createRecipe, updateRecipe, deleteRecipe } from './recipe.service';

const mockedClient = vi.mocked(apiClient);

const guiso = {
  id: 'recipe-1',
  name: 'Guiso de lentejas',
  servings: 4,
  ingredientCount: 6,
  nutrition: {
    totalGrams: 950,
    gramsPerServing: 237.5,
    total: { calories: 1420.5, protein: 88.2, carbs: 190.4, fat: 31.7 },
    per100g: { calories: 149.5, protein: 9.3, carbs: 20, fat: 3.3 },
    perServing: { calories: 355.1, protein: 22.1, carbs: 47.6, fat: 7.9 },
    hasIncompleteMacros: false,
  },
  createdAt: '2026-07-30T00:00:00.000Z',
  updatedAt: '2026-07-30T00:00:00.000Z',
};

function ok(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status });
}

describe('recipeService.getRecipes', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns the recipes of the list endpoint', async () => {
    mockedClient.mockResolvedValue(
      ok({ data: [guiso], pagination: { offset: 0, limit: 20, total: 1 } })
    );

    const { items } = await getRecipes();

    expect(items).toEqual([guiso]);
    expect(mockedClient.mock.calls[0][1]?.method).toBe('GET');
  });

  it('asks the recipes endpoint with an explicit limit', async () => {
    mockedClient.mockResolvedValue(
      ok({ data: [], pagination: { offset: 0, limit: 20, total: 0 } })
    );

    await getRecipes();

    expect(mockedClient.mock.calls[0][0]).toBe('/backend-api/recipes?limit=20');
  });

  // The endpoint is paginated. Without the total, a user with more recipes than
  // the page size would see a truncated list with no way to tell — the same
  // silent-incompleteness failure the spec rejected for the search tab.
  it('reports the server-side total, not just the page length', async () => {
    mockedClient.mockResolvedValue(
      ok({ data: [guiso], pagination: { offset: 0, limit: 20, total: 37 } })
    );

    const { items, total } = await getRecipes();

    expect(items).toHaveLength(1);
    expect(total).toBe(37);
  });

  it('falls back to the page length when the response carries no pagination', async () => {
    mockedClient.mockResolvedValue(ok({ data: [guiso] }));

    const { items, total } = await getRecipes();

    expect(items).toEqual([guiso]);
    expect(total).toBe(1);
  });

  it('throws when the request fails', async () => {
    mockedClient.mockResolvedValue(new Response(null, { status: 500 }));

    await expect(getRecipes()).rejects.toBeTruthy();
  });

  // The test above passes even with the status guard removed: an empty body makes
  // .json() throw on its own, so it proves nothing about the guard. A 500 that
  // carries parseable JSON is the case that only the guard can catch.
  it('throws on a failed response that carries a parseable body', async () => {
    mockedClient.mockResolvedValue(ok({ error: { message: 'Boom' } }, 500));

    await expect(getRecipes()).rejects.toBeTruthy();
  });
});

const detail = {
  ...guiso,
  ingredients: [
    {
      id: 'ing-1',
      foodItemId: 'food-1',
      grams: 300,
      foodItem: {
        id: 'food-1', name: 'Lentejas cocidas', brand: null,
        caloriesPer100g: 116, proteinPer100g: 9, carbsPer100g: 20.1, fatPer100g: 0.4,
      },
    },
  ],
};

const draft = {
  name: 'Guiso de lentejas',
  servings: 4,
  ingredients: [{ foodItemId: 'food-1', grams: 300 }],
};

describe('recipeService.createRecipe', () => {
  beforeEach(() => vi.clearAllMocks());

  it('POSTs the draft and returns the created recipe', async () => {
    mockedClient.mockResolvedValue(ok({ data: detail }, 201));

    const created = await createRecipe(draft);

    expect(created).toEqual(detail);
    expect(mockedClient.mock.calls[0][0]).toBe('/backend-api/recipes');
    expect(mockedClient.mock.calls[0][1]?.method).toBe('POST');
    expect(mockedClient.mock.calls[0][1]?.body).toBe(JSON.stringify(draft));
  });

  // The backend answers 201, not 200. A service that only accepts 200 would
  // treat every successful create as a failure.
  it('accepts the 201 the backend actually answers', async () => {
    mockedClient.mockResolvedValue(ok({ data: detail }, 201));

    await expect(createRecipe(draft)).resolves.toBeTruthy();
  });

  // The backend rejects a missing food item with a 400 that names the ids.
  it('throws when an ingredient references a food item that does not exist', async () => {
    mockedClient.mockResolvedValue(
      ok({ error: { message: 'Alimento inexistente', details: { missingFoodItemIds: ['food-9'] } } }, 400)
    );

    await expect(createRecipe(draft)).rejects.toBeTruthy();
  });
});

describe('recipeService.updateRecipe', () => {
  beforeEach(() => vi.clearAllMocks());

  it('PATCHes only the fields it was given', async () => {
    mockedClient.mockResolvedValue(ok({ data: detail }));

    await updateRecipe('recipe-1', { name: 'Guiso nuevo' });

    expect(mockedClient.mock.calls[0][0]).toBe('/backend-api/recipes/recipe-1');
    expect(mockedClient.mock.calls[0][1]?.method).toBe('PATCH');
    expect(mockedClient.mock.calls[0][1]?.body).toBe(JSON.stringify({ name: 'Guiso nuevo' }));
  });

  // Sending servings on a name-only edit is exactly the bug the backend's
  // UpdateRecipeSchema was written field-by-field to avoid: it would reset a
  // recipe that yields 8 back to 1.
  it('does not smuggle a servings value into a name-only edit', async () => {
    mockedClient.mockResolvedValue(ok({ data: detail }));

    await updateRecipe('recipe-1', { name: 'Guiso nuevo' });

    expect(mockedClient.mock.calls[0][1]?.body).not.toContain('servings');
  });

  it('returns the updated recipe', async () => {
    mockedClient.mockResolvedValue(ok({ data: detail }));

    await expect(updateRecipe('recipe-1', { servings: 8 })).resolves.toEqual(detail);
  });

  it('throws when the recipe is not the callers (404)', async () => {
    mockedClient.mockResolvedValue(ok({ error: { message: 'Receta no encontrada' } }, 404));

    await expect(updateRecipe('recipe-1', { servings: 8 })).rejects.toBeTruthy();
  });
});

describe('recipeService.deleteRecipe', () => {
  beforeEach(() => vi.clearAllMocks());

  // 204 carries no body: a service that parses one would throw on success.
  it('DELETEs the recipe and tolerates the empty 204 body', async () => {
    mockedClient.mockResolvedValue(new Response(null, { status: 204 }));

    await expect(deleteRecipe('recipe-1')).resolves.toBeUndefined();
    expect(mockedClient.mock.calls[0][0]).toBe('/backend-api/recipes/recipe-1');
    expect(mockedClient.mock.calls[0][1]?.method).toBe('DELETE');
  });

  it('throws on a delete the backend refuses (404)', async () => {
    mockedClient.mockResolvedValue(ok({ error: { message: 'Receta no encontrada' } }, 404));

    await expect(deleteRecipe('recipe-1')).rejects.toBeTruthy();
  });
});

// Editing needs the ingredients, and the list endpoint deliberately omits them.
describe('recipeService.getRecipe', () => {
  beforeEach(() => vi.clearAllMocks());

  it('GETs the detail, ingredients included', async () => {
    mockedClient.mockResolvedValue(ok({ data: detail }));

    const found = await getRecipe('recipe-1');

    expect(found.ingredients).toHaveLength(1);
    expect(mockedClient.mock.calls[0][0]).toBe('/backend-api/recipes/recipe-1');
    expect(mockedClient.mock.calls[0][1]?.method).toBe('GET');
  });

  // A recipe belonging to someone else is a 404, indistinguishable from one that
  // does not exist. Either way the editor must not open on it.
  it('throws on a recipe that is not the callers (404)', async () => {
    mockedClient.mockResolvedValue(ok({ error: { message: 'Receta no encontrada' } }, 404));

    await expect(getRecipe('recipe-1')).rejects.toBeTruthy();
  });
});

// The Buscar tab queries this endpoint with the same term it sends to /foods.
describe('recipeService.getRecipes with a query', () => {
  beforeEach(() => vi.clearAllMocks());

  it('sends the search term when it is given', async () => {
    mockedClient.mockResolvedValue(ok({ data: [], pagination: { offset: 0, limit: 20, total: 0 } }));

    await getRecipes('guiso');

    expect(mockedClient.mock.calls[0][0]).toContain('q=guiso');
  });

  it('encodes a term with spaces and accents', async () => {
    mockedClient.mockResolvedValue(ok({ data: [], pagination: { offset: 0, limit: 20, total: 0 } }));

    await getRecipes('guiso de lentejas ñ');

    expect(mockedClient.mock.calls[0][0]).toContain('q=guiso+de+lentejas+%C3%B1');
  });

  // Sending an empty q= is not the same as sending none: it is a filter on the
  // empty string, and the list call must stay a plain list.
  it('omits the parameter entirely when there is no term', async () => {
    mockedClient.mockResolvedValue(ok({ data: [], pagination: { offset: 0, limit: 20, total: 0 } }));

    await getRecipes();

    expect(mockedClient.mock.calls[0][0]).not.toContain('q=');
  });

  it('keeps the explicit page size alongside the term', async () => {
    mockedClient.mockResolvedValue(ok({ data: [], pagination: { offset: 0, limit: 20, total: 0 } }));

    await getRecipes('guiso');

    expect(mockedClient.mock.calls[0][0]).toContain('limit=20');
  });
});
