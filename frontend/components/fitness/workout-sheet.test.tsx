// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

vi.mock('@/lib/api/routine.service', () => ({
  routineService: { getNextDay: vi.fn() },
  getNextDay: vi.fn(),
}));

import { WorkoutSheet } from './workout-sheet';
import { routineService } from '@/lib/api/routine.service';
import type { RoutineDay, RoutineDaySummary, Weekday } from '@/lib/types/api.types';

const mockedNextDay = vi.mocked(routineService.getNextDay);

/**
 * Two fixtures on purpose, because the component receives two different shapes.
 *
 * The routine's days come from the parent, which loaded them WITH their
 * exercises. The suggestion comes from `getNextDay`, whose query has no
 * `include` and therefore has none. The single fixture this file used before
 * gave `exercises: []` to both and silenced the mismatch with `as never` — a
 * fixture more complete than the server, and a cast that would have hidden the
 * type error meant to catch it.
 */
const day = (id: string, name: string, order: number, weekday: Weekday): RoutineDay =>
  ({ id, name, order, weekday, exercises: [] });

const summary = (id: string, name: string, order: number, weekday: Weekday): RoutineDaySummary =>
  ({ id, name, order, weekday });

const routine = {
  id: 'r-1',
  name: 'PPL',
  days: [day('d1', 'Push', 1, 'LUNES'), day('d2', 'Pull', 2, 'MIERCOLES'), day('d3', 'Legs', 3, 'VIERNES')],
};

/** The list renders `<name> · <n> ejercicios`; the suggestion renders `Entrenar <name>`. */
const listedDay = (name: string) => new RegExp(`^${name} · \\d+ ejercicios$`);

describe('WorkoutSheet', () => {
  beforeEach(() => vi.resetAllMocks());

  it('asks for nothing while closed', () => {
    render(<WorkoutSheet routine={null} onClose={() => {}} />);

    expect(mockedNextDay).not.toHaveBeenCalled();
  });

  /**
   * The whole point of asking the server. The old button picked the day whose
   * weekday matched today and fell back to the FIRST day otherwise, so a
   * Push/Pull/Legs routine opened on a Tuesday always offered Push — however
   * many times Push had just been trained. The rotation lives in the session
   * history, which only the server has.
   */
  it('offers the day the server rotates to, not the one matching today', async () => {
    mockedNextDay.mockResolvedValue(summary('d3', 'Legs', 3, 'VIERNES'));

    render(<WorkoutSheet routine={routine} onClose={() => {}} />);

    expect(await screen.findByRole('button', { name: /entrenar legs/i })).toBeTruthy();
  });

  it('starts the suggested day when the suggestion is taken', async () => {
    mockedNextDay.mockResolvedValue(summary('d2', 'Pull', 2, 'MIERCOLES'));
    const onStartWorkout = vi.fn();

    render(<WorkoutSheet routine={routine} onClose={() => {}} onStartWorkout={onStartWorkout} />);

    (await screen.findByRole('button', { name: /entrenar pull/i })).click();

    expect(onStartWorkout).toHaveBeenCalledWith('r-1', 'd2');
  });

  /**
   * Every day stays reachable. The suggestion is a shortcut, never a gate: a
   * user who wants Legs on a Push day just picks Legs.
   *
   * Asserted against the LIST's own rendering (`<name> · <n> ejercicios`)
   * rather than a bare `/Push/`. The previous version suggested `days[0]` and
   * matched the name loosely, so the suggestion button "Entrenar Push"
   * satisfied the Push case by itself — the list could have rendered nothing
   * and the test would still have passed. It also asserted
   * `getAllByText(...).length > 0`, which cannot fail: `getAllByText` throws
   * when it finds nothing.
   */
  it('keeps every day of the routine listed alongside the suggestion', async () => {
    mockedNextDay.mockResolvedValue(summary('d1', 'Push', 1, 'LUNES'));

    render(<WorkoutSheet routine={routine} onClose={() => {}} />);
    await screen.findByRole('button', { name: /entrenar push/i });

    for (const name of ['Push', 'Pull', 'Legs']) {
      expect(screen.getByRole('button', { name: listedDay(name) })).toBeTruthy();
    }
  });

  /**
   * A suggestion is a convenience, so failing to get one must not block the
   * sheet: the day list is the real function here and it needs no server.
   */
  it('still lists the days when the suggestion cannot be loaded', async () => {
    mockedNextDay.mockRejectedValue(new Error('offline'));

    render(<WorkoutSheet routine={routine} onClose={() => {}} />);

    await waitFor(() => expect(mockedNextDay).toHaveBeenCalled());
    expect(screen.getByText(/Push/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^entrenar (push|pull|legs)$/i })).toBeNull();
  });

  /**
   * The `.catch` itself, which nothing here used to cover.
   *
   * MEASURED: deleting the whole `.catch` block leaves all seven other tests
   * GREEN. The suite only turns red because Vitest reports the unhandled
   * rejection separately — no assertion catches it. The reason is that the
   * failure branch sets no state a test could observe: `suggested` was already
   * reset to null before the request, so `queryByRole(...).toBeNull()` in the
   * test above holds whether the guard exists or not.
   *
   * So the thing to assert is the only effect the block actually has: that the
   * rejection is absorbed. This matters more since the branch was reduced to a
   * comment — an empty-looking `.catch` is exactly what a tidying refactor
   * deletes.
   */
  it('absorbs the failed suggestion instead of leaving the rejection unhandled', async () => {
    const unhandled = vi.fn();
    process.on('unhandledRejection', unhandled);
    mockedNextDay.mockRejectedValue(new Error('offline'));

    try {
      render(<WorkoutSheet routine={routine} onClose={() => {}} />);
      await waitFor(() => expect(mockedNextDay).toHaveBeenCalled());
      // Rejections are reported a macrotask later, so the check has to outlive
      // the microtask queue the promise itself settles on.
      await new Promise(resolve => setTimeout(resolve, 0));

      expect(unhandled).not.toHaveBeenCalled();
    } finally {
      process.off('unhandledRejection', unhandled);
    }
  });

  /**
   * Two routines opened in a row resolve in whatever order the network
   * decides. Without a guard the slower FIRST answer lands last, and the button
   * offers a day belonging to a routine the user already left — pressing it
   * would start the wrong workout.
   */
  it('ignores a slow suggestion once the sheet has moved to another routine', async () => {
    let resolveFirst: (day: RoutineDaySummary) => void = () => {};
    mockedNextDay
      .mockImplementationOnce(() => new Promise<RoutineDaySummary>(resolve => { resolveFirst = resolve; }))
      .mockResolvedValueOnce(summary('d9', 'Upper', 1, 'LUNES'));

    const { rerender } = render(<WorkoutSheet routine={routine} onClose={() => {}} />);
    rerender(
      <WorkoutSheet routine={{ id: 'r-2', name: 'Upper/Lower', days: [day('d9', 'Upper', 1, 'LUNES')] }} onClose={() => {}} />
    );

    expect(await screen.findByRole('button', { name: /entrenar upper/i })).toBeTruthy();

    resolveFirst(summary('d1', 'Push', 1, 'LUNES'));

    await waitFor(() => expect(screen.queryByRole('button', { name: /entrenar push/i })).toBeNull());
    expect(screen.getByRole('button', { name: /entrenar upper/i })).toBeTruthy();
  });

  it('shows no suggestion for a routine with no days, and asks for none', async () => {
    render(<WorkoutSheet routine={{ ...routine, days: [] }} onClose={() => {}} />);

    await waitFor(() => expect(mockedNextDay).not.toHaveBeenCalled());
  });
});
