// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

vi.mock('next/link', () => ({
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));
vi.mock('@/lib/api/nutrition.service', async (importOriginal) => {
  // Every network call is a stub. `dayBounds` is the REAL implementation.
  //
  // It used to be a hand-written copy of the implementation, which made every
  // assertion about the window a tautology: the test compared the mock's output
  // against the mock's output, so it could not observe a change in the function
  // the browser actually runs. When that function turned out to be wrong for an
  // hour a year in 26 timezones, these tests stayed green throughout.
  const real = await importOriginal<typeof import('@/lib/api/nutrition.service')>();
  return {
    nutritionService: {
      getNutritionHistory: vi.fn(),
      getNutritionGoal: vi.fn(),
      addNutritionEntry: vi.fn(),
      updateNutritionEntry: vi.fn(),
      deleteNutritionEntry: vi.fn(),
      calculateDailyTotals: vi.fn(() => ({ calories: 0, protein: 0, carbs: 0, fat: 0 })),
      dayBounds: real.dayBounds,
    },
  };
});
// The sheet has its own suite; here it would only drag in the whole picker tree.
// It is reduced to the one thing this page owns: the payload it hands back.
vi.mock('@/components/fitness/add-food-sheet', () => ({
  AddFoodSheet: ({ onAdd }: { onAdd: (p: Record<string, unknown>) => void }) => (
    <button onClick={() => onAdd({ foodName: 'Banana', grams: 100, mealCategory: 'Desayuno' })}>
      simular alta
    </button>
  ),
}));

import NutritionPage from './page';
import { nutritionService } from '@/lib/api/nutrition.service';

const goal = { id: 'g1', userId: 'u1', kcal: 2000, proteinG: 150, carbsG: 200, fatG: 65, isCalculated: false, updatedAt: '' };

const entry = (over: Record<string, unknown>) => ({
  id: 'e1', userId: 'u1', foodName: 'Algo', grams: 100,
  mealCategory: 'Desayuno', calories: 100, protein: 5, carbs: 10, fat: 2,
  date: new Date().toISOString(), status: 'COMPLETED', ...over,
});

/** A catalog food weighed in grams. */
const porGramos = entry({
  id: 'e-gramos', foodName: 'Banana', grams: 120,
  foodItemId: 'f1', foodItem: { id: 'f1', name: 'Banana', isGramBased: true },
});

/** A catalog food counted in units. */
const porUnidad = entry({
  id: 'e-unidad', foodName: 'Huevo entero', grams: 2,
  foodItemId: 'f2', foodItem: { id: 'f2', name: 'Huevo entero', isGramBased: false },
});

/**
 * No foodItem: a recipe, or a custom food that was never saved to the catalog.
 * Both store GRAMS — the diary always does. Six of the eight rows in the real
 * database look like this, and every one of them showed "ud".
 */
const sinFoodItem = entry({
  id: 'e-receta', foodName: 'Milanesa con puré', grams: 400,
});

function load(entries: unknown[]) {
  vi.mocked(nutritionService.getNutritionHistory).mockResolvedValue(entries as never);
  vi.mocked(nutritionService.getNutritionGoal).mockResolvedValue(goal as never);
}

describe('nutrition diary — the unit shown next to an entry', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(nutritionService.calculateDailyTotals).mockReturnValue({ calories: 0, protein: 0, carbs: 0, fat: 0 } as never);
  });

  it('writes grams for a food weighed in grams', async () => {
    load([porGramos]);
    render(<NutritionPage />);
    expect(await screen.findByText('120g')).toBeTruthy();
  });

  it('writes units for a food counted in units', async () => {
    load([porUnidad]);
    render(<NutritionPage />);
    expect(await screen.findByText(/2\s*ud/)).toBeTruthy();
  });

  // The live defect: without a foodItem the code fell through to "ud", so a
  // recipe logged as 400 g read as "400 ud".
  it('writes grams for an entry with no catalog item behind it', async () => {
    load([sinFoodItem]);
    render(<NutritionPage />);
    expect(await screen.findByText('400g')).toBeTruthy();
    expect(screen.queryByText(/400\s*ud/)).toBeNull();
  });
});

