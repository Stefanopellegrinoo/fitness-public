// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/api/client', () => ({ apiClient: vi.fn() }));

import { apiClient } from '@/lib/api/client';
import { getExerciseProgression, getExercisePRs } from './stats.service';

const mockedClient = vi.mocked(apiClient);

const ok = (data: unknown) =>
  ({ ok: true, json: async () => ({ data }) }) as unknown as Response;

const urlOf = (call = 0) => mockedClient.mock.calls[call][0] as string;

describe('statsService.getExerciseProgression', () => {
  beforeEach(() => vi.resetAllMocks());

  it('returns the series for an exercise', async () => {
    mockedClient.mockResolvedValueOnce(
      ok([{ sessionId: 's1', date: '2026-07-01T10:00:00.000Z', topSetWeight: 100, e1rm: 116.7, volume: 1140, sets: [] }])
    );

    const points = await getExerciseProgression('ex-1');

    expect(points).toHaveLength(1);
    expect(points[0].topSetWeight).toBe(100);
    expect(urlOf()).toContain('/stats/exercises/ex-1/progression');
  });

  /**
   * The id lands in a path segment, so a value carrying `/` or `?` would
   * otherwise rewrite the route rather than fill it in.
   */
  it('encodes the exercise id into the path', async () => {
    mockedClient.mockResolvedValueOnce(ok([]));

    await getExerciseProgression('ex/../evil?x=1');

    expect(urlOf()).toContain(encodeURIComponent('ex/../evil?x=1'));
    expect(urlOf()).not.toContain('evil?x=1&');
  });

  it('sends the caller limit', async () => {
    mockedClient.mockResolvedValueOnce(ok([]));

    await getExerciseProgression('ex-1', 12);

    expect(urlOf()).toContain('limit=12');
  });

  /**
   * An exercise the user has never trained is a normal state, not a failure:
   * the sheet renders an empty history for it.
   */
  it('returns an empty series rather than throwing when there is no history', async () => {
    mockedClient.mockResolvedValueOnce({ ok: true, json: async () => ({}) } as unknown as Response);

    await expect(getExerciseProgression('ex-1')).resolves.toEqual([]);
  });

  it('throws when the request fails', async () => {
    mockedClient.mockResolvedValueOnce({ ok: false, status: 500, json: async () => ({}) } as unknown as Response);

    await expect(getExerciseProgression('ex-1')).rejects.toBeDefined();
  });
});

describe('statsService.getExercisePRs', () => {
  beforeEach(() => vi.resetAllMocks());

  it('returns the three PR lists', async () => {
    mockedClient.mockResolvedValueOnce(
      ok({
        weightPRs: [{ weightKg: 100, reps: 5, date: '2026-07-01T10:00:00.000Z', sessionId: 's1' }],
        e1rmPRs: [],
        repPRs: [],
      })
    );

    const prs = await getExercisePRs('ex-1');

    expect(prs.weightPRs[0].weightKg).toBe(100);
    expect(urlOf()).toContain('/stats/exercises/ex-1/prs');
  });

  /**
   * Empty lists, not undefined: every caller reduces over these, and a missing
   * key would throw inside the render rather than show an exercise with no PRs.
   */
  it('fills in empty lists when the payload carries none', async () => {
    mockedClient.mockResolvedValueOnce({ ok: true, json: async () => ({}) } as unknown as Response);

    await expect(getExercisePRs('ex-1')).resolves.toEqual({ weightPRs: [], e1rmPRs: [], repPRs: [] });
  });
});
