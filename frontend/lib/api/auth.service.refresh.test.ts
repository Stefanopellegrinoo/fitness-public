// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { refresh } from './auth.service';

/**
 * The queueing promise inside `refresh()`, and who is listening to it.
 *
 * `refresh()` keeps a module-level `pendingRefresh` so that CONCURRENT callers
 * share one network round-trip instead of each firing their own. It builds that
 * queue out of a manually-constructed promise, and on failure it does two
 * things: it rejects that promise (for the queued callers) and it throws (for
 * the caller that started it).
 *
 * When nobody is queued — which is the ordinary case, and always the case on a
 * cold page load — the rejected queueing promise has NO handler attached, so it
 * surfaces as an unhandled rejection.
 *
 * MEASURED in a real browser before the fix: loading `/register` or `/login`
 * with no session emitted `GET /auth/me -> 401`, `POST /auth/refresh -> 401`,
 * and then an uncaught `ApiError: Your session expired. Please login again.`
 * with this stack:
 *
 *     at handleApiError
 *     at Object.refresh
 *     at async AuthProvider.useEffect.initializeAuth
 *
 * `initializeAuth` DOES wrap that call in try/catch, so the throw is handled and
 * the app behaves correctly — it renders the login form. What escapes is the
 * other half: the rejection nobody awaited. So the user-visible symptom is not a
 * broken screen, it is that every brand-new visitor trips an uncaught error
 * announcing that a session they never had has expired.
 */
describe('authService.refresh — la promesa de encolado', () => {
  let sinManejar: unknown[];
  let onUnhandled: (reason: unknown) => void;

  beforeEach(() => {
    sinManejar = [];
    // `process`, not `window.addEventListener('unhandledrejection')`: under
    // jsdom the browser event is not emitted, so a window listener silently
    // observes nothing and the test would pass no matter what.
    onUnhandled = (reason: unknown) => { sinManejar.push(reason); };
    process.on('unhandledRejection', onUnhandled);
  });

  afterEach(() => {
    process.off('unhandledRejection', onUnhandled);
    vi.unstubAllGlobals();
  });

  /** A 401 from the refresh endpoint — what a visitor with no cookies gets. */
  const fetch401 = () =>
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: 'Refresh token not found' }), { status: 401 })
    ));

  /** Rejections are reported on a later task, so the check must outlive it. */
  const dejarPasarElTick = () => new Promise(r => setTimeout(r, 30));

  it('no deja una rechazada sin escuchar cuando nadie está encolado', async () => {
    fetch401();

    await expect(refresh()).rejects.toBeDefined();
    await dejarPasarElTick();

    expect(sinManejar, `rechazo sin manejar: ${sinManejar[0]}`).toHaveLength(0);
  });

  /**
   * The queue must keep working: a second caller arriving while the first is in
   * flight still has to learn that the refresh failed. Silencing the rejection
   * must not silence it FOR THEM.
   */
  it('sigue rechazando a quien está encolado', async () => {
    let responder: (r: Response) => void = () => {};
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(res => { responder = res; })));

    const primero = refresh();
    const segundo = refresh(); // queued behind the first

    responder(new Response(JSON.stringify({ error: 'nope' }), { status: 401 }));

    await expect(primero).rejects.toBeDefined();
    await expect(segundo).rejects.toBeDefined();
    await dejarPasarElTick();

    expect(sinManejar).toHaveLength(0);
  });

  /** And a successful refresh still resolves, for both the starter and the queued. */
  it('resuelve normalmente cuando el refresh anda', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      new Response(JSON.stringify({}), { status: 200, headers: { 'Content-Type': 'application/json' } })
    ));

    await expect(refresh()).resolves.toBeUndefined();
    await dejarPasarElTick();

    expect(sinManejar).toHaveLength(0);
  });
});
