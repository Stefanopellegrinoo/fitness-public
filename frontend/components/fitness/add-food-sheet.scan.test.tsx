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
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));
vi.mock('./barcode-scanner', () => ({
  BarcodeScanner: ({ onScan }: { onScan: (code: string) => void }) => (
    <>
      <button type="button" data-testid="mock-scan" onClick={() => onScan('3017620422003')}>
        scan
      </button>
      <button
        type="button"
        data-testid="mock-scan-double"
        onClick={() => {
          onScan('3017620422003');
          onScan('3017620422003');
        }}
      >
        scan twice
      </button>
    </>
  ),
}));

import { AddFoodSheet } from './add-food-sheet';
import { foodService } from '@/lib/api/food.service';
import { toast } from 'sonner';

const banana = {
  id: 'food-1', name: 'Banana', brand: 'Genérico', isGramBased: true,
  caloriesPer100g: 89, proteinPer100g: 1.1, carbsPer100g: 23, fatPer100g: 0.3,
};

const noop = () => {};
const asyncNoop = async () => {};

describe('AddFoodSheet barcode scanning', () => {
  beforeEach(() => vi.clearAllMocks());

  it('goes to the amount step when the scanned barcode resolves a food', async () => {
    vi.mocked(foodService.getFoodByBarcode).mockResolvedValueOnce(banana);
    render(<AddFoodSheet open onClose={noop} onAdd={asyncNoop} />);
    // Radix TabsTrigger (v1.1.13) switches the active tab on `mousedown`, not
    // `click` — see the same note in add-food-sheet.test.tsx.
    fireEvent.mouseDown(screen.getByRole('tab', { name: /Escanear/i }));
    fireEvent.click(screen.getByTestId('mock-scan'));
    await waitFor(() =>
      expect(foodService.getFoodByBarcode).toHaveBeenCalledWith('3017620422003')
    );
    expect(await screen.findByText('Cantidad')).toBeTruthy();
  });

  it('shows a not-found toast when the scanned barcode has no match', async () => {
    vi.mocked(foodService.getFoodByBarcode).mockResolvedValueOnce(null);
    render(<AddFoodSheet open onClose={noop} onAdd={asyncNoop} />);
    fireEvent.mouseDown(screen.getByRole('tab', { name: /Escanear/i }));
    fireEvent.click(screen.getByTestId('mock-scan'));
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith('No encontramos ese código de barras', { id: 'barcode-miss' })
    );
  });

  it('does not re-lookup or re-toast an already-rejected barcode on a repeat scan', async () => {
    render(<AddFoodSheet open onClose={noop} onAdd={asyncNoop} />);
    fireEvent.mouseDown(screen.getByRole('tab', { name: /Escanear/i }));

    // First tick: unknown code gets looked up and rejected.
    fireEvent.click(screen.getByTestId('mock-scan'));
    await waitFor(() => expect(toast.error).toHaveBeenCalledTimes(1));
    expect(foodService.getFoodByBarcode).toHaveBeenCalledTimes(1);

    // Second tick: the same code is still in frame and gets decoded again.
    fireEvent.click(screen.getByTestId('mock-scan'));
    await waitFor(() => expect(foodService.getFoodByBarcode).toHaveBeenCalledTimes(1));
    expect(toast.error).toHaveBeenCalledTimes(1);
    expect(toast.error).toHaveBeenCalledWith('No encontramos ese código de barras', { id: 'barcode-miss' });
  });

  it('only looks up the barcode once when onScan fires twice synchronously', async () => {
    vi.mocked(foodService.getFoodByBarcode).mockResolvedValueOnce(banana);
    render(<AddFoodSheet open onClose={noop} onAdd={asyncNoop} />);
    fireEvent.mouseDown(screen.getByRole('tab', { name: /Escanear/i }));
    fireEvent.click(screen.getByTestId('mock-scan-double'));
    await waitFor(() => expect(screen.queryByText('Cantidad')).toBeTruthy());
    expect(foodService.getFoodByBarcode).toHaveBeenCalledTimes(1);
  });
});
