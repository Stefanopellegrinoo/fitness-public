// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

vi.mock('@/lib/api/food.service', () => ({
  foodService: {
    searchFoods: vi.fn().mockResolvedValue([]),
    createFood: vi.fn(),
    getFoodByBarcode: vi.fn().mockResolvedValue(null),
    getRecentFoods: vi.fn().mockResolvedValue([]),
    getFavorites: vi.fn().mockResolvedValue([]),
    addFavorite: vi.fn(),
    removeFavorite: vi.fn(),
  },
}));
vi.mock('@/lib/api/recipe.service', () => ({
  recipeService: { getRecipes: vi.fn().mockResolvedValue({ items: [], total: 0 }) },
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));

import { FoodSearchPanel } from './food-picker';
import { foodService } from '@/lib/api/food.service';
import { recipeService } from '@/lib/api/recipe.service';

const banana = {
  id: 'food-1', name: 'Banana', brand: 'Genérico', isGramBased: true,
  caloriesPer100g: 89, proteinPer100g: 1.1, carbsPer100g: 23, fatPer100g: 0.3,
};

const noop = () => {};
const type = (value: string) =>
  fireEvent.change(screen.getByPlaceholderText('Buscar alimento...'), { target: { value } });

describe('FoodSearchPanel', () => {
  beforeEach(() => vi.clearAllMocks());

  // Every keystroke reaching the API would put the OpenFoodFacts proxy - and its
  // rate limiter - behind a one-letter query that matches most of the catalog.
  it('does not search on a single character', async () => {
    render(<FoodSearchPanel onPick={noop} />);
    type('b');
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(foodService.searchFoods).not.toHaveBeenCalled();
  });

  it('searches once the query is long enough', async () => {
    render(<FoodSearchPanel onPick={noop} />);
    type('ba');
    await waitFor(() => expect(foodService.searchFoods).toHaveBeenCalledWith('ba'));
  });

  it('debounces a burst of keystrokes into one request', async () => {
    render(<FoodSearchPanel onPick={noop} />);
    type('ba');
    type('ban');
    type('bana');
    await waitFor(() => expect(foodService.searchFoods).toHaveBeenCalledTimes(1));
    expect(foodService.searchFoods).toHaveBeenCalledWith('bana');
  });

  // The test above types three times in one tick, so the effect cleanup collapses
  // them even with a zero-length debounce - it cannot tell 300ms from 0ms. This
  // one lets real time pass between keystrokes, which is what a person does.
  it('still collapses keystrokes separated by less than the debounce', async () => {
    render(<FoodSearchPanel onPick={noop} />);
    type('ba');
    await new Promise((resolve) => setTimeout(resolve, 100));
    type('ban');
    await new Promise((resolve) => setTimeout(resolve, 400));

    expect(foodService.searchFoods).toHaveBeenCalledTimes(1);
    expect(foodService.searchFoods).toHaveBeenCalledWith('ban');
  });

  it('drops the results when the query shrinks below the minimum', async () => {
    vi.mocked(foodService.searchFoods).mockResolvedValue([banana]);
    render(<FoodSearchPanel onPick={noop} />);
    type('ban');
    expect(await screen.findByText('Banana')).toBeTruthy();

    type('b');
    await waitFor(() => expect(screen.queryByText('Banana')).toBeNull());
  });

  it('hands the tapped food to onPick', async () => {
    vi.mocked(foodService.searchFoods).mockResolvedValue([banana]);
    const onPick = vi.fn();
    render(<FoodSearchPanel onPick={onPick} />);
    type('ban');
    fireEvent.click(await screen.findByText('Banana'));
    expect(onPick).toHaveBeenCalledWith(banana);
  });

  // The editor has no favourites to manage; a star there would be dead UI.
  it('hides the favourite star when no toggle is given', async () => {
    vi.mocked(foodService.searchFoods).mockResolvedValue([banana]);
    render(<FoodSearchPanel onPick={noop} />);
    type('ban');
    await screen.findByText('Banana');
    expect(screen.queryByRole('button', { name: /favoritos/i })).toBeNull();
  });

  it('shows the star when a toggle is given', async () => {
    vi.mocked(foodService.searchFoods).mockResolvedValue([banana]);
    render(
      <FoodSearchPanel onPick={noop} favoriteIds={new Set()} onToggleFavorite={noop} />
    );
    type('ban');
    await screen.findByText('Banana');
    expect(screen.getByRole('button', { name: 'Agregar a favoritos' })).toBeTruthy();
  });
});

const guiso = {
  id: 'recipe-1', name: 'Guiso de lentejas', servings: 4, ingredientCount: 6,
  nutrition: {
    totalGrams: 950, gramsPerServing: 237.5,
    total: { calories: 1400, protein: 88, carbs: 190, fat: 32 },
    per100g: { calories: 147.4, protein: 9.3, carbs: 20, fat: 3.4 },
    perServing: { calories: 350, protein: 22, carbs: 47.5, fat: 8 },
    hasIncompleteMacros: false,
  },
  createdAt: '2026-07-30T00:00:00.000Z', updatedAt: '2026-07-30T00:00:00.000Z',
};

describe('FoodSearchPanel with recipes mixed in', () => {
  beforeEach(() => vi.clearAllMocks());

  // J1 — the trap this prop exists to close. The editor uses this same panel to
  // pick an INGREDIENT, and a recipe id is not a FoodItem id: the backend would
  // answer 400 'Alimento inexistente'. Recipes must be opt-in, never the default.
  it('does not look for recipes unless asked to', async () => {
    vi.mocked(foodService.searchFoods).mockResolvedValue([banana]);
    render(<FoodSearchPanel onPick={noop} />);
    type('ban');
    await screen.findByText('Banana');
    expect(recipeService.getRecipes).not.toHaveBeenCalled();
  });

  it('queries both endpoints with the same term when asked to', async () => {
    vi.mocked(foodService.searchFoods).mockResolvedValue([banana]);
    vi.mocked(recipeService.getRecipes).mockResolvedValue({ items: [guiso], total: 1 });
    render(<FoodSearchPanel onPick={noop} includeRecipes onPickRecipe={noop} />);
    type('gui');

    await waitFor(() => expect(foodService.searchFoods).toHaveBeenCalledWith('gui'));
    expect(recipeService.getRecipes).toHaveBeenCalledWith('gui');
  });

  it('puts the recipes before the foods', async () => {
    vi.mocked(foodService.searchFoods).mockResolvedValue([banana]);
    vi.mocked(recipeService.getRecipes).mockResolvedValue({ items: [guiso], total: 1 });
    render(<FoodSearchPanel onPick={noop} includeRecipes onPickRecipe={noop} />);
    type('gui');

    await screen.findByText('Guiso de lentejas');
    const names = screen.getAllByRole('heading').map((h) => h.textContent);
    expect(names).toEqual(['Guiso de lentejas', 'Banana']);
  });

  // J5 — a recipe has no brand, and showing the "Genérico" fallback would make it
  // look like just another catalog item.
  it('labels a recipe as such instead of showing a brand', async () => {
    vi.mocked(foodService.searchFoods).mockResolvedValue([]);
    vi.mocked(recipeService.getRecipes).mockResolvedValue({ items: [guiso], total: 1 });
    render(<FoodSearchPanel onPick={noop} includeRecipes onPickRecipe={noop} />);
    type('gui');

    await screen.findByText('Guiso de lentejas');
    expect(screen.getByText(/Receta/i)).toBeTruthy();
    expect(screen.queryByText('Genérico')).toBeNull();
  });

  it('hands a tapped recipe to onPickRecipe, never to onPick', async () => {
    vi.mocked(foodService.searchFoods).mockResolvedValue([]);
    vi.mocked(recipeService.getRecipes).mockResolvedValue({ items: [guiso], total: 1 });
    const onPick = vi.fn();
    const onPickRecipe = vi.fn();
    render(<FoodSearchPanel onPick={onPick} includeRecipes onPickRecipe={onPickRecipe} />);
    type('gui');

    fireEvent.click(await screen.findByText('Guiso de lentejas'));
    expect(onPickRecipe).toHaveBeenCalledWith(guiso);
    expect(onPick).not.toHaveBeenCalled();
  });

  // J4 — the two queries are independent, so one failing must not blank the other.
  // Promise.all would reject as a whole and lose both.
  it('still shows the foods when the recipe search fails', async () => {
    vi.mocked(foodService.searchFoods).mockResolvedValue([banana]);
    vi.mocked(recipeService.getRecipes).mockRejectedValue(new Error('boom'));
    render(<FoodSearchPanel onPick={noop} includeRecipes onPickRecipe={noop} />);
    type('ban');

    expect(await screen.findByText('Banana')).toBeTruthy();
  });

  it('still shows the recipes when the food search fails', async () => {
    vi.mocked(foodService.searchFoods).mockRejectedValue(new Error('boom'));
    vi.mocked(recipeService.getRecipes).mockResolvedValue({ items: [guiso], total: 1 });
    render(<FoodSearchPanel onPick={noop} includeRecipes onPickRecipe={noop} />);
    type('gui');

    expect(await screen.findByText('Guiso de lentejas')).toBeTruthy();
  });

  it('gates the recipe search behind the same minimum query length', async () => {
    render(<FoodSearchPanel onPick={noop} includeRecipes onPickRecipe={noop} />);
    type('g');
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(recipeService.getRecipes).not.toHaveBeenCalled();
  });
});
