// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@/lib/api/client', () => ({ apiClient: vi.fn() }));

import { apiClient } from '@/lib/api/client';
import { getVolumeStats } from './dashboard.service';

const mockedClient = vi.mocked(apiClient);
const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });
const url = () => mockedClient.mock.calls[0][0] as string;

/**
 * progress-timezone-day-boundaries D13 -- getVolumeStats has no live caller today, but
 * leaving it pointed at the fallback is exactly the trap this slice closes: the day someone
 * wires it to a component, the bug ships silently. mutant m19 (same shape as
 * progress.service.tz.test.ts): a PRESENCE-only oracle (`toContain('tz=')`) already passed in
 * slice 1 with `tz=''`, so every assertion here reads the VALUE.
 */
describe('dashboard.service getVolumeStats sends the browser tz', () => {
  const STUB_ZONE = 'Pacific/Kiritimati';
  let resolvedOptionsSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockedClient.mockResolvedValue(ok({ data: {} }));
    resolvedOptionsSpy = vi
      .spyOn(Intl.DateTimeFormat.prototype, 'resolvedOptions')
      .mockReturnValue({ timeZone: STUB_ZONE } as Intl.ResolvedDateTimeFormatOptions);
  });

  afterEach(() => {
    resolvedOptionsSpy.mockRestore();
  });

  it('sends the exact stubbed zone value, not just a present tz key', async () => {
    await getVolumeStats();

    expect(url()).toContain(`tz=${encodeURIComponent(STUB_ZONE)}`);
  });

  // m19's own failure mode, reproduced as a negative check.
  it('rejects an empty tz value as insufficient (the m19 regression itself)', async () => {
    await getVolumeStats();

    expect(url()).not.toContain('tz=&');
    expect(url()).not.toMatch(/tz=$/);
  });
});
