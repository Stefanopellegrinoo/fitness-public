// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@/lib/api/client', () => ({ apiClient: vi.fn() }));

import { apiClient } from '@/lib/api/client';
import { getBodyProgress, getNutritionProgress, getWorkoutProgress } from './progress.service';

const mockedClient = vi.mocked(apiClient);
const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });
const url = () => mockedClient.mock.calls[0][0] as string;

/**
 * progress-timezone-day-boundaries, tasks.md 1.6/1.7 -- mutant m19: a
 * PRESENCE-only oracle (`toContain('tz=')`) already passed in slice 1 with
 * `tz=''`, an empty string. Every assertion here reads the VALUE.
 */
describe('progress.service sends the browser tz on /body and /nutrition', () => {
  const STUB_ZONE = 'Pacific/Kiritimati';
  let resolvedOptionsSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockedClient.mockResolvedValue(ok({ data: [] }));
    resolvedOptionsSpy = vi
      .spyOn(Intl.DateTimeFormat.prototype, 'resolvedOptions')
      .mockReturnValue({ timeZone: STUB_ZONE } as Intl.ResolvedDateTimeFormatOptions);
  });

  afterEach(() => {
    resolvedOptionsSpy.mockRestore();
  });

  it('getBodyProgress sends the exact stubbed zone value, not just a present tz key', async () => {
    await getBodyProgress(7);

    expect(url()).toContain(`tz=${encodeURIComponent(STUB_ZONE)}`);
  });

  it('getNutritionProgress sends the exact stubbed zone value, not just a present tz key', async () => {
    await getNutritionProgress(7);

    expect(url()).toContain(`tz=${encodeURIComponent(STUB_ZONE)}`);
  });

  it('getWorkoutProgress sends the exact stubbed zone value, not just a present tz key', async () => {
    await getWorkoutProgress(4);

    expect(url()).toContain(`tz=${encodeURIComponent(STUB_ZONE)}`);
  });

  // m19's own failure mode, reproduced as a negative check: a `tz=''` fetch
  // would still satisfy `toContain('tz=')` but must NOT satisfy this.
  it('rejects an empty tz value as insufficient (the m19 regression itself)', async () => {
    await getNutritionProgress(7);

    expect(url()).not.toContain('tz=&');
    expect(url()).not.toMatch(/tz=$/);
  });
});
