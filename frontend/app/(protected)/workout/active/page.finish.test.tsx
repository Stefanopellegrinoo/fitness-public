// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { toast } from 'sonner';

const push = vi.fn();
const replace = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, replace, refresh: vi.fn(), back: vi.fn(), forward: vi.fn() }),
  usePathname: () => '/workout/active',
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock('sonner', () => ({ toast: { info: vi.fn(), success: vi.fn(), error: vi.fn() } }));
vi.mock('@/lib/api/workout.service', () => ({
  workoutService: {
    getActiveWorkout: vi.fn(),
    startWorkout: vi.fn(),
    finishWorkout: vi.fn(),
  },
}));
// Only the Finalizar wiring matters here, so the screen is reduced to the button that
// triggers it.
vi.mock('@/components/fitness/active-workout', () => ({
  ActiveWorkout: ({ onFinish }: { onFinish: () => void }) => (
    <button aria-label="finish" onClick={onFinish} />
  ),
}));

import ActiveWorkoutPage from './page';
import { workoutService } from '@/lib/api/workout.service';
import { handleApiError } from '@/lib/api/error.handler';

const session = { id: 'sess1', startedAt: new Date().toISOString(), routineId: null, routine: { name: 'R' }, exercises: [], sets: [] };
const apiError = (status: number, message: string) => handleApiError({ error: { message } }, status);

const RETRY_COPY = 'No pudimos finalizar el entrenamiento. Intentá de nuevo.';

describe('/workout/active finishing the workout', () => {
  beforeEach(() => {
    // resetAllMocks, not clearAllMocks: clear drains call history but NOT the queue of
    // mockXOnce implementations, so an unconsumed one leaks into the next test and
    // fails it for a reason that has nothing to do with what it checks.
    vi.resetAllMocks();
    vi.mocked(workoutService.getActiveWorkout).mockResolvedValue(session);
  });

  // The happy path had no test at all: the service was stubbed to succeed and nothing
  // asserted what happened next.
  it('confirms and leaves the workout when the finish succeeds', async () => {
    vi.mocked(workoutService.finishWorkout).mockResolvedValue({});
    render(<ActiveWorkoutPage />);

    fireEvent.click(await screen.findByLabelText('finish'));

    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('¡Entrenamiento finalizado!'));
    expect(replace).toHaveBeenCalledWith('/workout');
    expect(toast.error).not.toHaveBeenCalled();
    // router.replace is an async transition and this page stays mounted while it
    // resolves. Clearing the session is what stops the finished workout from being
    // tappable in the meantime.
    expect(screen.queryByLabelText('finish')).toBeNull();
  });

  // A 404 says the id names nothing the caller owns, so retrying can never succeed.
  // Telling the user to try again strands them on a screen whose only exit is the
  // button that just failed — and the URL must be REPLACED, because re-entering
  // /workout/active silently starts a brand-new workout.
  it('leaves the workout instead of offering a retry when the finish answers 404', async () => {
    vi.mocked(workoutService.finishWorkout).mockRejectedValue(apiError(404, 'Session not found'));
    render(<ActiveWorkoutPage />);

    fireEvent.click(await screen.findByLabelText('finish'));

    await waitFor(() => expect(replace).toHaveBeenCalledWith('/workout'));
    expect(toast.error).not.toHaveBeenCalledWith(RETRY_COPY);
    expect(push).not.toHaveBeenCalled();
    // Same reason as the success path: the screen must not survive the transition.
    // Left mounted, the user keeps tapping a workout the server says is not theirs.
    expect(screen.queryByLabelText('finish')).toBeNull();
    expect(toast.error).toHaveBeenCalledWith(
      'Este entrenamiento ya no está disponible. Volvé a empezar para seguir registrando.'
    );
  });

  // The Finalizar button has no disabled state and no debounce, and `session` is not
  // cleared until AFTER the await, so `if (!session) return` lets both taps through.
  // The server being idempotent stops the data damage, not the UI noise — and on a slow
  // connection the two taps do not even resolve the same way.
  it('fires one request when the button is tapped twice before it resolves', async () => {
    let settle: (value: unknown) => void = () => {};
    vi.mocked(workoutService.finishWorkout).mockReturnValue(
      new Promise((resolve) => { settle = resolve; })
    );
    render(<ActiveWorkoutPage />);
    const button = await screen.findByLabelText('finish');

    fireEvent.click(button);
    fireEvent.click(button);
    settle({});

    await waitFor(() => expect(toast.success).toHaveBeenCalled());
    expect(workoutService.finishWorkout).toHaveBeenCalledTimes(1);
    expect(toast.success).toHaveBeenCalledTimes(1);
    expect(replace).toHaveBeenCalledTimes(1);
  });

  // The counterweight to the latch: it collapses one tap's burst, it must not silence
  // the button for good. Latched shut after a failure, the user is left holding a
  // workout they can never finish — strictly worse than the duplicate toasts the latch
  // exists to prevent.
  it('lets the user tap again after a failure', async () => {
    vi.mocked(workoutService.finishWorkout)
      .mockRejectedValueOnce(handleApiError(new TypeError('Failed to fetch')))
      .mockResolvedValueOnce({});
    render(<ActiveWorkoutPage />);
    const button = await screen.findByLabelText('finish');

    fireEvent.click(button);
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(RETRY_COPY));
    fireEvent.click(button);

    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('¡Entrenamiento finalizado!'));
    expect(workoutService.finishWorkout).toHaveBeenCalledTimes(2);
  });

  // Not every 404 is the finish handler's. The express catch-all and anything in front
  // of it (proxy miss, wrong base URL, deploy skew) answer 404 with a FLAT body, and a
  // non-JSON body is swallowed to `{}` by workout.service. Those say nothing about the
  // session, which is alive on the server — so ejecting is both a lie and a trap: the
  // user is sent to /workout, getActiveWorkout hands the session straight back, and the
  // only way out is the button that ejects them again.
  //
  // This is the distinction `apiErrorStatus` exists to make, and the reason it demands a
  // nested message string. It now lives in error.handler.ts as the single definition,
  // shared with active-workout.tsx — which is the whole point: two rules for the same
  // question, one file apart, is how this bug got in.
  it.each([
    ['the express catch-all (flat error string)', { error: 'Route POST /api/workouts/sess1/finish not found', statusCode: 404 }],
    ['a non-JSON body swallowed to {}', {}],
  ])('does not eject on a 404 that did not come from the finish handler — %s', async (_label, body) => {
    vi.mocked(workoutService.finishWorkout).mockRejectedValue(handleApiError(body, 404));
    render(<ActiveWorkoutPage />);

    fireEvent.click(await screen.findByLabelText('finish'));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(RETRY_COPY));
    expect(replace).not.toHaveBeenCalled();
    // The workout is still there and still writable: the screen must survive.
    expect(screen.queryByLabelText('finish')).not.toBeNull();
  });

  // The counterweight: a genuine fault is the one case where "try again" is honest,
  // and it must NOT eject — the workout is still there and still writable.
  it.each([
    ['a network failure', handleApiError(new TypeError('Failed to fetch'))],
    ['a server fault', apiError(500, 'Internal server error')],
  ])('keeps the user on the workout and offers a retry on %s', async (_label, error) => {
    vi.mocked(workoutService.finishWorkout).mockRejectedValue(error);
    render(<ActiveWorkoutPage />);

    fireEvent.click(await screen.findByLabelText('finish'));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(RETRY_COPY));
    expect(replace).not.toHaveBeenCalled();
    expect(toast.success).not.toHaveBeenCalled();
  });
});
