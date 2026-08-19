// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

// Node 25's built-in `localStorage` global (Web Storage API, on by default) shadows
// happy-dom/jsdom's window.localStorage and lacks a valid backing file, leaving
// getItem/setItem undefined. active-workout.tsx reads localStorage on mount for rest-timer
// persistence, so stub a real in-memory Storage for this file only (pre-existing repo/Node
// version issue, not introduced by this feature — see lib/auth/storage.test.ts, which fails
// the same way on this Node version).
class MemoryStorage implements Storage {
  private store = new Map<string, string>();
  getItem(key: string) { return this.store.has(key) ? this.store.get(key)! : null; }
  setItem(key: string, value: string) { this.store.set(key, String(value)); }
  removeItem(key: string) { this.store.delete(key); }
  clear() { this.store.clear(); }
  key(index: number) { return Array.from(this.store.keys())[index] ?? null; }
  get length() { return this.store.size; }
}

vi.mock('@/lib/api/workout.service', () => ({
  workoutService: {
    addWorkoutSet: vi.fn().mockResolvedValue({ id: 'saved-1' }),
    deleteWorkoutSet: vi.fn().mockResolvedValue(undefined),
    updateWorkoutSet: vi.fn().mockResolvedValue({}),
    getExerciseHistory: vi.fn().mockResolvedValue([]),
    linkExerciseToSession: vi.fn(),
  },
}));
vi.mock('@/lib/api/notification.service', () => ({ notificationService: { sendTestNotification: vi.fn().mockResolvedValue({}) } }));
vi.mock('sonner', () => ({ toast: { info: vi.fn(), success: vi.fn(), error: vi.fn() } }));

import { ActiveWorkout } from './active-workout';
import { workoutService } from '@/lib/api/workout.service';

const exercises = [{
  id: 'ex1', name: 'Squat', muscleGroup: 'PIERNAS',
  sets: [
    { id: 's1', weight: 100, reps: 4, completed: true, plan: { order: 1, setType: 'TOP', repsMin: 3, repsMax: 5 } },
    { id: 's2', weight: 0, reps: 8, completed: false, plan: { order: 2, setType: 'BACKOFF', repsMin: 8, repsMax: 10, percentOfTopSet: 80 } },
  ],
}];

const renderAW = () => render(
  <ActiveWorkout sessionId="sess1" routineName="R" startedAt={new Date(Date.now()).toISOString()} exercises={exercises as any} onFinish={() => {}} onBack={() => {}} onSessionGone={() => {}} />
);

describe('ActiveWorkout methodology', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('localStorage', new MemoryStorage());
  });
  afterEach(() => vi.unstubAllGlobals());

  it('suggests 80kg for the BACKOFF @80% from the logged 100kg TOP set', () => {
    renderAW();
    // Two set rows; the second (BACKOFF, uncompleted, weight 0) shows the suggestion.
    const weights = screen.getAllByLabelText('Peso del set').map((n) => (n as HTMLInputElement).value);
    expect(weights).toEqual(['100', '80']);
    expect(screen.getByText(/sugerido/i)).toBeTruthy();
  });

  it('typing a weight sets the absolute value, replacing the suggestion', () => {
    renderAW();
    const backoffInput = screen.getAllByLabelText('Peso del set')[1] as HTMLInputElement;
    fireEvent.focus(backoffInput);
    fireEvent.change(backoffInput, { target: { value: '55' } });
    fireEvent.blur(backoffInput);
    // 55, not 80+55: the input commits an absolute weight, not a stepper delta.
    expect(backoffInput.value).toBe('55');
    expect(screen.queryByText(/sugerido/i)).toBeNull();
  });

  it('typing a weight on a completed set syncs the absolute value to the server', () => {
    renderAW();
    const topInput = screen.getAllByLabelText('Peso del set')[0] as HTMLInputElement;
    fireEvent.focus(topInput);
    fireEvent.change(topInput, { target: { value: '105' } });
    fireEvent.blur(topInput);
    expect(workoutService.updateWorkoutSet).toHaveBeenCalledWith('s1', { weightKg: 105 });
  });

  it('logs the BACKOFF set with its setType and the effective (suggested) weight', async () => {
    renderAW();
    fireEvent.click(screen.getAllByLabelText('Completar set')[1]);
    await waitFor(() => expect(workoutService.addWorkoutSet).toHaveBeenCalled());
    expect(workoutService.addWorkoutSet).toHaveBeenCalledWith('sess1', expect.objectContaining({
      exerciseId: 'ex1', setNumber: 2, weightKg: 80, reps: 8, setType: 'BACKOFF',
    }));
  });
});

describe('ActiveWorkout removeSet on un-logged plan-driven rows', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('localStorage', new MemoryStorage());
  });
  afterEach(() => vi.unstubAllGlobals());

  // Shape produced by buildSessionExercises for a planned, never-logged set: id is
  // `plan-${exerciseId}-${order}`, never a `temp-` id, and never persisted server-side.
  const exercisesWithPlanRow = [{
    id: 'ex1', name: 'Squat', muscleGroup: 'PIERNAS',
    sets: [
      { id: 'plan-ex1-1', weight: 100, reps: 4, completed: false, plan: { order: 1, setType: 'TOP', repsMin: 3, repsMax: 5 } },
      { id: 'plan-ex1-2', weight: 0, reps: 8, completed: false, plan: { order: 2, setType: 'BACKOFF', repsMin: 8, repsMax: 10, percentOfTopSet: 80 } },
    ],
  }];

  it('removes an un-logged planned set locally, without calling deleteWorkoutSet', async () => {
    // Simulate the real backend behavior for a plan-only id: it was never persisted, so
    // a delete call for it 404s. This is what happens today with the unfixed guard.
    vi.spyOn(workoutService, 'deleteWorkoutSet').mockRejectedValueOnce(new Error('Not Found'));

    render(
      <ActiveWorkout sessionId="sess1" routineName="R" startedAt={new Date(Date.now()).toISOString()} exercises={exercisesWithPlanRow as any} onFinish={() => {}} onBack={() => {}} onSessionGone={() => {}} />
    );

    expect(screen.getAllByLabelText('Borrar serie')).toHaveLength(2);
    fireEvent.click(screen.getAllByLabelText('Borrar serie')[1]);

    await waitFor(() => expect(screen.getAllByLabelText('Borrar serie')).toHaveLength(1));
    expect(workoutService.deleteWorkoutSet).not.toHaveBeenCalled();
  });
});
