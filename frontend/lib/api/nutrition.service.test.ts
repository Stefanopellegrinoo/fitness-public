// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/api/client', () => ({ apiClient: vi.fn() }));

import { apiClient } from '@/lib/api/client';
import { getNutritionHistory } from './nutrition.service';

const mockedClient = vi.mocked(apiClient);

const entry = (id: string, calories: number) => ({
  id,
  foodName: `Food ${id}`,
  grams: 100,
  mealCategory: 'Almuerzo',
  calories,
  protein: 0,
  carbs: 0,
  fat: 0,
  date: '2026-08-09T12:00:00.000Z',
});

const page = (entries: unknown[], total: number, offset: number, limit: number) =>
  ({
    ok: true,
    json: async () => ({
      data: entries,
      pagination: { offset, limit, total, hasMore: offset + limit < total, pageCount: Math.ceil(total / limit) },
    }),
  }) as unknown as Response;

const offsetOf = (call: number) =>
  Number(new URL(mockedClient.mock.calls[call][0] as string, 'http://x').searchParams.get('offset'));

/**
 * The caller asks for a DAY and gets an array back. Nothing in that signature
 * can express "and there was more" -- which is why the page count has to be
 * settled here rather than passed up.
 *
 * The list is not the reason. `calculateDailyTotals` sums whatever this
 * resolves to, so a day that came back one page short does not render as a
 * short list, it renders as WRONG CALORIES, with no failure anywhere for the
 * user to notice.
 */
describe('nutritionService.getNutritionHistory', () => {
  // `reset`, not `clear`: `clearAllMocks` wipes the call log but leaves queued
  // `mockResolvedValueOnce` responses in place, so a test that queues two pages
  // and consumes one hands the leftover to the NEXT test -- which then asserts
  // against a response it never set up.
  beforeEach(() => vi.resetAllMocks());

  it('returns the whole day when the server says there is more', async () => {
    mockedClient
      .mockResolvedValueOnce(page([entry('a', 100), entry('b', 200)], 3, 0, 2))
      .mockResolvedValueOnce(page([entry('c', 300)], 3, 2, 2));

    const entries = await getNutritionHistory(2, 0);

    expect(entries.map(e => e.id)).toEqual(['a', 'b', 'c']);
    expect(mockedClient).toHaveBeenCalledTimes(2);
    expect(offsetOf(1)).toBe(2);
  });

  it('stops at one request when the first page already holds the day', async () => {
    mockedClient.mockResolvedValueOnce(page([entry('a', 100)], 1, 0, 100));

    const entries = await getNutritionHistory(100, 0);

    expect(entries).toHaveLength(1);
    expect(mockedClient).toHaveBeenCalledTimes(1);
  });

  it('advances from the caller offset instead of restarting at zero', async () => {
    mockedClient
      .mockResolvedValueOnce(page([entry('c', 300), entry('d', 400)], 6, 2, 2))
      .mockResolvedValueOnce(page([entry('e', 500), entry('f', 600)], 6, 4, 2))
      .mockResolvedValueOnce(page([], 6, 6, 2));

    await getNutritionHistory(2, 2);

    expect(offsetOf(1)).toBe(4);
  });

  /**
   * The next offset follows what ARRIVED, not what was asked for. A page that
   * comes back short of its own limit while still reporting more (the server
   * dropped a row between counting and reading) would otherwise leave a gap in
   * the day: advancing by `limit` skips the rows never sent.
   */
  it('advances by the rows received, not by the limit requested', async () => {
    mockedClient
      .mockResolvedValueOnce(page([entry('a', 100)], 4, 0, 2))
      .mockResolvedValueOnce(page([entry('b', 200), entry('c', 300)], 4, 1, 2))
      .mockResolvedValueOnce(page([entry('d', 400)], 4, 3, 2));

    await getNutritionHistory(2, 0);

    expect(offsetOf(1)).toBe(1);
  });

  /**
   * A server that answers `hasMore: true` forever would otherwise spin until
   * the tab dies. The loop has to end on the ANSWER, not only on the promise.
   */
  it('gives up instead of looping forever when the server keeps claiming more', async () => {
    mockedClient.mockResolvedValue(page([entry('a', 100)], Number.MAX_SAFE_INTEGER, 0, 1));

    const entries = await getNutritionHistory(1, 0);

    expect(mockedClient.mock.calls.length).toBeLessThan(100);
    expect(entries.length).toBeGreaterThan(0);
  });

  /**
   * An empty page with `hasMore` still true is the same trap with a quieter
   * face: nothing accumulates, so a loop keyed only on `hasMore` never advances.
   */
  it('stops when a page comes back empty even if hasMore stays true', async () => {
    mockedClient
      .mockResolvedValueOnce(page([entry('a', 100)], 99, 0, 1))
      .mockResolvedValueOnce(page([], 99, 1, 1));

    const entries = await getNutritionHistory(1, 0);

    expect(entries).toHaveLength(1);
    expect(mockedClient).toHaveBeenCalledTimes(2);
  });

  it('still works against a bare array response, which carries no pagination', async () => {
    mockedClient.mockResolvedValueOnce({
      ok: true,
      json: async () => [entry('a', 100)],
    } as unknown as Response);

    const entries = await getNutritionHistory(100, 0);

    expect(entries).toHaveLength(1);
    expect(mockedClient).toHaveBeenCalledTimes(1);
  });
});
