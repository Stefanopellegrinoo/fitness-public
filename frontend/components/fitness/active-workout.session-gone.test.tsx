// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

// Same Node 25 localStorage shadowing worked around in active-workout.methodology.test.tsx:
// the built-in Web Storage global lacks a backing file, so getItem/setItem come back
// undefined and the rest-timer effect throws on mount.
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
    linkExerciseToSession: vi.fn().mockResolvedValue({}),
  },
}));
vi.mock('@/lib/api/notification.service', () => ({ notificationService: { sendTestNotification: vi.fn().mockResolvedValue({}) } }));
vi.mock('sonner', () => ({ toast: { info: vi.fn(), success: vi.fn(), error: vi.fn() } }));
// Stand-in for the real sheet, which fetches the exercise catalogue on open.
vi.mock('./exercise-selector', () => ({
  ExerciseSelector: ({ open, onSelect }: { open: boolean; onSelect: (e: unknown) => void }) =>
    open ? <button aria-label="Elegir ejercicio" onClick={() => onSelect({ id: 'ex2', name: 'Bench', category: 'PECHO' })} /> : null,
}));

import { ActiveWorkout } from './active-workout';
import { workoutService } from '@/lib/api/workout.service';
import { handleApiError } from '@/lib/api/error.handler';
import { toast } from 'sonner';

const REST_END_KEY = 'workout_rest_end_at';

const oneOpenSet = [{
  id: 'ex1', name: 'Squat', muscleGroup: 'PIERNAS',
  sets: [{ id: 'plan-ex1-1', weight: 60, reps: 8, completed: false }],
}];

const twoOpenSets = [{
  id: 'ex1', name: 'Squat', muscleGroup: 'PIERNAS',
  sets: [
    { id: 'plan-ex1-1', weight: 60, reps: 8, completed: false },
    { id: 'plan-ex1-2', weight: 60, reps: 8, completed: false },
  ],
}];

const oneLoggedSet = [{
  id: 'ex1', name: 'Squat', muscleGroup: 'PIERNAS',
  sets: [{ id: 's1', weight: 60, reps: 8, completed: true }],
}];

interface RenderOptions {
  onSessionGone?: () => void;
  onBack?: () => void;
  exercises?: unknown;
}

const renderAW = (opts: RenderOptions = {}) => render(
  <ActiveWorkout
    sessionId="sess1"
    routineName="R"
    startedAt={new Date().toISOString()}
    exercises={(opts.exercises ?? oneOpenSet) as never}
    onFinish={() => {}}
    onBack={opts.onBack ?? (() => {})}
    onSessionGone={opts.onSessionGone ?? (() => {})}
  />
);

// Built the way the service builds them, so the body shape the eject depends on is
// real rather than asserted into existence: the API's own handlers nest
// `{ error: { message } }`.
const apiError = (status: number, message: string) => handleApiError({ error: { message } }, status);

