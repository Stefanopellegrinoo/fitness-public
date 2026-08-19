// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

vi.mock('@/lib/api/food.service', () => ({
  foodService: {
    searchFoods: vi.fn().mockResolvedValue([]),
    createFood: vi.fn().mockResolvedValue({ id: 'new-1' }),
    getFoodByBarcode: vi.fn().mockResolvedValue(null),
    getRecentFoods: vi.fn().mockResolvedValue([]),
    getFavorites: vi.fn().mockResolvedValue([]),
    addFavorite: vi.fn().mockResolvedValue(undefined),
    removeFavorite: vi.fn().mockResolvedValue(undefined),
  },
}));
vi.mock('@/lib/api/recipe.service', () => ({
  recipeService: {
    getRecipes: vi.fn().mockResolvedValue({ items: [], total: 0 }),
    getRecipe: vi.fn(),
    createRecipe: vi.fn().mockResolvedValue({ id: 'recipe-1' }),
    updateRecipe: vi.fn().mockResolvedValue({ id: 'recipe-1' }),
    deleteRecipe: vi.fn().mockResolvedValue(undefined),
  },
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));

import { AddFoodSheet } from './add-food-sheet';
import { foodService } from '@/lib/api/food.service';
import { recipeService } from '@/lib/api/recipe.service';

const banana = {
  id: 'food-1', name: 'Banana', brand: 'Genérico', isGramBased: true,
  caloriesPer100g: 89, proteinPer100g: 1.1, carbsPer100g: 23, fatPer100g: 0.3,
};

const noop = () => {};
const asyncNoop = async () => {};

describe('AddFoodSheet browse tabs', () => {
  beforeEach(() => vi.clearAllMocks());

  it('renders the five browse tabs', () => {
    render(<AddFoodSheet open onClose={noop} onAdd={asyncNoop} />);
    expect(screen.getByRole('tab', { name: /Recientes/i })).toBeTruthy();
    expect(screen.getByRole('tab', { name: /Favoritos/i })).toBeTruthy();
    expect(screen.getByRole('tab', { name: /Buscar/i })).toBeTruthy();
    expect(screen.getByRole('tab', { name: /Escanear/i })).toBeTruthy();
    expect(screen.getByRole('tab', { name: /Recetas/i })).toBeTruthy();
  });

  it('does not list recipes until the Recetas tab is opened', async () => {
    render(<AddFoodSheet open onClose={noop} onAdd={asyncNoop} />);
    await waitFor(() => expect(foodService.getRecentFoods).toHaveBeenCalled());
    expect(recipeService.getRecipes).not.toHaveBeenCalled();
  });

  it('lists the recipes once the Recetas tab is opened', async () => {
    vi.mocked(recipeService.getRecipes).mockResolvedValueOnce({
      items: [
        {
          id: 'recipe-1', name: 'Guiso de lentejas', servings: 4, ingredientCount: 6,
          nutrition: {
            totalGrams: 950, gramsPerServing: 237.5,
            total: { calories: 1400, protein: 88, carbs: 190, fat: 32 },
            per100g: { calories: 147.4, protein: 9.3, carbs: 20, fat: 3.4 },
            perServing: { calories: 350, protein: 22, carbs: 47.5, fat: 8 },
            hasIncompleteMacros: false,
          },
          createdAt: '2026-07-30T00:00:00.000Z', updatedAt: '2026-07-30T00:00:00.000Z',
        },
      ],
      total: 1,
    });
    render(<AddFoodSheet open onClose={noop} onAdd={asyncNoop} />);
    fireEvent.mouseDown(screen.getByRole('tab', { name: /Recetas/i }));
    expect(await screen.findByText('Guiso de lentejas')).toBeTruthy();
  });

  // G6 — the recipes fetch is deliberately NOT part of the sheet's Promise.all:
  // that one rejects as a whole, so a recipes failure would blank out the two
  // tabs that were already working.
  it('keeps Recientes populated when the recipes fetch fails', async () => {
    vi.mocked(foodService.getRecentFoods).mockResolvedValueOnce([banana]);
    vi.mocked(recipeService.getRecipes).mockRejectedValueOnce(new Error('boom'));
    render(<AddFoodSheet open onClose={noop} onAdd={asyncNoop} />);
    fireEvent.mouseDown(screen.getByRole('tab', { name: /Recetas/i }));
    await screen.findByText(/No pudimos cargar tus recetas/i);
    fireEvent.mouseDown(screen.getByRole('tab', { name: /Recientes/i }));
    expect(await screen.findByText('Banana')).toBeTruthy();
  });

  // The failure copy promises "volvé a entrar a esta pestaña para reintentar".
  // Radix unmounts inactive tab content, so leaving and coming back remounts the
  // tab and refetches — but nothing verified that the promise was true.
  it('retries the recipes fetch when the tab is re-entered', async () => {
    vi.mocked(recipeService.getRecipes).mockRejectedValueOnce(new Error('boom'));
    render(<AddFoodSheet open onClose={noop} onAdd={asyncNoop} />);
    fireEvent.mouseDown(screen.getByRole('tab', { name: /Recetas/i }));
    await screen.findByText(/No pudimos cargar tus recetas/i);

    fireEvent.mouseDown(screen.getByRole('tab', { name: /Recientes/i }));
    fireEvent.mouseDown(screen.getByRole('tab', { name: /Recetas/i }));

    await waitFor(() => expect(recipeService.getRecipes).toHaveBeenCalledTimes(2));
    expect(await screen.findByText(/Todavía no tenés recetas/i)).toBeTruthy();
  });

  it('fetches recent and favorites when opened', async () => {
    render(<AddFoodSheet open onClose={noop} onAdd={asyncNoop} />);
    await waitFor(() => {
      expect(foodService.getRecentFoods).toHaveBeenCalled();
      expect(foodService.getFavorites).toHaveBeenCalled();
    });
  });

  it('renders recent foods in the Recientes tab', async () => {
    vi.mocked(foodService.getRecentFoods).mockResolvedValueOnce([banana]);
    render(<AddFoodSheet open onClose={noop} onAdd={asyncNoop} />);
    expect(await screen.findByText('Banana')).toBeTruthy();
  });

  it('goes to the amount step when a recent food row is tapped', async () => {
    vi.mocked(foodService.getRecentFoods).mockResolvedValueOnce([banana]);
    render(<AddFoodSheet open onClose={noop} onAdd={asyncNoop} />);
    fireEvent.click(await screen.findByText('Banana'));
    expect(await screen.findByText('Cantidad')).toBeTruthy();
  });

  it('calls addFavorite when starring a non-favorite recent food', async () => {
    vi.mocked(foodService.getRecentFoods).mockResolvedValueOnce([banana]);
    vi.mocked(foodService.getFavorites).mockResolvedValueOnce([]);
    render(<AddFoodSheet open onClose={noop} onAdd={asyncNoop} />);
    await screen.findByText('Banana');
    fireEvent.click(screen.getByRole('button', { name: 'Agregar a favoritos' }));
    await waitFor(() => expect(foodService.addFavorite).toHaveBeenCalledWith('food-1'));
  });

  it('calls removeFavorite when un-starring a favorite recent food', async () => {
    vi.mocked(foodService.getRecentFoods).mockResolvedValueOnce([banana]);
    vi.mocked(foodService.getFavorites).mockResolvedValueOnce([banana]);
    render(<AddFoodSheet open onClose={noop} onAdd={asyncNoop} />);
    await screen.findByText('Banana');
    fireEvent.click(screen.getByRole('button', { name: 'Quitar de favoritos' }));
    await waitFor(() => expect(foodService.removeFavorite).toHaveBeenCalledWith('food-1'));
  });

  // handleClose used to reset the search query by hand. It now lives inside
  // FoodSearchPanel, which the closed sheet unmounts — so the reset happens for
  // free. This test is what keeps that "for free" honest.
  it('comes back with an empty search box after being closed and reopened', async () => {
    const { rerender } = render(<AddFoodSheet open onClose={noop} onAdd={asyncNoop} />);
    fireEvent.mouseDown(screen.getByRole('tab', { name: /Buscar/i }));
    fireEvent.change(screen.getByPlaceholderText('Buscar alimento...'), {
      target: { value: 'manzana' },
    });
    expect((screen.getByPlaceholderText('Buscar alimento...') as HTMLInputElement).value)
      .toBe('manzana');

    rerender(<AddFoodSheet open={false} onClose={noop} onAdd={asyncNoop} />);
    rerender(<AddFoodSheet open onClose={noop} onAdd={asyncNoop} />);

    fireEvent.mouseDown(screen.getByRole('tab', { name: /Buscar/i }));
    expect((screen.getByPlaceholderText('Buscar alimento...') as HTMLInputElement).value).toBe('');
  });

  it('still searches when typing in the Buscar tab', async () => {
    vi.mocked(foodService.searchFoods).mockResolvedValue([
      { ...banana, id: 'food-2', name: 'Manzana' },
    ]);
    render(<AddFoodSheet open onClose={noop} onAdd={asyncNoop} />);
    // NOTE: Radix TabsTrigger (v1.1.13) switches the active tab on `mousedown`,
    // not `click` — fireEvent.click() only dispatches a `click` event and never
    // fires the tab switch. A real user's click always includes a mousedown, so
    // this is a jsdom/testing-library simulation gap, not a real-world issue.
    fireEvent.mouseDown(screen.getByRole('tab', { name: /Buscar/i }));
    fireEvent.change(screen.getByPlaceholderText('Buscar alimento...'), {
      target: { value: 'man' },
    });
    await waitFor(() => expect(foodService.searchFoods).toHaveBeenCalledWith('man'));
    expect(await screen.findByText('Manzana')).toBeTruthy();
  });
});

const guisoRow = {
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

describe('AddFoodSheet recipe editing', () => {
  beforeEach(() => vi.clearAllMocks());

  it('offers the custom food button while browsing foods', () => {
    render(<AddFoodSheet open onClose={noop} onAdd={asyncNoop} />);
    expect(screen.getByRole('button', { name: /Alimento Personalizado/i })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Nueva receta/i })).toBeNull();
  });

  // The same slot, because it is the same intent: create the kind of thing this
  // tab lists. A custom food button on the Recetas tab creates the wrong thing.
  it('swaps it for the new recipe button on the Recetas tab', async () => {
    render(<AddFoodSheet open onClose={noop} onAdd={asyncNoop} />);
    fireEvent.mouseDown(screen.getByRole('tab', { name: /Recetas/i }));
    expect(await screen.findByRole('button', { name: /Nueva receta/i })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Alimento Personalizado/i })).toBeNull();
  });

  it('opens the editor with no recipe loaded when creating', async () => {
    render(<AddFoodSheet open onClose={noop} onAdd={asyncNoop} />);
    fireEvent.mouseDown(screen.getByRole('tab', { name: /Recetas/i }));
    fireEvent.click(await screen.findByRole('button', { name: /Nueva receta/i }));
    expect(await screen.findByLabelText('Nombre de la receta')).toBeTruthy();
    expect(recipeService.getRecipe).not.toHaveBeenCalled();
  });

  it('opens the editor on the tapped row when editing', async () => {
    vi.mocked(recipeService.getRecipes).mockResolvedValueOnce({ items: [guisoRow], total: 1 });
    vi.mocked(recipeService.getRecipe).mockResolvedValueOnce({ ...guisoRow, ingredients: [] } as never);
    render(<AddFoodSheet open onClose={noop} onAdd={asyncNoop} />);
    fireEvent.mouseDown(screen.getByRole('tab', { name: /Recetas/i }));
    fireEvent.click(await screen.findByLabelText('Editar Guiso de lentejas'));
    await waitFor(() => expect(recipeService.getRecipe).toHaveBeenCalledWith('recipe-1'));
  });

  // Tapping the row logs the recipe; only the pencil edits it. Confusing the two
  // would make every attempt to log a recipe open the editor instead.
  it('logs the recipe when the row itself is tapped', async () => {
    vi.mocked(recipeService.getRecipes).mockResolvedValueOnce({ items: [guisoRow], total: 1 });
    render(<AddFoodSheet open onClose={noop} onAdd={asyncNoop} />);
    fireEvent.mouseDown(screen.getByRole('tab', { name: /Recetas/i }));
    fireEvent.click(await screen.findByText('Guiso de lentejas'));
    expect(await screen.findByText(/Confirmar Registro/i)).toBeTruthy();
    expect(recipeService.getRecipe).not.toHaveBeenCalled();
  });

  // A saved recipe the list does not re-fetch is invisible until the sheet is
  // reopened, which reads as "it did not save".
  it('reloads the recipe list after the editor saves', async () => {
    vi.mocked(recipeService.getRecipes).mockResolvedValue({ items: [], total: 0 });
    vi.mocked(recipeService.createRecipe).mockResolvedValueOnce({ id: 'recipe-9' } as never);
    vi.mocked(foodService.searchFoods).mockResolvedValue([banana]);

    render(<AddFoodSheet open onClose={noop} onAdd={asyncNoop} />);
    fireEvent.mouseDown(screen.getByRole('tab', { name: /Recetas/i }));
    await waitFor(() => expect(recipeService.getRecipes).toHaveBeenCalledTimes(1));

    fireEvent.click(await screen.findByRole('button', { name: /Nueva receta/i }));
    fireEvent.click(await screen.findByRole('button', { name: /Agregar Ingrediente/i }));
    fireEvent.change(screen.getByPlaceholderText('Buscar ingrediente...'), { target: { value: 'ban' } });
    fireEvent.click(await screen.findByText('Banana'));
    fireEvent.change(screen.getByLabelText('Nombre de la receta'), { target: { value: 'Licuado' } });
    fireEvent.click(screen.getByRole('button', { name: /Crear Receta/i }));

    await waitFor(() => expect(recipeService.getRecipes).toHaveBeenCalledTimes(2));
  });
});