describe('nutrition diary — deleting an entry', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(nutritionService.calculateDailyTotals).mockReturnValue({ calories: 0, protein: 0, carbs: 0, fat: 0 } as never);
  });

  // The control was `opacity-0 group-hover:opacity-100`. There is no hover on a
  // touch screen, and this app is built for one: bottom sheets, 85vh.
  it('does not hide the delete control behind a hover', async () => {
    load([porGramos]);
    render(<NutritionPage />);
    const button = await screen.findByRole('button', { name: /Eliminar/i });
    expect(button.className).not.toContain('opacity-0');
  });

  it('asks before deleting instead of deleting on the first tap', async () => {
    load([porGramos]);
    render(<NutritionPage />);
    fireEvent.click(await screen.findByRole('button', { name: /Eliminar/i }));

    expect(await screen.findByText(/¿Eliminar/i)).toBeTruthy();
    expect(nutritionService.deleteNutritionEntry).not.toHaveBeenCalled();
  });

  it('keeps the entry when the confirmation is dismissed', async () => {
    load([porGramos]);
    render(<NutritionPage />);
    fireEvent.click(await screen.findByRole('button', { name: /Eliminar/i }));
    fireEvent.click(await screen.findByRole('button', { name: /Cancelar/i }));

    await waitFor(() => expect(screen.queryByText(/¿Eliminar/i)).toBeNull());
    expect(nutritionService.deleteNutritionEntry).not.toHaveBeenCalled();
    expect(screen.getByText('Banana')).toBeTruthy();
  });

  it('deletes the entry once the confirmation is accepted', async () => {
    load([porGramos]);
    vi.mocked(nutritionService.deleteNutritionEntry).mockResolvedValue(undefined);
    render(<NutritionPage />);
    fireEvent.click(await screen.findByRole('button', { name: /Eliminar/i }));
    fireEvent.click(await screen.findByRole('button', { name: /^Eliminar$/ }));

    await waitFor(() => expect(nutritionService.deleteNutritionEntry).toHaveBeenCalledWith('e-gramos'));
    await waitFor(() => expect(screen.queryByText('Banana')).toBeNull());
  });

  // The row must come back if the server refused, or the diary silently
  // disagrees with what was actually stored.
  it('puts the entry back when the delete fails', async () => {
    load([porGramos]);
    vi.mocked(nutritionService.deleteNutritionEntry).mockRejectedValue(new Error('boom'));
    render(<NutritionPage />);
    fireEvent.click(await screen.findByRole('button', { name: /Eliminar/i }));
    fireEvent.click(await screen.findByRole('button', { name: /^Eliminar$/ }));

    await waitFor(() => expect(nutritionService.deleteNutritionEntry).toHaveBeenCalled());
    expect(screen.getByText('Banana')).toBeTruthy();
  });
});

