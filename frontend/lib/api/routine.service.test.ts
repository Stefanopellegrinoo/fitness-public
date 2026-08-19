// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@/lib/api/client', () => ({ apiClient: vi.fn() }));

import { apiClient } from '@/lib/api/client';
import { getErrorMessage, apiErrorStatus } from '@/lib/api/error.handler';
import { getNextDay, getAll, deleteRoutine } from './routine.service';

const mockedClient = vi.mocked(apiClient);

// What the route actually answers: no `exercises`. Its `findMany` carries no
// `include`, so a fixture that supplied the list would be more complete than
// the server and would hide exactly the mismatch worth catching.
const day = { id: 'day-2', name: 'Pull', order: 2, weekday: 'JUEVES' as const };
const urlOf = (call = 0) => new URL(mockedClient.mock.calls[call][0] as string, 'http://x');

describe('routineService.getNextDay', () => {
  beforeEach(() => vi.resetAllMocks());

  it('returns the suggested day', async () => {
    mockedClient.mockResolvedValueOnce({ ok: true, json: async () => ({ data: day }) } as unknown as Response);

    await expect(getNextDay('r-1')).resolves.toMatchObject({ id: 'day-2', name: 'Pull' });
    expect(urlOf().pathname).toContain('/routines/r-1/next-day');
  });

  /**
   * A routine with no days has no suggestion, and the API says so with a null
   * payload rather than an error.
   */
  it('returns null for a routine that has no days', async () => {
    mockedClient.mockResolvedValueOnce({ ok: true, json: async () => ({ data: null }) } as unknown as Response);

    await expect(getNextDay('r-1')).resolves.toBeNull();
  });

  it('throws when the request fails', async () => {
    mockedClient.mockResolvedValueOnce({ ok: false, status: 404, json: async () => ({}) } as unknown as Response);

    await expect(getNextDay('r-1')).rejects.toBeDefined();
  });

  /**
   * The server's own words, not a generic per-status string. `getById`,
   * `create` and `update` in this same file all read the error body before
   * throwing; this route threw `handleApiError({}, status)` and dropped it, so
   * the user got the fallback copy and `apiErrorStatus` — which only trusts a
   * status that came with a message — answered `undefined`.
   */
  it('keeps the message the server sent on an error response', async () => {
    mockedClient.mockResolvedValueOnce({
      ok: false,
      status: 404,
      json: async () => ({ error: { message: 'Esa rutina no existe' } }),
    } as unknown as Response);

    const error = await getNextDay('r-1').catch((e: unknown) => e);

    expect(getErrorMessage(error)).toBe('Esa rutina no existe');
    expect(apiErrorStatus(error)).toBe(404);
  });

  it('encodes the routine id into the path', async () => {
    mockedClient.mockResolvedValueOnce({ ok: true, json: async () => ({ data: null }) } as unknown as Response);

    await getNextDay('r/../evil');

    expect(mockedClient.mock.calls[0][0]).toContain(encodeURIComponent('r/../evil'));
  });
});

/**
 * The same defect the suggestion route had, in the two neighbours that still
 * carried it. `getAll` and `deleteRoutine` also threw `handleApiError({}, …)`,
 * so a delete that failed because the routine was gone reported the generic
 * per-status copy instead of the reason the server gave.
 *
 * Fixed alongside rather than left for later: they sit in the same file as the
 * route this PR touches, and a file where three functions read the error body
 * and two silently discard it is a coin flip for whoever writes the sixth.
 */
describe('routine.service error bodies', () => {
  beforeEach(() => vi.resetAllMocks());

  it('getAll keeps the message the server sent', async () => {
    mockedClient.mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: async () => ({ error: { message: 'La base no responde' } }),
    } as unknown as Response);

    const error = await getAll().catch((e: unknown) => e);

    expect(getErrorMessage(error)).toBe('La base no responde');
    expect(apiErrorStatus(error)).toBe(500);
  });

  it('deleteRoutine keeps the message the server sent', async () => {
    mockedClient.mockResolvedValueOnce({
      ok: false,
      status: 404,
      json: async () => ({ error: { message: 'Esa rutina ya no existe' } }),
    } as unknown as Response);

    const error = await deleteRoutine('r-1').catch((e: unknown) => e);

    expect(getErrorMessage(error)).toBe('Esa rutina ya no existe');
    expect(apiErrorStatus(error)).toBe(404);
  });
});

/**
 * The `?tz=` contract, checked the way its six siblings are.
 *
 * The weekday that anchors the rotation is the CALLER's: the same instant is
 * Monday in Buenos Aires and Tuesday in Auckland, and the server cannot know
 * which the user means. This is the seventh route on that contract.
 *
 * What omitting `tz` does is NOT a 400 — `resolveIanaZone(undefined)` falls back
 * to the process zone and `tz-contract-uniformity.test.ts` pins the absent case
 * as ACCEPTED on all seven routes. What IS rejected is `?tz=` with an EMPTY
 * value, which is why the negative below is the one worth writing.
 *
 * The zone is stubbed rather than read from the environment: asserting against
 * `Intl.DateTimeFormat().resolvedOptions().timeZone` re-runs the implementation's
 * own expression as the oracle, so the two agree even when both are wrong.
 * Mirrors `progress.service.tz.test.ts` and `dashboard.service.tz.test.ts`,
 * including mutant m19 — a presence-only oracle (`toContain('tz=')`) is
 * satisfied by an empty value.
 */
describe('routineService.getNextDay sends the browser tz', () => {
  const STUB_ZONE = 'Pacific/Kiritimati';
  let resolvedOptionsSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockedClient.mockResolvedValue({ ok: true, json: async () => ({ data: day }) } as unknown as Response);
    resolvedOptionsSpy = vi
      .spyOn(Intl.DateTimeFormat.prototype, 'resolvedOptions')
      .mockReturnValue({ timeZone: STUB_ZONE } as Intl.ResolvedDateTimeFormatOptions);
  });

  afterEach(() => {
    resolvedOptionsSpy.mockRestore();
  });

  it('sends the exact stubbed zone value, not just a present tz key', async () => {
    await getNextDay('r-1');

    expect(mockedClient.mock.calls[0][0] as string).toContain(`tz=${encodeURIComponent(STUB_ZONE)}`);
  });

  // m19's own failure mode, reproduced as a negative check: a `tz=''` fetch
  // would still satisfy `toContain('tz=')` but must NOT satisfy this — and an
  // empty value is the one thing the backend genuinely answers 400 to.
  it('rejects an empty tz value as insufficient (the m19 regression itself)', async () => {
    await getNextDay('r-1');

    const url = mockedClient.mock.calls[0][0] as string;
    expect(url).not.toContain('tz=&');
    expect(url).not.toMatch(/tz=$/);
  });

  /**
   * Resolved per call, never hoisted to module scope: hoisting would freeze the
   * zone at import time, and a user who crosses midnight — or a tab left open
   * across a DST change — would keep sending the stale one.
   */
  it('reads the zone at call time, so a later call picks up a new one', async () => {
    await getNextDay('r-1');
    resolvedOptionsSpy.mockReturnValue({ timeZone: 'America/Lima' } as Intl.ResolvedDateTimeFormatOptions);
    await getNextDay('r-1');

    expect(mockedClient.mock.calls[0][0] as string).toContain(encodeURIComponent(STUB_ZONE));
    expect(mockedClient.mock.calls[1][0] as string).toContain(encodeURIComponent('America/Lima'));
  });
});
