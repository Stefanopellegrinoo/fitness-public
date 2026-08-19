// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

vi.mock('@/lib/api/nutrition.service', () => ({
  nutritionService: { updateNutritionEntry: vi.fn() },
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));

import { EditEntrySheet } from './edit-entry-sheet';
import { nutritionService } from '@/lib/api/nutrition.service';

const base = {
  id: 'e1', userId: 'u1', foodName: 'Milanesa con puré', grams: 400,
  mealCategory: 'Almuerzo' as const, calories: 800, protein: 40, carbs: 60, fat: 30,
  date: new Date().toISOString(), status: 'COMPLETED',
};

/** The common case: no catalog item behind it (a recipe or a custom food). */
const sinFoodItem = base;

/** A catalog food counted in units. */
const porUnidad = {
  ...base, id: 'e2', foodName: 'Huevo entero', grams: 2,
  calories: 156, protein: 13, carbs: 1, fat: 11,
  foodItemId: 'f1', foodItem: { id: 'f1', name: 'Huevo entero', isGramBased: false },
};

const noop = () => {};
const setAmount = (value: string) =>
  fireEvent.change(screen.getByLabelText('Cantidad'), { target: { value } });
const save = () => fireEvent.click(screen.getByRole('button', { name: /Guardar/i }));
const payload = () => vi.mocked(nutritionService.updateNutritionEntry).mock.calls[0][1] as Record<string, number | string>;

describe('EditEntrySheet', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(nutritionService.updateNutritionEntry).mockResolvedValue(undefined as never);
  });

  it('opens on the amount and meal the entry already has', () => {
    render(<EditEntrySheet open entry={sinFoodItem} onClose={noop} onSaved={noop} />);
    expect((screen.getByLabelText('Cantidad') as HTMLInputElement).value).toBe('400');
    expect((screen.getByLabelText('Comida') as HTMLSelectElement).value).toBe('Almuerzo');
    expect(screen.getByText('Milanesa con puré')).toBeTruthy();
  });

  it('shows the entry unit, grams when nothing backs it', () => {
    render(<EditEntrySheet open entry={sinFoodItem} onClose={noop} onSaved={noop} />);
    expect(screen.getByText('g')).toBeTruthy();
  });

  it('shows units for a food counted in units', () => {
    render(<EditEntrySheet open entry={porUnidad} onClose={noop} onSaved={noop} />);
    expect(screen.getByText('ud')).toBeTruthy();
  });

  it('PATCHes the entry it was given', async () => {
    render(<EditEntrySheet open entry={sinFoodItem} onClose={noop} onSaved={noop} />);
    setAmount('200');
    save();
    await waitFor(() => expect(nutritionService.updateNutritionEntry).toHaveBeenCalled());
    expect(vi.mocked(nutritionService.updateNutritionEntry).mock.calls[0][0]).toBe('e1');
    expect(payload().grams).toBe(200);
  });

  /**
   * The reason the macros travel at all. The backend only recomputes them when
   * the entry HAS a foodItem (nutrition.routes.ts:236) — and six of the eight
   * rows in the real database do not. Halving the amount without sending macros
   * would leave 800 kcal sitting on a 200 g entry.
   */
  it('scales the macros from the stored snapshot when the amount changes', async () => {
    render(<EditEntrySheet open entry={sinFoodItem} onClose={noop} onSaved={noop} />);
    setAmount('200');
    save();
    await waitFor(() => expect(nutritionService.updateNutritionEntry).toHaveBeenCalled());
    expect(payload().calories).toBeCloseTo(400, 6);
    expect(payload().protein).toBeCloseTo(20, 6);
    expect(payload().carbs).toBeCloseTo(30, 6);
    expect(payload().fat).toBeCloseTo(15, 6);
  });

  it('always sends the four macros, never leaving them to the backend', async () => {
    render(<EditEntrySheet open entry={porUnidad} onClose={noop} onSaved={noop} />);
    setAmount('4');
    save();
    await waitFor(() => expect(nutritionService.updateNutritionEntry).toHaveBeenCalled());
    const sent = payload();
    expect(sent.calories).toBeDefined();
    expect(sent.protein).toBeDefined();
    expect(sent.carbs).toBeDefined();
    expect(sent.fat).toBeDefined();
    expect(sent.calories).toBeCloseTo(312, 6);
  });

  it('previews the scaled macros before saving', async () => {
    render(<EditEntrySheet open entry={sinFoodItem} onClose={noop} onSaved={noop} />);
    expect(await screen.findByText('800')).toBeTruthy();
    setAmount('200');
    expect(await screen.findByText('400')).toBeTruthy();
  });

  it('moves the entry to another meal without touching the amount', async () => {
    render(<EditEntrySheet open entry={sinFoodItem} onClose={noop} onSaved={noop} />);
    fireEvent.change(screen.getByLabelText('Comida'), { target: { value: 'Cena' } });
    save();
    await waitFor(() => expect(nutritionService.updateNutritionEntry).toHaveBeenCalled());
    expect(payload().mealCategory).toBe('Cena');
    expect(payload().grams).toBe(400);
    expect(payload().calories).toBeCloseTo(800, 6);
  });

  // The backend rejects a non-positive amount with a 400; there is no reason to
  // make the user find that out through a failed request.
  it('refuses to save an amount of zero', () => {
    render(<EditEntrySheet open entry={sinFoodItem} onClose={noop} onSaved={noop} />);
    setAmount('0');
    expect(screen.getByRole('button', { name: /Guardar/i }).hasAttribute('disabled')).toBe(true);
  });

  it('refuses to save a negative amount', () => {
    render(<EditEntrySheet open entry={sinFoodItem} onClose={noop} onSaved={noop} />);
    setAmount('-5');
    expect(screen.getByRole('button', { name: /Guardar/i }).hasAttribute('disabled')).toBe(true);
  });

  it('refuses to save an empty amount', () => {
    render(<EditEntrySheet open entry={sinFoodItem} onClose={noop} onSaved={noop} />);
    setAmount('');
    expect(screen.getByRole('button', { name: /Guardar/i }).hasAttribute('disabled')).toBe(true);
  });

  it('tells the caller to refresh once the save succeeds', async () => {
    const onSaved = vi.fn();
    render(<EditEntrySheet open entry={sinFoodItem} onClose={noop} onSaved={onSaved} />);
    setAmount('200');
    save();
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
  });

  it('keeps the sheet open and claims nothing when the save fails', async () => {
    const onSaved = vi.fn();
    const onClose = vi.fn();
    vi.mocked(nutritionService.updateNutritionEntry).mockRejectedValue(new Error('boom'));
    render(<EditEntrySheet open entry={sinFoodItem} onClose={onClose} onSaved={onSaved} />);
    setAmount('200');
    save();
    await waitFor(() => expect(nutritionService.updateNutritionEntry).toHaveBeenCalled());
    expect(onSaved).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  // Reopening on a different row must not show the previous row's numbers.
  it('reloads its fields when it is handed a different entry', async () => {
    const { rerender } = render(<EditEntrySheet open entry={sinFoodItem} onClose={noop} onSaved={noop} />);
    setAmount('123');
    rerender(<EditEntrySheet open entry={porUnidad} onClose={noop} onSaved={noop} />);
    await waitFor(() =>
      expect((screen.getByLabelText('Cantidad') as HTMLInputElement).value).toBe('2')
    );
  });
});

describe('EditEntrySheet — the degenerate row', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(nutritionService.updateNutritionEntry).mockResolvedValue(undefined as never);
  });

  /**
   * A stored amount of zero has no ratio to scale by. It is unreachable through
   * the API — grams is z.number().positive() on both create and update, and the
   * database holds no such row — but the guard is still load-bearing: without it
   * the ratio is Infinity, the macros serialise to null, and the request comes
   * back a 400. An untested guard is either uncovered or unnecessary.
   */
  it('never sends Infinity for an entry stored with zero grams', async () => {
    const degenerada = { ...base, id: 'e0', grams: 0 };
    render(<EditEntrySheet open entry={degenerada} onClose={noop} onSaved={noop} />);
    setAmount('100');
    save();

    await waitFor(() => expect(nutritionService.updateNutritionEntry).toHaveBeenCalled());
    const sent = payload();
    expect(Number.isFinite(sent.calories as number)).toBe(true);
    expect(Number.isFinite(sent.protein as number)).toBe(true);
    expect(Number.isFinite(sent.carbs as number)).toBe(true);
    expect(Number.isFinite(sent.fat as number)).toBe(true);
  });
});