describe('nutrition diary — deleting the right entry, and only it', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(nutritionService.calculateDailyTotals).mockReturnValue({ calories: 0, protein: 0, carbs: 0, fat: 0 } as never);
  });

  // Every other test here has a single row, so "the chosen entry" and "the first
  // entry" are the same object and a mutant that deletes entries[0] survives.
  // The chosen row is deliberately NOT the first one.
  it('deletes the row that was tapped, not the first one', async () => {
    const primera = entry({ id: 'e-primera', foodName: 'Banana', grams: 120 });
    const segunda = entry({ id: 'e-segunda', foodName: 'Avena', grams: 80 });
    load([primera, segunda]);
    vi.mocked(nutritionService.deleteNutritionEntry).mockResolvedValue(undefined);
    render(<NutritionPage />);

    await screen.findByText('Avena');
    const filas = screen.getAllByRole('button', { name: 'Eliminar registro' });
    fireEvent.click(filas[1]);
    fireEvent.click(await screen.findByRole('button', { name: /^Eliminar$/ }));

    await waitFor(() => expect(nutritionService.deleteNutritionEntry).toHaveBeenCalledWith('e-segunda'));
    expect(nutritionService.deleteNutritionEntry).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.queryByText('Avena')).toBeNull());
    expect(screen.getByText('Banana')).toBeTruthy();
  });

  it('names the entry it is about to delete', async () => {
    const primera = entry({ id: 'e-primera', foodName: 'Banana' });
    const segunda = entry({ id: 'e-segunda', foodName: 'Avena' });
    load([primera, segunda]);
    render(<NutritionPage />);

    await screen.findByText('Avena');
    fireEvent.click(screen.getAllByRole('button', { name: 'Eliminar registro' })[1]);

    expect(await screen.findByText(/"Avena"/)).toBeTruthy();
  });

  // The dialog closing on its own would take the failure off screen with it and
  // leave the user with no way to retry.
  it('stays open when the delete fails, so the failure is visible', async () => {
    load([porGramos]);
    vi.mocked(nutritionService.deleteNutritionEntry).mockRejectedValue(new Error('boom'));
    render(<NutritionPage />);
    fireEvent.click(await screen.findByRole('button', { name: /Eliminar registro/i }));
    fireEvent.click(await screen.findByRole('button', { name: /^Eliminar$/ }));

    await waitFor(() => expect(nutritionService.deleteNutritionEntry).toHaveBeenCalled());
    expect(screen.getByText(/¿Eliminar/i)).toBeTruthy();
  });

  it('closes the dialog once the delete succeeds', async () => {
    load([porGramos]);
    vi.mocked(nutritionService.deleteNutritionEntry).mockResolvedValue(undefined);
    render(<NutritionPage />);
    fireEvent.click(await screen.findByRole('button', { name: /Eliminar registro/i }));
    fireEvent.click(await screen.findByRole('button', { name: /^Eliminar$/ }));

    await waitFor(() => expect(screen.queryByText(/¿Eliminar/i)).toBeNull());
  });
});

describe('nutrition diary — editing an entry', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(nutritionService.calculateDailyTotals).mockReturnValue({ calories: 0, protein: 0, carbs: 0, fat: 0 } as never);
  });

  it('opens the editor on the tapped entry', async () => {
    load([porGramos]);
    render(<NutritionPage />);
    fireEvent.click(await screen.findByRole('button', { name: /Editar Banana/i }));

    expect(await screen.findByText('Editar registro')).toBeTruthy();
    expect((screen.getByLabelText('Cantidad') as HTMLInputElement).value).toBe('120');
  });

  // The delete control lives inside the row. If the row itself were the button,
  // every attempt to delete would open the editor instead.
  it('does not open the editor when the delete control is tapped', async () => {
    load([porGramos]);
    render(<NutritionPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Eliminar registro' }));

    expect(screen.queryByText('Editar registro')).toBeNull();
    expect(await screen.findByText(/¿Eliminar/i)).toBeTruthy();
  });

  it('opens the editor on the entry that was tapped, not the first one', async () => {
    const primera = entry({ id: 'e-primera', foodName: 'Banana', grams: 120 });
    const segunda = entry({ id: 'e-segunda', foodName: 'Avena', grams: 80 });
    load([primera, segunda]);
    render(<NutritionPage />);

    fireEvent.click(await screen.findByRole('button', { name: /Editar Avena/i }));
    await waitFor(() =>
      expect((screen.getByLabelText('Cantidad') as HTMLInputElement).value).toBe('80')
    );
  });

  // A saved change the diary does not reload is invisible until the page is
  // revisited, which reads as "it did not save".
  it('reloads the day after the editor saves', async () => {
    load([porGramos]);
    vi.mocked(nutritionService.updateNutritionEntry).mockResolvedValue(undefined as never);
    render(<NutritionPage />);
    await waitFor(() => expect(nutritionService.getNutritionHistory).toHaveBeenCalledTimes(1));

    fireEvent.click(await screen.findByRole('button', { name: /Editar Banana/i }));
    fireEvent.change(await screen.findByLabelText('Cantidad'), { target: { value: '60' } });
    fireEvent.click(screen.getByRole('button', { name: /Guardar/i }));

    await waitFor(() => expect(nutritionService.updateNutritionEntry).toHaveBeenCalledWith(
      'e-gramos',
      expect.objectContaining({ grams: 60 })
    ));
    await waitFor(() => expect(nutritionService.getNutritionHistory).toHaveBeenCalledTimes(2));
  });
});

