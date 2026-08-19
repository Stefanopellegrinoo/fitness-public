// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

vi.mock('@/lib/api/recipe.service', () => ({
  recipeService: { getRecipes: vi.fn().mockResolvedValue({ items: [], total: 0 }) },
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));

import { RecipeTab, RecipeAmountStep } from './recipe-picker';
import { recipeService } from '@/lib/api/recipe.service';
import { RecipeListItem } from '@/lib/types/api.types';

/**
 * 950 g total, 4 servings -> 237.5 g per serving.
 * Chosen so that per100g and perServing are exact in binary floating point,
 * and a serving is NOT 100 g: a picker that ignores gramsPerServing and treats
 * a serving as 100 g would still pass with a 100 g fixture.
 */
const guiso: RecipeListItem = {
  id: 'recipe-1',
  name: 'Guiso de lentejas',
  servings: 4,
  ingredientCount: 6,
  nutrition: {
    totalGrams: 950,
    gramsPerServing: 237.5,
    total: { calories: 1400, protein: 88, carbs: 190, fat: 32 },
    per100g: { calories: 1400 / 9.5, protein: 88 / 9.5, carbs: 190 / 9.5, fat: 32 / 9.5 },
    perServing: { calories: 350, protein: 22, carbs: 47.5, fat: 8 },
    hasIncompleteMacros: false,
  },
  createdAt: '2026-07-30T00:00:00.000Z',
  updatedAt: '2026-07-30T00:00:00.000Z',
};

const incomplete: RecipeListItem = {
  ...guiso,
  id: 'recipe-2',
  name: 'Tarta dudosa',
  nutrition: { ...guiso.nutrition, hasIncompleteMacros: true },
};

/** Only reachable if a stored recipe had no grams at all — the helper returns null. */
const weightless: RecipeListItem = {
  ...guiso,
  id: 'recipe-3',
  name: 'Receta sin peso',
  nutrition: {
    ...guiso.nutrition,
    totalGrams: 0,
    gramsPerServing: 0,
    per100g: null,
  },
};

const noop = () => {};
const asyncNoop = async () => {};

describe('RecipeTab', () => {
  beforeEach(() => vi.clearAllMocks());

  it('lists the recipes once the tab is active', async () => {
    vi.mocked(recipeService.getRecipes).mockResolvedValueOnce({ items: [guiso], total: 1 });
    render(<RecipeTab active onSelect={noop} />);
    expect(await screen.findByText('Guiso de lentejas')).toBeTruthy();
  });

  it('does not fetch until the tab is active', () => {
    render(<RecipeTab active={false} onSelect={noop} />);
    expect(recipeService.getRecipes).not.toHaveBeenCalled();
  });

  it('shows the per-serving calories on the row', async () => {
    vi.mocked(recipeService.getRecipes).mockResolvedValueOnce({ items: [guiso], total: 1 });
    render(<RecipeTab active onSelect={noop} />);
    expect(await screen.findByText(/350 kcal/)).toBeTruthy();
  });

  // G7
  it('flags a recipe whose ingredients have missing macros', async () => {
    vi.mocked(recipeService.getRecipes).mockResolvedValueOnce({ items: [incomplete], total: 1 });
    render(<RecipeTab active onSelect={noop} />);
    expect(await screen.findByText(/Datos incompletos/i)).toBeTruthy();
  });

  it('does not flag a recipe with complete macros', async () => {
    vi.mocked(recipeService.getRecipes).mockResolvedValueOnce({ items: [guiso], total: 1 });
    render(<RecipeTab active onSelect={noop} />);
    await screen.findByText('Guiso de lentejas');
    expect(screen.queryByText(/Datos incompletos/i)).toBeNull();
  });

  it('shows an empty state when the user has no recipes', async () => {
    vi.mocked(recipeService.getRecipes).mockResolvedValueOnce({ items: [], total: 0 });
    render(<RecipeTab active onSelect={noop} />);
    expect(await screen.findByText(/Todavía no tenés recetas/i)).toBeTruthy();
  });

  // The list endpoint is paginated: staying silent would make a truncated page
  // indistinguishable from the whole list.
  it('says so when the page does not hold every recipe', async () => {
    vi.mocked(recipeService.getRecipes).mockResolvedValueOnce({ items: [guiso], total: 37 });
    render(<RecipeTab active onSelect={noop} />);
    expect(await screen.findByText(/37/)).toBeTruthy();
  });

  it('stays quiet when the page holds every recipe', async () => {
    vi.mocked(recipeService.getRecipes).mockResolvedValueOnce({ items: [guiso], total: 1 });
    render(<RecipeTab active onSelect={noop} />);
    await screen.findByText('Guiso de lentejas');
    expect(screen.queryByText(/de un total de/i)).toBeNull();
  });

  it('hands the tapped recipe to onSelect', async () => {
    vi.mocked(recipeService.getRecipes).mockResolvedValueOnce({ items: [guiso], total: 1 });
    const onSelect = vi.fn();
    render(<RecipeTab active onSelect={onSelect} />);
    fireEvent.click(await screen.findByText('Guiso de lentejas'));
    expect(onSelect).toHaveBeenCalledWith(guiso);
  });

  it('surfaces a failed fetch instead of showing an empty list', async () => {
    vi.mocked(recipeService.getRecipes).mockRejectedValueOnce(new Error('boom'));
    render(<RecipeTab active onSelect={noop} />);
    expect(await screen.findByText(/No pudimos cargar tus recetas/i)).toBeTruthy();
  });
});

describe('RecipeAmountStep', () => {
  beforeEach(() => vi.clearAllMocks());

  const setAmount = (value: string) =>
    fireEvent.change(screen.getByLabelText('Cantidad'), { target: { value } });

  it('opens on one serving', () => {
    render(<RecipeAmountStep recipe={guiso} onAdd={asyncNoop} onSaved={noop} />);
    expect((screen.getByLabelText('Cantidad') as HTMLInputElement).value).toBe('1');
    expect(screen.getByRole('button', { name: /Porciones/i }).getAttribute('aria-pressed')).toBe('true');
  });

  // G1 — the single most expensive mistake available here: the recipe uuid is
  // not a FoodItem id, and the backend would persist it straight into the FK.
  it('never sends a foodItemId', async () => {
    const onAdd = vi.fn().mockResolvedValue(undefined);
    render(<RecipeAmountStep recipe={guiso} onAdd={onAdd} onSaved={noop} />);
    fireEvent.click(screen.getByRole('button', { name: /Confirmar/i }));
    await waitFor(() => expect(onAdd).toHaveBeenCalled());
    expect(onAdd.mock.calls[0][0].foodItemId).toBeUndefined();
    expect(JSON.stringify(onAdd.mock.calls[0][0])).not.toContain('recipe-1');
  });

  // G8
  it('sends the recipe name as the entry name', async () => {
    const onAdd = vi.fn().mockResolvedValue(undefined);
    render(<RecipeAmountStep recipe={guiso} onAdd={onAdd} onSaved={noop} />);
    fireEvent.click(screen.getByRole('button', { name: /Confirmar/i }));
    await waitFor(() => expect(onAdd).toHaveBeenCalled());
    expect(onAdd.mock.calls[0][0].foodName).toBe('Guiso de lentejas');
  });

  // G2 — the diary always stores grams, so servings must be converted first.
  it('converts servings to grams before sending', async () => {
    const onAdd = vi.fn().mockResolvedValue(undefined);
    render(<RecipeAmountStep recipe={guiso} onAdd={onAdd} onSaved={noop} />);
    setAmount('2');
    fireEvent.click(screen.getByRole('button', { name: /Confirmar/i }));
    await waitFor(() => expect(onAdd).toHaveBeenCalled());
    expect(onAdd.mock.calls[0][0].grams).toBeCloseTo(475, 6); // 2 x 237.5
  });

  it('sends the typed amount verbatim in grams mode', async () => {
    const onAdd = vi.fn().mockResolvedValue(undefined);
    render(<RecipeAmountStep recipe={guiso} onAdd={onAdd} onSaved={noop} />);
    fireEvent.click(screen.getByRole('button', { name: /Gramos/i }));
    setAmount('300');
    fireEvent.click(screen.getByRole('button', { name: /Confirmar/i }));
    await waitFor(() => expect(onAdd).toHaveBeenCalled());
    expect(onAdd.mock.calls[0][0].grams).toBeCloseTo(300, 6);
  });

  // G4 — with no foodItemId the backend cannot derive anything: omitting the
  // macros lands the entry at 0 kcal.
  it('sends the four macros', async () => {
    const onAdd = vi.fn().mockResolvedValue(undefined);
    render(<RecipeAmountStep recipe={guiso} onAdd={onAdd} onSaved={noop} />);
    fireEvent.click(screen.getByRole('button', { name: /Confirmar/i }));
    await waitFor(() => expect(onAdd).toHaveBeenCalled());
    const payload = onAdd.mock.calls[0][0];
    expect(payload.calories).toBeCloseTo(350, 6);
    expect(payload.protein).toBeCloseTo(22, 6);
    expect(payload.carbs).toBeCloseTo(47.5, 6);
    expect(payload.fat).toBeCloseTo(8, 6);
  });

  // G3 — the identity per100g x (n x gramsPerServing) / 100 == perServing x n.
  // One serving and 237.5 g are the same food, so they must produce the same
  // numbers; two independent formulas would be free to drift apart.
  it('agrees between the two modes for the same real amount of food', async () => {
    const onAdd = vi.fn().mockResolvedValue(undefined);
    const { unmount } = render(<RecipeAmountStep recipe={guiso} onAdd={onAdd} onSaved={noop} />);
    setAmount('2');
    fireEvent.click(screen.getByRole('button', { name: /Confirmar/i }));
    await waitFor(() => expect(onAdd).toHaveBeenCalled());
    const byServings = onAdd.mock.calls[0][0];
    unmount();

    const onAdd2 = vi.fn().mockResolvedValue(undefined);
    render(<RecipeAmountStep recipe={guiso} onAdd={onAdd2} onSaved={noop} />);
    fireEvent.click(screen.getByRole('button', { name: /Gramos/i }));
    setAmount('475');
    fireEvent.click(screen.getByRole('button', { name: /Confirmar/i }));
    await waitFor(() => expect(onAdd2).toHaveBeenCalled());
    const byGrams = onAdd2.mock.calls[0][0];

    expect(byGrams.grams).toBeCloseTo(byServings.grams, 6);
    expect(byGrams.calories).toBeCloseTo(byServings.calories, 6);
    expect(byGrams.protein).toBeCloseTo(byServings.protein, 6);
    expect(byGrams.carbs).toBeCloseTo(byServings.carbs, 6);
    expect(byGrams.fat).toBeCloseTo(byServings.fat, 6);
  });

  // Switching units must not change how much food the user meant. Without the
  // conversion the number stays put and its meaning silently changes: 2 servings
  // would become 2 grams.
  it('keeps the same real amount of food when the unit switches to grams', async () => {
    render(<RecipeAmountStep recipe={guiso} onAdd={asyncNoop} onSaved={noop} />);
    setAmount('2');
    expect(await screen.findByText('700')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Gramos/i }));
    expect((screen.getByLabelText('Cantidad') as HTMLInputElement).value).toBe('475');
    expect(await screen.findByText('700')).toBeTruthy();
  });

  it('keeps the same real amount of food when the unit switches back to servings', async () => {
    render(<RecipeAmountStep recipe={guiso} onAdd={asyncNoop} onSaved={noop} />);
    fireEvent.click(screen.getByRole('button', { name: /Gramos/i }));
    setAmount('475');
    fireEvent.click(screen.getByRole('button', { name: /Porciones/i }));
    expect((screen.getByLabelText('Cantidad') as HTMLInputElement).value).toBe('2');
    expect(await screen.findByText('700')).toBeTruthy();
  });

  it('updates the live macros when the amount changes', async () => {
    render(<RecipeAmountStep recipe={guiso} onAdd={asyncNoop} onSaved={noop} />);
    expect(await screen.findByText('350')).toBeTruthy();
    setAmount('2');
    expect(await screen.findByText('700')).toBeTruthy();
  });

  it('sends the chosen meal category', async () => {
    const onAdd = vi.fn().mockResolvedValue(undefined);
    render(<RecipeAmountStep recipe={guiso} onAdd={onAdd} onSaved={noop} />);
    fireEvent.change(screen.getByLabelText('Comida'), { target: { value: 'Cena' } });
    fireEvent.click(screen.getByRole('button', { name: /Confirmar/i }));
    await waitFor(() => expect(onAdd).toHaveBeenCalled());
    expect(onAdd.mock.calls[0][0].mealCategory).toBe('Cena');
  });

  // G5
  it('refuses to log a recipe with no per-100g basis', () => {
    render(<RecipeAmountStep recipe={weightless} onAdd={asyncNoop} onSaved={noop} />);
    expect(screen.getByRole('button', { name: /Confirmar/i }).hasAttribute('disabled')).toBe(true);
    expect(screen.getByText(/no tiene datos suficientes/i)).toBeTruthy();
  });

  // G7
  it('flags incomplete macros in the amount step too', () => {
    render(<RecipeAmountStep recipe={incomplete} onAdd={asyncNoop} onSaved={noop} />);
    expect(screen.getByText(/Datos incompletos/i)).toBeTruthy();
  });

  it('closes the sheet after a successful save', async () => {
    const onSaved = vi.fn();
    render(<RecipeAmountStep recipe={guiso} onAdd={asyncNoop} onSaved={onSaved} />);
    fireEvent.click(screen.getByRole('button', { name: /Confirmar/i }));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
  });

  it('keeps the sheet open when the save fails', async () => {
    const onSaved = vi.fn();
    const onAdd = vi.fn().mockRejectedValue(new Error('boom'));
    render(<RecipeAmountStep recipe={guiso} onAdd={onAdd} onSaved={onSaved} />);
    fireEvent.click(screen.getByRole('button', { name: /Confirmar/i }));
    await waitFor(() => expect(onAdd).toHaveBeenCalled());
    expect(onSaved).not.toHaveBeenCalled();
  });
});