describe('AddFoodSheet mixed search', () => {
  beforeEach(() => vi.clearAllMocks());

  it('shows the user recipes before the catalog foods', async () => {
    vi.mocked(foodService.searchFoods).mockResolvedValue([banana]);
    vi.mocked(recipeService.getRecipes).mockResolvedValue({ items: [guisoRow], total: 1 });
    render(<AddFoodSheet open onClose={noop} onAdd={asyncNoop} />);
    fireEvent.mouseDown(screen.getByRole('tab', { name: /Buscar/i }));
    fireEvent.change(screen.getByPlaceholderText('Buscar alimento...'), {
      target: { value: 'gui' },
    });

    await screen.findByText('Guiso de lentejas');
    // Relative order, not the full list: the sheet title is a heading too, and
    // the guarantee is "recipes come first", not "these are the only headings".
    const names = screen.getAllByRole('heading').map((h) => h.textContent);
    expect(names.indexOf('Guiso de lentejas')).toBeGreaterThan(-1);
    expect(names.indexOf('Guiso de lentejas')).toBeLessThan(names.indexOf('Banana'));
  });

  it('takes a recipe found in Buscar to the recipe amount step', async () => {
    vi.mocked(foodService.searchFoods).mockResolvedValue([]);
    vi.mocked(recipeService.getRecipes).mockResolvedValue({ items: [guisoRow], total: 1 });
    render(<AddFoodSheet open onClose={noop} onAdd={asyncNoop} />);
    fireEvent.mouseDown(screen.getByRole('tab', { name: /Buscar/i }));
    fireEvent.change(screen.getByPlaceholderText('Buscar alimento...'), {
      target: { value: 'gui' },
    });
    fireEvent.click(await screen.findByText('Guiso de lentejas'));

    // The recipe step, not the food one: it has the servings/grams toggle.
    expect(await screen.findByRole('button', { name: /Porciones/i })).toBeTruthy();
  });
});