describe('nutrition diary — asking the server for one day', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(nutritionService.calculateDailyTotals).mockReturnValue({ calories: 0, protein: 0, carbs: 0, fat: 0 } as never);
  });

  const rangeOf = (call: number) =>
    vi.mocked(nutritionService.getNutritionHistory).mock.calls[call][2] as { from: string; to: string };

  it('asks for the selected day instead of the last hundred entries', async () => {
    load([]);
    render(<NutritionPage />);
    await waitFor(() => expect(nutritionService.getNutritionHistory).toHaveBeenCalled());

    const { from, to } = rangeOf(0);
    const hoy = new Date();
    expect(new Date(from).getDate()).toBe(hoy.getDate());
    expect(new Date(from).getHours()).toBe(0);
    // The range is half-open, so it ends where TOMORROW starts, not at 23:59 of
    // today. The last instant it holds is still today's.
    expect(new Date(to).getHours()).toBe(0);
    expect(new Date(new Date(to).getTime() - 1).getDate()).toBe(hoy.getDate());
  });

  it('asks again for the new day when the date changes', async () => {
    load([]);
    render(<NutritionPage />);
    await waitFor(() => expect(nutritionService.getNutritionHistory).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByRole('button', { name: 'Día anterior' }));
    await waitFor(() => expect(nutritionService.getNutritionHistory).toHaveBeenCalledTimes(2));

    const ayer = new Date(rangeOf(1).from);
    const hoy = new Date(rangeOf(0).from);
    expect(ayer.getTime()).toBeLessThan(hoy.getTime());
  });

  /**
   * The server already filtered by the exact bounds it was given. Filtering
   * again on the client is what used to cap the diary at the last hundred
   * entries and make older days look empty; trusting the response is the point
   * of the change.
   */
  it('renders what the server returned without filtering it again', async () => {
    const anteayer = entry({
      id: 'e-vieja', foodName: 'Avena vieja',
      date: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
    });
    load([anteayer]);
    render(<NutritionPage />);

    expect(await screen.findByText('Avena vieja')).toBeTruthy();
  });
});

/**
 * The window the backend merges within travels with the entry, because only
 * this page knows which local day the user is looking at. What matters is that
 * it is the SAME window the diary reads back: one definition of the day, so the
 * write and the read cannot disagree about which one an entry belongs to.
 *
 * These run under Africa/Cairo with the clock stopped inside the hour that zone
 * repeats when it falls back. The ambient timezone of this suite is
 * America/Buenos_Aires, which has kept a single UTC offset since 2009 — so a
 * containment assertion made under it holds no matter what `dayBounds` does,
 * and cannot fail for a DST reason. That is exactly how the defect below
 * survived: the backend answers 400 to an entry outside its own merge window,
 * and for that one hour a year the page sent precisely that, so the food was
 * silently lost and the user was told to try again.
 */
