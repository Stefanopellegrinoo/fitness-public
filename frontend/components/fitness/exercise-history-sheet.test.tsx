// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';

vi.mock('@/lib/api/stats.service', () => ({
  getExerciseProgression: vi.fn(),
  getExercisePRs: vi.fn(),
}));

import { ExerciseHistorySheet } from './exercise-history-sheet';
import { getExerciseProgression, getExercisePRs } from '@/lib/api/stats.service';
import type { ProgressionPoint } from '@/lib/api/stats.service';

const mockedProgression = vi.mocked(getExerciseProgression);
const mockedPRs = vi.mocked(getExercisePRs);

const exercise = { id: 'ex-1', name: 'Press banca', muscleGroup: 'Pecho' };

const point = (date: string, topSetWeight: number, volume: number, sets: Array<[number, number, number, string]>) => ({
  sessionId: `s-${date}`,
  date,
  topSetWeight,
  e1rm: null,
  volume,
  sets: sets.map(([setNumber, weightKg, reps, setType]) => ({ setNumber, weightKg, reps, setType })),
});

const noPRs = { weightPRs: [], e1rmPRs: [], repPRs: [] };

// Scoped to its own card: a session count of 3 is indistinguishable from a set
// of 3 reps when the whole document is the haystack.
const statCard = (label: string) => within(screen.getByText(label).parentElement as HTMLElement);

describe('ExerciseHistorySheet', () => {
  beforeEach(() => vi.resetAllMocks());

  it('renders nothing and asks the API for nothing while closed', () => {
    render(<ExerciseHistorySheet exercise={null} onClose={() => {}} />);

    expect(mockedProgression).not.toHaveBeenCalled();
    expect(mockedPRs).not.toHaveBeenCalled();
  });

  it('shows the personal record from the PR history, not from the visible sessions', async () => {
    // The 140kg record predates the progression window: reading the record off
    // the chart data would report 100kg and quietly demote the user.
    mockedProgression.mockResolvedValue([point('2026-07-08T10:00:00.000Z', 100, 500, [[1, 100, 5, 'TOP']])]);
    mockedPRs.mockResolvedValue({
      ...noPRs,
      weightPRs: [
        { weightKg: 120, reps: 3, date: '2025-01-01T10:00:00.000Z', sessionId: 'old' },
        { weightKg: 140, reps: 2, date: '2025-06-01T10:00:00.000Z', sessionId: 'older' },
      ],
    });

    render(<ExerciseHistorySheet exercise={exercise} onClose={() => {}} />);

    expect(await screen.findByText('140kg')).toBeTruthy();
    expect(screen.getByText('× 2 reps')).toBeTruthy();
  });

  it('derives max volume and session count from the series', async () => {
    mockedProgression.mockResolvedValue([
      point('2026-07-01T10:00:00.000Z', 100, 900, [[1, 100, 5, 'TOP']]),
      point('2026-07-08T10:00:00.000Z', 105, 1200, [[1, 105, 3, 'TOP']]),
      point('2026-07-15T10:00:00.000Z', 102, 400, [[1, 102, 4, 'TOP']]),
    ]);
    mockedPRs.mockResolvedValue(noPRs);

    render(<ExerciseHistorySheet exercise={exercise} onClose={() => {}} />);

    expect(await screen.findByText('1200')).toBeTruthy();
    expect(statCard('VOL. MÁXIMO').getByText('1200')).toBeTruthy();
    expect(statCard('FRECUENCIA').getByText('3')).toBeTruthy();
  });

  it('lists the newest session first, with every set it holds', async () => {
    mockedProgression.mockResolvedValue([
      point('2026-07-01T10:00:00.000Z', 100, 900, [[1, 100, 5, 'TOP']]),
      point('2026-07-08T10:00:00.000Z', 105, 1200, [[1, 40, 10, 'WARMUP'], [2, 105, 3, 'TOP']]),
    ]);
    mockedPRs.mockResolvedValue(noPRs);

    render(<ExerciseHistorySheet exercise={exercise} onClose={() => {}} />);

    await screen.findByText('105');
    const weights = screen.getAllByText(/^(100|105|40)$/).map(n => n.textContent);
    // Newest session first, and its warmup is kept: the user logged it.
    expect(weights).toEqual(['40', '105', '100']);
  });

  it('tells the user when the exercise has no history yet', async () => {
    mockedProgression.mockResolvedValue([]);
    mockedPRs.mockResolvedValue(noPRs);

    render(<ExerciseHistorySheet exercise={exercise} onClose={() => {}} />);

    expect(await screen.findByText(/todavía no/i)).toBeTruthy();
  });

  /**
   * A failed load must not render as an exercise with no history: that reads as
   * "you never trained this" for someone who trained it yesterday.
   */
  it('reports a failed load instead of showing it as an empty history', async () => {
    mockedProgression.mockRejectedValue(new Error('network down'));
    mockedPRs.mockResolvedValue(noPRs);

    render(<ExerciseHistorySheet exercise={exercise} onClose={() => {}} />);

    expect(await screen.findByText(/no pudimos cargar/i)).toBeTruthy();
    expect(screen.queryByText(/todavía no/i)).toBeNull();
  });

  /**
   * Two exercises opened in a row resolve in whatever order the network
   * decides. Without a guard, the SLOWER first response lands last and paints
   * one exercise's history under the other one's name — the kind of wrong that
   * looks like real data.
   */
  it('ignores a slow first load once the sheet has moved to another exercise', async () => {
    let resolveFirst: (points: ProgressionPoint[]) => void = () => {};
    mockedProgression
      .mockImplementationOnce(() => new Promise<ProgressionPoint[]>(resolve => { resolveFirst = resolve; }))
      .mockResolvedValueOnce([point('2026-07-08T10:00:00.000Z', 105, 1200, [[1, 105, 3, 'TOP']])]);
    mockedPRs.mockResolvedValue(noPRs);

    const { rerender } = render(<ExerciseHistorySheet exercise={exercise} onClose={() => {}} />);
    rerender(<ExerciseHistorySheet exercise={{ ...exercise, id: 'ex-2' }} onClose={() => {}} />);

    expect(await screen.findByText('1200')).toBeTruthy();

    // The abandoned request answers now, with a volume the second exercise
    // never had.
    resolveFirst([point('2026-07-01T10:00:00.000Z', 100, 999, [[1, 100, 5, 'TOP']])]);

    await waitFor(() => expect(screen.queryByText('999')).toBeNull());
    expect(statCard('VOL. MÁXIMO').getByText('1200')).toBeTruthy();
  });

  it('reloads when the sheet is opened on a different exercise', async () => {
    mockedProgression.mockResolvedValue([]);
    mockedPRs.mockResolvedValue(noPRs);

    const { rerender } = render(<ExerciseHistorySheet exercise={exercise} onClose={() => {}} />);
    await waitFor(() => expect(mockedProgression).toHaveBeenCalledTimes(1));

    rerender(<ExerciseHistorySheet exercise={{ ...exercise, id: 'ex-2' }} onClose={() => {}} />);

    await waitFor(() => expect(mockedProgression).toHaveBeenCalledTimes(2));
    expect(mockedProgression.mock.calls[1][0]).toBe('ex-2');
  });
});
