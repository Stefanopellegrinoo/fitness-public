// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

vi.mock('@/lib/api/recipe.service', () => ({
  recipeService: {
    getRecipes: vi.fn().mockResolvedValue({ items: [], total: 0 }),
    getRecipe: vi.fn(),
    createRecipe: vi.fn().mockResolvedValue({ id: 'recipe-1' }),
    updateRecipe: vi.fn().mockResolvedValue({ id: 'recipe-1' }),
    deleteRecipe: vi.fn().mockResolvedValue(undefined),
  },
}));
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
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));
vi.mock('./barcode-scanner', () => ({
  BarcodeScanner: ({ onScan }: { onScan: (code: string) => void }) => (
    <button type="button" data-testid="mock-scan" onClick={() => onScan('779000000000')}>
      scan
    </button>
  ),
}));

import { RecipeEditorSheet } from './recipe-editor-sheet';
import { recipeService } from '@/lib/api/recipe.service';
import { foodService } from '@/lib/api/food.service';
import { FoodItem } from '@/lib/types/api.types';

const lentejas = {
  id: 'food-1', name: 'Lentejas cocidas', brand: 'Genérico', isGramBased: true,
  caloriesPer100g: 116, proteinPer100g: 9, carbsPer100g: 20.1, fatPer100g: 0.4,
};
const arroz = {
  id: 'food-2', name: 'Arroz blanco cocido', brand: 'Genérico', isGramBased: true,
  caloriesPer100g: 130, proteinPer100g: 2.7, carbsPer100g: 28.2, fatPer100g: 0.3,
};
const sinGrasa = { ...lentejas, id: 'food-3', name: 'Alimento incompleto', fatPer100g: null };

const existing = {
  id: 'recipe-1',
  name: 'Guiso de lentejas',
  servings: 4,
  createdAt: '2026-07-30T00:00:00.000Z',
  updatedAt: '2026-07-30T00:00:00.000Z',
  ingredients: [
    {
      id: 'ing-1', foodItemId: 'food-1', grams: 300,
      foodItem: {
        id: 'food-1', name: 'Lentejas cocidas', brand: 'Genérico',
        caloriesPer100g: 116, proteinPer100g: 9, carbsPer100g: 20.1, fatPer100g: 0.4,
      },
    },
  ],
  nutrition: {
    totalGrams: 300, gramsPerServing: 75,
    total: { calories: 348, protein: 27, carbs: 60.3, fat: 1.2 },
    per100g: { calories: 116, protein: 9, carbs: 20.1, fat: 0.4 },
    perServing: { calories: 87, protein: 6.75, carbs: 15.075, fat: 0.3 },
    hasIncompleteMacros: false,
  },
};

const noop = () => {};

/** Adds a food through the search panel, debounce included. */
async function addViaSearch(food: FoodItem) {
  vi.mocked(foodService.searchFoods).mockResolvedValue([food]);
  fireEvent.click(screen.getByRole('button', { name: /Agregar Ingrediente/i }));
  fireEvent.change(screen.getByPlaceholderText('Buscar ingrediente...'), {
    target: { value: 'len' },
  });
  fireEvent.click(await screen.findByText(food.name));
}

const renderNew = () =>
  render(<RecipeEditorSheet open recipeId={null} onClose={noop} onSaved={noop} />);

