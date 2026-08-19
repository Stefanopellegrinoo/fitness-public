// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/api/client', () => ({ apiClient: vi.fn() }));

import { apiClient } from '@/lib/api/client';
import { addWorkoutSet, linkExerciseToSession, deleteWorkoutSet, updateWorkoutSet } from './workout.service';
import { isApiError } from './error.handler';

const mockedClient = vi.mocked(apiClient);

const jsonResponse = (body: unknown, status: number) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

// These calls used to hand `handleApiError` a literal `{}`, so the body never reached
// it and every 409 collapsed into "Conflict occurred. Resource already exists." — a
// message stating the opposite of the cause. The status is what callers branch on, and
// it has to survive the outer catch's re-wrap too.
describe('workout service surfaces the backend error body', () => {
  beforeEach(() => vi.clearAllMocks());

  it('carries the 409 status and the backend message out of addWorkoutSet', async () => {
    mockedClient.mockResolvedValue(
      jsonResponse({ error: { message: 'This workout session is already finished' } }, 409)
    );

    const error = await addWorkoutSet('sess1', {
      exerciseId: 'ex1', setNumber: 1, weightKg: 40, reps: 10,
    }).then(() => null, (e) => e);

    expect(isApiError(error)).toBe(true);
    expect(error.statusCode).toBe(409);
    expect(error.message).toBe('This workout session is already finished');
  });

  it('carries the 404 status and the backend message out of linkExerciseToSession', async () => {
    mockedClient.mockResolvedValue(jsonResponse({ error: { message: 'Session not found' } }, 404));

    const error = await linkExerciseToSession('sess1', 'ex1').then(() => null, (e) => e);

    expect(isApiError(error)).toBe(true);
    expect(error.statusCode).toBe(404);
    expect(error.message).toBe('Session not found');
  });

  // The set-mutation calls carry the eject on the active-workout screen. The component
  // tests mock this whole module and fabricate their errors, so nothing there notices if
  // these two stop parsing the body: `apiErrorStatus` requires a nested message string,
  // an unparsed body yields `{}`, and the 409 eject silently stops firing on un-mark,
  // delete and the background weight sync — with the suite still green.
  it.each([
    ['deleteWorkoutSet', () => deleteWorkoutSet('set1')],
    ['updateWorkoutSet', () => updateWorkoutSet('set1', { weightKg: 60 })],
  ])('carries the 409 status and the backend message out of %s', async (_label, call) => {
    mockedClient.mockResolvedValue(
      jsonResponse({ error: { message: 'This workout session is already finished' } }, 409)
    );

    const error = await call().then(() => null, (e) => e);

    expect(isApiError(error)).toBe(true);
    expect(error.statusCode).toBe(409);
    expect(error.message).toBe('This workout session is already finished');
    expect(error.originalError).toEqual({ error: { message: 'This workout session is already finished' } });
  });

  // A body that is not JSON (proxy HTML, empty 502) must not turn an HTTP error into a
  // parse error: the status still has to reach the caller, with the generic fallback copy.
  it('keeps the status when the error body is not JSON', async () => {
    mockedClient.mockResolvedValue(new Response('<html>502</html>', { status: 502 }));

    const error = await addWorkoutSet('sess1', {
      exerciseId: 'ex1', setNumber: 1, weightKg: 40, reps: 10,
    }).then(() => null, (e) => e);

    expect(isApiError(error)).toBe(true);
    expect(error.statusCode).toBe(502);
    expect(typeof error.message).toBe('string');
  });

  // `error` is read as a fallback when `error.message` is absent, so a nested body
  // without a message hands the whole object to the ApiError constructor. `message`
  // is a parameter property, assigned AFTER super(), so it is NOT stringified: the
  // object reaches whatever renders it and the user reads "[object Object]".
  it('falls back to per-status copy when the body nests something other than a message', async () => {
    mockedClient.mockResolvedValue(
      jsonResponse({ error: { code: 'session_closed' } }, 409)
    );

    const error = await addWorkoutSet('sess1', {
      exerciseId: 'ex1', setNumber: 1, weightKg: 40, reps: 10,
    }).then(() => null, (e) => e);

    expect(error.statusCode).toBe(409);
    expect(typeof error.message).toBe('string');
  });
});