describe('nutrition diary — the day a new entry is filed under', () => {
  /**
   * 23:30 in Cairo on 2026-10-29, in the SECOND pass of an hour that happens
   * twice. Only Date is faked, so setTimeout stays real and `waitFor` still
   * works.
   */
  const elCairo = 'Africa/Cairo';
  const horaRepetida = '2026-10-29T21:30:00.000Z';

  async function conRelojEn<T>(tz: string, instante: string, body: () => Promise<T>): Promise<T> {
    const original = process.env.TZ;
    process.env.TZ = tz;
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(instante));
    try {
      return await body();
    } finally {
      vi.useRealTimers();
      if (original === undefined) delete process.env.TZ;
      else process.env.TZ = original;
    }
  }

  beforeEach(() => {
    vi.clearAllMocks();
    load([]);
    vi.mocked(nutritionService.addNutritionEntry).mockResolvedValue({} as never);
  });

  const alta = async () => {
    render(<NutritionPage />);
    await waitFor(() => expect(nutritionService.getNutritionHistory).toHaveBeenCalled());
    fireEvent.click(screen.getByText('simular alta'));
    await waitFor(() => expect(nutritionService.addNutritionEntry).toHaveBeenCalled());
    return vi.mocked(nutritionService.addNutritionEntry).mock.calls[0][0];
  };

  const leido = (call: number) =>
    vi.mocked(nutritionService.getNutritionHistory).mock.calls[call][2] as { from: string; to: string };

  it('sends the same bounds it reads the day back with', async () => {
    const enviado = await alta();

    expect(enviado.mergeFrom).toBe(leido(0).from);
    expect(enviado.mergeTo).toBe(leido(0).to);
  });

  it('files the entry inside the window it sends, even in the hour a clock repeats', async () => {
    const enviado = await conRelojEn(elCairo, horaRepetida, alta);

    const cuando = new Date(enviado.date!).getTime();
    expect(cuando).toBeGreaterThanOrEqual(new Date(enviado.mergeFrom!).getTime());
    // Strictly less: the window is half-open, and its upper bound belongs to the
    // next day. This is the assertion the backend enforces, so anything the page
    // sends that fails it comes back as a 400 and the food is never stored.
    expect(cuando).toBeLessThan(new Date(enviado.mergeTo!).getTime());
  });

  const enOtroDia = async () => {
    render(<NutritionPage />);
    await waitFor(() => expect(nutritionService.getNutritionHistory).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByRole('button', { name: 'Día anterior' }));
    await waitFor(() => expect(nutritionService.getNutritionHistory).toHaveBeenCalledTimes(2));

    fireEvent.click(screen.getByText('simular alta'));
    await waitFor(() => expect(nutritionService.addNutritionEntry).toHaveBeenCalled());
    return vi.mocked(nutritionService.addNutritionEntry).mock.calls[0][0];
  };

  it('moves the window with the day being viewed, not the one loaded', async () => {
    const enviado = await enOtroDia();

    expect(enviado.mergeFrom).toBe(leido(1).from);
    expect(new Date(enviado.mergeFrom!).getTime()).toBeLessThan(new Date(leido(0).from).getTime());
  });

  /**
   * On another day the timestamp has to move with the window. Stamping the
   * entry "now" while merging inside yesterday is incoherent, and the backend
   * answers 400 to exactly that — so the food would silently fail to save.
   */
  it('stamps the entry inside the window even on a day that is not today', async () => {
    const enviado = await conRelojEn(elCairo, horaRepetida, enOtroDia);

    const cuando = new Date(enviado.date!).getTime();
    expect(cuando).toBeGreaterThanOrEqual(new Date(enviado.mergeFrom!).getTime());
    expect(cuando).toBeLessThan(new Date(enviado.mergeTo!).getTime());
  });

  /**
   * Two consecutive days must MEET. Yesterday ends exactly where today begins,
   * or there is a slice of time no day claims — and an entry that lands in it
   * shows up in neither diary while sitting in the database perfectly intact.
   *
   * This is the assertion the old bounds could not survive and the containment
   * checks above could: in Cairo on 2026-10-29 the day used to end at
   * 20:59:59.999Z while the next one began at 22:00:00.000Z, so an hour and a
   * millisecond belonged to nobody — the very hour the clock repeats.
   */
  it('leaves no gap between the day it was viewing and the one it moved to', async () => {
    await conRelojEn(elCairo, horaRepetida, enOtroDia);

    expect(leido(1).to).toBe(leido(0).from);
  });
});
