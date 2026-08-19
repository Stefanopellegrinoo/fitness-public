// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

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
    finishWorkout: vi.fn().mockResolvedValue({}),
  },
}));
// The screen itself is covered by active-workout.session-gone.test.tsx; what this file
// pins is only which navigation each callback is wired to.
vi.mock('@/components/fitness/active-workout', () => ({
  ActiveWorkout: ({ onBack, onSessionGone }: { onBack: () => void; onSessionGone: () => void }) => (
    <>
      <button aria-label="back" onClick={onBack} />
      <button aria-label="session-gone" onClick={onSessionGone} />
    </>
  ),
}));

import ActiveWorkoutPage from './page';
import { workoutService } from '@/lib/api/workout.service';

// A resumable session, so the page renders the workout instead of starting one.
const session = { id: 'sess1', startedAt: new Date().toISOString(), routineId: null, routine: { name: 'R' }, exercises: [], sets: [] };

describe('/workout/active navigation on a dead session', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(workoutService.getActiveWorkout).mockResolvedValue(session);
  });

  // The eject cannot leave the dead URL in history. Re-entering /workout/active is
  // not a no-op: getActiveWorkout now answers null, resolveSessionAction returns
  // 'start-requested' and startWorkout fires — a brand-new workout handed to a user
  // who was just told theirs ended.
  it('replaces the URL when the session is gone, and never pushes', async () => {
    render(<ActiveWorkoutPage />);

    fireEvent.click(await screen.findByLabelText('session-gone'));

    await waitFor(() => expect(replace).toHaveBeenCalledWith('/workout'));
    expect(push).not.toHaveBeenCalled();
  });

  // The counterweight: the ordinary header back arrow is a normal navigation and
  // must stay a push, so the workout is still one Back tap away.
  it('pushes for the ordinary back arrow', async () => {
    render(<ActiveWorkoutPage />);

    fireEvent.click(await screen.findByLabelText('back'));

    await waitFor(() => expect(push).toHaveBeenCalledWith('/workout'));
    expect(replace).not.toHaveBeenCalled();
  });
});