describe('RecipeEditorSheet — creating', () => {
  beforeEach(() => vi.clearAllMocks());

  it('opens empty, with saving blocked', () => {
    renderNew();
    expect((screen.getByLabelText('Nombre de la receta') as HTMLInputElement).value).toBe('');
    expect(screen.getByRole('button', { name: /Crear Receta/i }).hasAttribute('disabled')).toBe(true);
  });

  it('offers no delete button on a recipe that does not exist yet', () => {
    renderNew();
    expect(screen.queryByRole('button', { name: /Borrar Receta/i })).toBeNull();
  });

  it('adds an ingredient picked from the search panel', async () => {
    renderNew();
    await addViaSearch(lentejas);
    expect(await screen.findByText('Lentejas cocidas')).toBeTruthy();
  });

  it('adds an ingredient picked by scanning a barcode', async () => {
    vi.mocked(foodService.getFoodByBarcode).mockResolvedValueOnce(arroz);
    renderNew();
    fireEvent.click(screen.getByRole('button', { name: /Agregar Ingrediente/i }));
    fireEvent.click(screen.getByRole('button', { name: /Escanear/i }));
    fireEvent.click(screen.getByTestId('mock-scan'));
    expect(await screen.findByText('Arroz blanco cocido')).toBeTruthy();
  });

  it('starts a new ingredient at 100 g', async () => {
    renderNew();
    await addViaSearch(lentejas);
    const grams = await screen.findByLabelText('Gramos de Lentejas cocidas');
    expect((grams as HTMLInputElement).value).toBe('100');
  });

  it('removes an ingredient', async () => {
    renderNew();
    await addViaSearch(lentejas);
    fireEvent.click(await screen.findByLabelText('Quitar Lentejas cocidas'));
    await waitFor(() => expect(screen.queryByText('Lentejas cocidas')).toBeNull());
  });

  it('recomputes the per-serving totals live as grams change', async () => {
    renderNew();
    await addViaSearch(lentejas);
    expect(await screen.findByText('116')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Gramos de Lentejas cocidas'), { target: { value: '200' } });
    expect(await screen.findByText('232')).toBeTruthy();
  });

  it('recomputes the per-serving totals live as the yield changes', async () => {
    renderNew();
    await addViaSearch(lentejas);
    expect(await screen.findByText('116')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Rinde'), { target: { value: '2' } });
    expect(await screen.findByText('58')).toBeTruthy();
  });

  it('flags a draft holding an ingredient with a missing macro', async () => {
    renderNew();
    await addViaSearch(sinGrasa);
    expect(await screen.findByText(/Datos incompletos/i)).toBeTruthy();
  });

  it('sends the draft as a create payload', async () => {
    renderNew();
    await addViaSearch(lentejas);
    fireEvent.change(screen.getByLabelText('Nombre de la receta'), { target: { value: '  Guiso  ' } });
    fireEvent.change(screen.getByLabelText('Rinde'), { target: { value: '4' } });
    fireEvent.change(screen.getByLabelText('Gramos de Lentejas cocidas'), { target: { value: '300' } });
    fireEvent.click(screen.getByRole('button', { name: /Crear Receta/i }));

    await waitFor(() => expect(recipeService.createRecipe).toHaveBeenCalled());
    expect(vi.mocked(recipeService.createRecipe).mock.calls[0][0]).toEqual({
      name: 'Guiso',
      servings: 4,
      ingredients: [{ foodItemId: 'food-1', grams: 300 }],
    });
  });

  it('does not create a recipe when the sheet is in edit mode', async () => {
    vi.mocked(recipeService.getRecipe).mockResolvedValueOnce(existing);
    render(<RecipeEditorSheet open recipeId="recipe-1" onClose={noop} onSaved={noop} />);
    fireEvent.click(await screen.findByRole('button', { name: /Guardar Cambios/i }));
    await waitFor(() => expect(recipeService.updateRecipe).toHaveBeenCalled());
    expect(recipeService.createRecipe).not.toHaveBeenCalled();
  });
});

describe('RecipeEditorSheet — validation before the round trip', () => {
  beforeEach(() => vi.clearAllMocks());

  it('blocks a recipe with no name', async () => {
    renderNew();
    await addViaSearch(lentejas);
    expect(screen.getByRole('button', { name: /Crear Receta/i }).hasAttribute('disabled')).toBe(true);
  });

  // The backend requires at least one ingredient; a nameless-but-empty recipe
  // would otherwise round-trip only to come back a 400.
  it('blocks a recipe with no ingredients', () => {
    renderNew();
    fireEvent.change(screen.getByLabelText('Nombre de la receta'), { target: { value: 'Guiso' } });
    expect(screen.getByRole('button', { name: /Crear Receta/i }).hasAttribute('disabled')).toBe(true);
  });

  it('blocks a yield below one', async () => {
    renderNew();
    await addViaSearch(lentejas);
    fireEvent.change(screen.getByLabelText('Nombre de la receta'), { target: { value: 'Guiso' } });
    fireEvent.change(screen.getByLabelText('Rinde'), { target: { value: '0' } });
    expect(screen.getByRole('button', { name: /Crear Receta/i }).hasAttribute('disabled')).toBe(true);
  });

  it('blocks an ingredient weighing zero', async () => {
    renderNew();
    await addViaSearch(lentejas);
    fireEvent.change(screen.getByLabelText('Nombre de la receta'), { target: { value: 'Guiso' } });
    fireEvent.change(screen.getByLabelText('Gramos de Lentejas cocidas'), { target: { value: '0' } });
    expect(screen.getByRole('button', { name: /Crear Receta/i }).hasAttribute('disabled')).toBe(true);
  });

  it('allows a valid draft', async () => {
    renderNew();
    await addViaSearch(lentejas);
    fireEvent.change(screen.getByLabelText('Nombre de la receta'), { target: { value: 'Guiso' } });
    expect(screen.getByRole('button', { name: /Crear Receta/i }).hasAttribute('disabled')).toBe(false);
  });
});

describe('RecipeEditorSheet — editing', () => {
  beforeEach(() => vi.clearAllMocks());

  it('loads the recipe by id and prefills it', async () => {
    vi.mocked(recipeService.getRecipe).mockResolvedValueOnce(existing);
    render(<RecipeEditorSheet open recipeId="recipe-1" onClose={noop} onSaved={noop} />);

    await waitFor(() => expect(recipeService.getRecipe).toHaveBeenCalledWith('recipe-1'));
    expect((await screen.findByLabelText('Nombre de la receta') as HTMLInputElement).value)
      .toBe('Guiso de lentejas');
    expect((screen.getByLabelText('Rinde') as HTMLInputElement).value).toBe('4');
    expect((screen.getByLabelText('Gramos de Lentejas cocidas') as HTMLInputElement).value).toBe('300');
  });

  it('does not fetch anything when creating', () => {
    renderNew();
    expect(recipeService.getRecipe).not.toHaveBeenCalled();
  });

  it('PATCHes the edited recipe', async () => {
    vi.mocked(recipeService.getRecipe).mockResolvedValueOnce(existing);
    render(<RecipeEditorSheet open recipeId="recipe-1" onClose={noop} onSaved={noop} />);
    await screen.findByDisplayValue('Guiso de lentejas');
    fireEvent.change(screen.getByLabelText('Rinde'), { target: { value: '8' } });
    fireEvent.click(screen.getByRole('button', { name: /Guardar Cambios/i }));

    await waitFor(() => expect(recipeService.updateRecipe).toHaveBeenCalled());
    const [id, payload] = vi.mocked(recipeService.updateRecipe).mock.calls[0];
    expect(id).toBe('recipe-1');
    expect(payload.servings).toBe(8);
    expect(payload.ingredients).toEqual([{ foodItemId: 'food-1', grams: 300 }]);
  });

  it('deletes the recipe and tells the caller to refresh', async () => {
    const onSaved = vi.fn();
    vi.mocked(recipeService.getRecipe).mockResolvedValueOnce(existing);
    render(<RecipeEditorSheet open recipeId="recipe-1" onClose={noop} onSaved={onSaved} />);
    fireEvent.click(await screen.findByRole('button', { name: /Borrar Receta/i }));

    await waitFor(() => expect(recipeService.deleteRecipe).toHaveBeenCalledWith('recipe-1'));
    expect(onSaved).toHaveBeenCalled();
  });

  it('surfaces a recipe it could not load instead of showing an empty form', async () => {
    vi.mocked(recipeService.getRecipe).mockRejectedValueOnce(new Error('404'));
    render(<RecipeEditorSheet open recipeId="recipe-9" onClose={noop} onSaved={noop} />);
    expect(await screen.findByText(/No pudimos cargar la receta/i)).toBeTruthy();
    expect(screen.queryByLabelText('Nombre de la receta')).toBeNull();
  });
});

describe('RecipeEditorSheet — failures', () => {
  beforeEach(() => vi.clearAllMocks());

  it('keeps the sheet open and does not claim success when the save fails', async () => {
    const onClose = vi.fn();
    const onSaved = vi.fn();
    vi.mocked(recipeService.createRecipe).mockRejectedValueOnce(new Error('boom'));
    render(<RecipeEditorSheet open recipeId={null} onClose={onClose} onSaved={onSaved} />);
    await addViaSearch(lentejas);
    fireEvent.change(screen.getByLabelText('Nombre de la receta'), { target: { value: 'Guiso' } });
    fireEvent.click(screen.getByRole('button', { name: /Crear Receta/i }));

    await waitFor(() => expect(recipeService.createRecipe).toHaveBeenCalled());
    expect(onSaved).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('keeps the sheet open when the delete fails', async () => {
    const onClose = vi.fn();
    vi.mocked(recipeService.getRecipe).mockResolvedValueOnce(existing);
    vi.mocked(recipeService.deleteRecipe).mockRejectedValueOnce(new Error('boom'));
    render(<RecipeEditorSheet open recipeId="recipe-1" onClose={onClose} onSaved={noop} />);
    fireEvent.click(await screen.findByRole('button', { name: /Borrar Receta/i }));

    await waitFor(() => expect(recipeService.deleteRecipe).toHaveBeenCalled());
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe('RecipeEditorSheet — ingredients are foods, never recipes', () => {
  beforeEach(() => vi.clearAllMocks());

  // A recipe id is absent from the FoodItem catalog, so offering recipes here
  // would build a draft the backend rejects with 400 'Alimento inexistente'.
  // The panel's includeRecipes prop defaults to off precisely for this caller.
  it('never searches recipes when picking an ingredient', async () => {
    vi.mocked(foodService.searchFoods).mockResolvedValue([lentejas]);
    renderNew();
    fireEvent.click(screen.getByRole('button', { name: /Agregar Ingrediente/i }));
    fireEvent.change(screen.getByPlaceholderText('Buscar ingrediente...'), {
      target: { value: 'len' },
    });

    await screen.findByText('Lentejas cocidas');
    expect(recipeService.getRecipes).not.toHaveBeenCalled();
  });
});