// `sessionId` is captured once at page mount and held for the page's lifetime, so a
// session the backend has closed (a second device starting another routine, the 24h
// stale sweep) can never be written to again from this screen. Reporting that as a
// connection problem tells the user the opposite of the cause and offers a retry that
// cannot succeed — these tests pin that the two statuses that mean "gone" navigate out.
describe('ActiveWorkout when the session no longer accepts writes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('localStorage', new MemoryStorage());
  });
  afterEach(() => vi.unstubAllGlobals());

  it('leaves the workout and says the session ended when logging a set answers 409', async () => {
    vi.mocked(workoutService.addWorkoutSet).mockRejectedValueOnce(
      apiError(409, 'This workout session is already finished')
    );
    const onSessionGone = vi.fn();
    const onBack = vi.fn();
    renderAW({ onSessionGone, onBack });

    fireEvent.click(screen.getByLabelText('Completar set'));

    await waitFor(() => expect(onSessionGone).toHaveBeenCalledTimes(1));
    // The eject must REPLACE the URL, never push onto it.
    expect(onBack).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith(expect.stringMatching(/ya fue finalizado/i));
    expect(toast.error).not.toHaveBeenCalledWith(expect.stringMatching(/conexi/i));
  });

  // A 404 is a DIFFERENT cause from a 409 — the id is not the caller's, not "you
  // finished this" — and telling the user the wrong one is the bug, not the exit.
  it('leaves the workout with its own copy when logging a set answers 404', async () => {
    vi.mocked(workoutService.addWorkoutSet).mockRejectedValueOnce(apiError(404, 'Session not found'));
    const onSessionGone = vi.fn();
    renderAW({ onSessionGone });

    fireEvent.click(screen.getByLabelText('Completar set'));

    await waitFor(() => expect(onSessionGone).toHaveBeenCalledTimes(1));
    expect(toast.error).toHaveBeenCalledWith(expect.stringMatching(/ya no está disponible/i));
    expect(toast.error).not.toHaveBeenCalledWith(expect.stringMatching(/ya fue finalizado/i));
  });

  // Half of what this screen has to survive: the dynamic exercise link goes through
  // the same closed session and used to report "try again".
  it('leaves the workout when adding an exercise answers 409', async () => {
    vi.mocked(workoutService.linkExerciseToSession).mockRejectedValueOnce(
      apiError(409, 'This workout session is already finished')
    );
    const onSessionGone = vi.fn();
    renderAW({ onSessionGone });

    fireEvent.click(screen.getByLabelText('Agregar ejercicio'));
    fireEvent.click(screen.getByLabelText('Elegir ejercicio'));

    await waitFor(() => expect(onSessionGone).toHaveBeenCalledTimes(1));
    expect(toast.error).toHaveBeenCalledWith(expect.stringMatching(/ya fue finalizado/i));
    expect(toast.error).not.toHaveBeenCalledWith(expect.stringMatching(/agregar el ejercicio/i));
  });

  it('leaves the workout when adding an exercise answers 404', async () => {
    vi.mocked(workoutService.linkExerciseToSession).mockRejectedValueOnce(apiError(404, 'Session not found'));
    const onSessionGone = vi.fn();
    renderAW({ onSessionGone });

    fireEvent.click(screen.getByLabelText('Agregar ejercicio'));
    fireEvent.click(screen.getByLabelText('Elegir ejercicio'));

    await waitFor(() => expect(onSessionGone).toHaveBeenCalledTimes(1));
    expect(toast.error).toHaveBeenCalledWith(expect.stringMatching(/ya no está disponible/i));
  });

  // Tapping two set rows in a row is ordinary mid-workout behaviour and neither the
  // button nor the handler blocks it. Un-latched, each failure stacks its own toast
  // and its own navigation.
  it('ejects once for two writes that fail together', async () => {
    vi.mocked(workoutService.addWorkoutSet).mockRejectedValue(
      apiError(409, 'This workout session is already finished')
    );
    const onSessionGone = vi.fn();
    renderAW({ onSessionGone, exercises: twoOpenSets });

    const buttons = screen.getAllByLabelText('Completar set');
    fireEvent.click(buttons[0]);
    fireEvent.click(buttons[1]);

    await waitFor(() => expect(onSessionGone).toHaveBeenCalled());
    await waitFor(() => expect(vi.mocked(workoutService.addWorkoutSet)).toHaveBeenCalledTimes(2));
    expect(onSessionGone).toHaveBeenCalledTimes(1);
    expect(toast.error).toHaveBeenCalledTimes(1);
  });

  // The rest timer outlives the component's navigation: left running it fires
  // "¡Descanso terminado!" at a user who has already been thrown out, and the
  // persisted end time resurfaces the countdown on top of the NEXT workout.
  it('drops the persisted rest deadline when it ejects', async () => {
    localStorage.setItem(REST_END_KEY, String(Date.now() + 60_000));
    vi.mocked(workoutService.addWorkoutSet).mockRejectedValueOnce(
      apiError(409, 'This workout session is already finished')
    );
    const onSessionGone = vi.fn();
    renderAW({ onSessionGone });

    fireEvent.click(screen.getByLabelText('Completar set'));

    await waitFor(() => expect(onSessionGone).toHaveBeenCalledTimes(1));
    expect(localStorage.getItem(REST_END_KEY)).toBeNull();
  });

  it('stops the running rest countdown when it ejects', async () => {
    localStorage.setItem(REST_END_KEY, String(Date.now() + 60_000));
    vi.mocked(workoutService.addWorkoutSet).mockRejectedValueOnce(
      apiError(409, 'This workout session is already finished')
    );
    const onSessionGone = vi.fn();
    renderAW({ onSessionGone });

    expect(screen.getByText('Descanso')).toBeTruthy();

    fireEvent.click(screen.getByLabelText('Completar set'));

    await waitFor(() => expect(onSessionGone).toHaveBeenCalledTimes(1));
    expect(screen.queryByText('Descanso')).toBeNull();
  });

  // The counterweight: a genuine transport failure IS retryable, so it must keep the
  // old copy and must NOT throw the user off the screen.
  it('keeps the retry copy and stays on the workout for a network failure', async () => {
    vi.mocked(workoutService.addWorkoutSet).mockRejectedValueOnce(
      handleApiError(new TypeError('Failed to fetch'))
    );
    const onSessionGone = vi.fn();
    renderAW({ onSessionGone });

    fireEvent.click(screen.getByLabelText('Completar set'));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(expect.stringMatching(/conexi/i)));
    expect(onSessionGone).not.toHaveBeenCalled();
  });

  // The status alone is not evidence that the API answered. A wrong NEXT_PUBLIC_API_URL,
  // a proxy miss or a future route rename all produce a 404 with no nested body, and
  // ejecting on those throws a user out of a LIVE session — discarding every set typed
  // but not yet logged — with an explanation that is simply false.
  it.each([
    ['the express catch-all (flat error string)', { error: 'Route POST /api/workouts/sess1/sets not found', statusCode: 404 }],
    ['a proxy or CDN miss (no JSON body)', {}],
  ])('stays on the workout for a 404 from %s', async (_label, body) => {
    vi.mocked(workoutService.addWorkoutSet).mockRejectedValueOnce(handleApiError(body, 404));
    const onSessionGone = vi.fn();
    renderAW({ onSessionGone });

    fireEvent.click(screen.getByLabelText('Completar set'));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(expect.stringMatching(/conexi/i)));
    expect(onSessionGone).not.toHaveBeenCalled();
  });
});

// /workouts/sets/:id refuses writes into a finished session too, but its 404 is about
// the SET row and says nothing about the session — collapsing the two would eject a
// user from a live workout for deleting a row that is merely already gone.
describe('ActiveWorkout when a set write is refused', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('localStorage', new MemoryStorage());
  });
  afterEach(() => vi.unstubAllGlobals());

  it('leaves the workout when un-marking a set answers 409', async () => {
    vi.mocked(workoutService.deleteWorkoutSet).mockRejectedValueOnce(
      apiError(409, 'This workout session is already finished')
    );
    const onSessionGone = vi.fn();
    renderAW({ onSessionGone, exercises: oneLoggedSet });

    fireEvent.click(screen.getByLabelText('Completar set'));

    await waitFor(() => expect(onSessionGone).toHaveBeenCalledTimes(1));
    expect(toast.error).toHaveBeenCalledWith(expect.stringMatching(/ya fue finalizado/i));
  });

  it('stays on the workout and drops the retry offer when un-marking a set answers 404', async () => {
    vi.mocked(workoutService.deleteWorkoutSet).mockRejectedValueOnce(apiError(404, 'Set not found'));
    const onSessionGone = vi.fn();
    renderAW({ onSessionGone, exercises: oneLoggedSet });

    fireEvent.click(screen.getByLabelText('Completar set'));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(expect.stringMatching(/ya no existe en el servidor/i)));
    expect(onSessionGone).not.toHaveBeenCalled();
    expect(toast.error).not.toHaveBeenCalledWith(expect.stringMatching(/intentá de nuevo/i));
  });

  // Saying the row is gone is only half the answer; the screen has to stop drawing it as
  // logged. Otherwise the set keeps its dead server id and every later tap re-sends the
  // same DELETE for the same 404 — a row nobody can clear. The markup is identical either
  // way, so the tell is which call the SECOND tap makes: an un-marked row logs a new set.
  it('un-marks the row locally when the delete answers 404, instead of stranding it', async () => {
    vi.mocked(workoutService.deleteWorkoutSet).mockRejectedValueOnce(apiError(404, 'Set not found'));
    renderAW({ exercises: oneLoggedSet });

    fireEvent.click(screen.getByLabelText('Completar set'));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(expect.stringMatching(/ya no existe/i)));

    fireEvent.click(screen.getByLabelText('Completar set'));

    await waitFor(() => expect(workoutService.addWorkoutSet).toHaveBeenCalledTimes(1));
    expect(workoutService.deleteWorkoutSet).toHaveBeenCalledTimes(1);
  });

  it('leaves the workout when deleting a set answers 409', async () => {
    vi.mocked(workoutService.deleteWorkoutSet).mockRejectedValueOnce(
      apiError(409, 'This workout session is already finished')
    );
    const onSessionGone = vi.fn();
    renderAW({ onSessionGone, exercises: oneLoggedSet });

    fireEvent.click(screen.getByLabelText('Borrar serie'));

    await waitFor(() => expect(onSessionGone).toHaveBeenCalledTimes(1));
    expect(toast.error).not.toHaveBeenCalledWith(expect.stringMatching(/borrar la serie/i));
  });

  // The weight steppers auto-sync in the background. Silent is the point of the
  // fire-and-forget, but a finished session is not a sync hiccup: this was the tap
  // that rewrote a closed workout with no signal at all.
  it('leaves the workout when the background weight sync answers 409', async () => {
    vi.mocked(workoutService.updateWorkoutSet).mockRejectedValueOnce(
      apiError(409, 'This workout session is already finished')
    );
    const onSessionGone = vi.fn();
    renderAW({ onSessionGone, exercises: oneLoggedSet });

    fireEvent.click(screen.getByLabelText('Subir peso'));

    await waitFor(() => expect(onSessionGone).toHaveBeenCalledTimes(1));
    expect(toast.error).toHaveBeenCalledWith(expect.stringMatching(/ya fue finalizado/i));
  });

  // A 404 on the trash can is the outcome the tap asked for — the row is already gone
  // server-side — so it must NOT eject, and the row must leave the screen. Choosing the
  // session-only helper here is what keeps a merely-missing row from throwing the user
  // out of a live workout and discarding everything typed but not logged.
  it('drops the row without ejecting when deleting a set answers 404', async () => {
    vi.mocked(workoutService.deleteWorkoutSet).mockRejectedValueOnce(apiError(404, 'Set not found'));
    const onSessionGone = vi.fn();
    renderAW({ onSessionGone, exercises: oneLoggedSet });

    fireEvent.click(screen.getByLabelText('Borrar serie'));

    await waitFor(() => expect(screen.queryByLabelText('Borrar serie')).toBeNull());
    expect(onSessionGone).not.toHaveBeenCalled();
    expect(toast.error).not.toHaveBeenCalledWith(expect.stringMatching(/no pudimos borrar/i));
  });

  // The latch exists to collapse one tap's burst of failures, not to mute the screen.
  // `onSessionGone` is an async transition that can fail to resolve (offline, a failed
  // payload fetch), and this component stays mounted and tappable while it does — so a
  // later tap has to be answered instead of failing invisibly forever.
  it('answers a later write again once the eject latch expires', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      vi.mocked(workoutService.addWorkoutSet).mockRejectedValue(
        apiError(409, 'This workout session is already finished')
      );
      const onSessionGone = vi.fn();
      renderAW({ onSessionGone, exercises: twoOpenSets });

      fireEvent.click(screen.getAllByLabelText('Completar set')[0]);
      await waitFor(() => expect(onSessionGone).toHaveBeenCalledTimes(1));

      await vi.advanceTimersByTimeAsync(3000);
      fireEvent.click(screen.getAllByLabelText('Completar set')[1]);

      await waitFor(() => expect(onSessionGone).toHaveBeenCalledTimes(2));
    } finally {
      vi.useRealTimers();
      vi.mocked(workoutService.addWorkoutSet).mockResolvedValue({ id: 'saved-1' } as never);
    }
  });
});
