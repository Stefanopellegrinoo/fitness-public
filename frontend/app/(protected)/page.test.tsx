// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

vi.mock('@/lib/auth/auth.context', () => ({
  useAuth: () => ({
    user: { id: 'u1', email: 'atleta@example.com' },
    logout: vi.fn(),
    isLoading: false,
  }),
}));

vi.mock('@/lib/api/dashboard.service', () => ({
  dashboardService: { getSummary: vi.fn() },
}));

// Only the R6 describe block below un-mocks `getSummary` back to its real
// implementation (via `vi.importActual`) and drives it through this fake
// network instead — every other test in this file keeps the plain
// `vi.fn()` above and never touches `apiClient`.
vi.mock('@/lib/api/client', () => ({ apiClient: vi.fn() }));

// Every network call is a stub except `dayBounds`, kept real: a hand-copied
// stand-in would make the range assertions below tautological instead of
// exercising the function the browser actually runs.
vi.mock('@/lib/api/nutrition.service', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/lib/api/nutrition.service')>();
  return {
    nutritionService: {
      getNutritionHistory: vi.fn(),
      getNutritionGoal: vi.fn(),
      dayBounds: real.dayBounds,
    },
  };
});

import DashboardPage from './page';
import { dashboardService } from '@/lib/api/dashboard.service';
import { nutritionService } from '@/lib/api/nutrition.service';
import { apiClient } from '@/lib/api/client';

const summary = {
  todayCalories: 0,
  weeklyWorkouts: 0,
  activeMinutes: 0,
  currentWeightKg: null,
  nextWorkout: null,
};

const goal = {
  id: 'g1', userId: 'u1', kcal: 2000, proteinG: 150, carbsG: 200, fatG: 65,
  isCalculated: false, updatedAt: '',
};

const entry = (over: Record<string, unknown>) => ({
  id: 'e1', userId: 'u1', foodName: 'Algo', grams: 100,
  mealCategory: 'Desayuno', calories: 100, protein: 5, carbs: 10, fat: 2,
  date: new Date().toISOString(), status: 'COMPLETED', ...over,
});

/**
 * Freezes the clock and pins the timezone before running `body`, then
 * restores both — so an expected value computed BEFORE the render is never
 * re-derived by a second `new Date()` call at assert time. That second call
 * is exactly the two-`new Date()` pattern the component's shared `now` was
 * written to remove — reintroducing it in a test that verifies the fix
 * would make the test flaky across a real midnight and prove nothing about
 * timezones, since it never pins one.
 */
async function conRelojEn<T>(tz: string, instante: string, body: () => Promise<T>): Promise<T> {
  const original = process.env.TZ;
  process.env.TZ = tz;
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(instante));
  try {
    return await body();
  } finally {
    vi.useRealTimers();
    if (original === undefined) delete process.env.TZ;
    else process.env.TZ = original;
  }
}

describe('dashboard macros card — the nutrition history request', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(dashboardService.getSummary).mockResolvedValue(summary as never);
    vi.mocked(nutritionService.getNutritionGoal).mockResolvedValue(goal as never);
  });

  /**
   * Instants picked so the local calendar day and the UTC calendar day
   * DISAGREE — exactly where the two-`new Date()` bug this component's
   * shared `now` fix targets used to live. One negative-offset zone
   * (Argentina, the user's own, no DST since 2009) where local trails UTC,
   * and one positive half-hour-offset zone (India, no DST) where local has
   * already rolled forward — so the fix is checked in both directions
   * instead of only the one the developer happened to be sitting in.
   */
  const zonas: Array<[tz: string, instante: string, esperado: { from: string; to: string }]> = [
    [
      'America/Argentina/Buenos_Aires',
      '2026-07-30T02:00:00.000Z', // 23:00 local on the 29th — local day trails UTC's
      { from: '2026-07-29T03:00:00.000Z', to: '2026-07-30T03:00:00.000Z' },
    ],
    [
      'Asia/Kolkata',
      '2026-07-30T20:00:00.000Z', // 01:30 local on the 31st — local day is ahead of UTC's
      { from: '2026-07-30T18:30:00.000Z', to: '2026-07-31T18:30:00.000Z' },
    ],
  ];

  it.each(zonas)(
    "asks for today's window instead of an unbounded slab of history (%s)",
    async (tz, instante, esperado) => {
      vi.mocked(nutritionService.getNutritionHistory).mockResolvedValue([] as never);

      await conRelojEn(tz, instante, async () => {
        render(<DashboardPage />);
        await waitFor(() => expect(nutritionService.getNutritionHistory).toHaveBeenCalled());
      });

      const [limit, offset, range] = vi.mocked(nutritionService.getNutritionHistory).mock.calls[0];
      expect(limit).toBe(100);
      expect(offset).toBe(0);
      expect(range).toEqual(esperado);
    }
  );

  /**
   * This reproduces the SHAPE of the old bug — GET /api/nutrition sorts
   * `date desc` and caps at 100, so an unranged request can lose whichever
   * entries don't fit — but the trigger condition is narrow: it takes 100+
   * entries dated AFTER today to push today's off the page, which requires
   * logging food on a future day. The diary's `navigateDate` never blocks
   * that, but a real user doing it 100 times over is very unlikely. Kept as
   * defense-in-depth for the request-bounding half of the fix — the
   * day-instant-consistency half (one shared `now`) is what the frozen-clock
   * cases above check — not because this exact scenario is how the bug was
   * actually observed in production.
   */
  it('keeps a bounded request from losing today even in the unlikely case 100+ future-dated entries crowd an unranged top-100', async () => {
    const hoy = entry({ id: 'e-hoy', calories: 500 });
    const futuras = Array.from({ length: 100 }, (_, i) =>
      entry({
        id: `e-futura-${i}`,
        calories: 1,
        date: new Date(Date.now() + (i + 1) * 24 * 60 * 60 * 1000).toISOString(),
      })
    );

    vi.mocked(nutritionService.getNutritionHistory).mockImplementation(async (limit, _offset, range) => {
      const todas = [...futuras, hoy].sort(
        (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
      );
      const filtradas = range
        ? todas.filter((e) => {
            const t = new Date(e.date).getTime();
            return t >= new Date(range.from).getTime() && t < new Date(range.to).getTime();
          })
        : todas;
      return filtradas.slice(0, limit) as never;
    });

    render(<DashboardPage />);

    expect(await screen.findByText(/500\s*\/\s*2000\s*kcal/)).toBeTruthy();
  });
});

describe('dashboard "Calorías Hoy" card vs. macros card — one clock (spec R6)', () => {
  const mockedApiClient = vi.mocked(apiClient);

  beforeEach(async () => {
    vi.resetAllMocks();
    // `dashboardService.getSummary` is auto-mocked to a bare `vi.fn()` at the
    // top of this file, same as every other test here — a static
    // `mockResolvedValue` can never see what URL the real implementation
    // built, so it could never go RED->GREEN on the change adding
    // `tz` to the query string. Wiring the REAL implementation back in via
    // `importActual`, and controlling only the network underneath it
    // (`apiClient`), is the one seam that actually exercises that code path.
    const real = await vi.importActual<typeof import('@/lib/api/dashboard.service')>(
      '@/lib/api/dashboard.service'
    );
    vi.mocked(dashboardService.getSummary).mockImplementation(real.getSummary);
    vi.mocked(nutritionService.getNutritionGoal).mockResolvedValue(goal as never);
  });

  /**
   * Three entries, seeded once, read by two independent clocks — exactly
   * the "same underlying data" R6 describes. `MacrosCard` gets its total
   * from the real, unmocked `buildMacrosData` + `dayBounds`, which read the
   * BROWSER's local calendar day (pinned to Buenos Aires below). The fake
   * network standing in for the backend mimics today's actual bug: with no
   * `tz` on the request, it can only answer with whatever ITS OWN (UTC)
   * calendar day contains — a different subset of the same three entries.
   *
   * Hand-picked so each of the three relationships between an entry and the
   * frozen instant `2026-07-30T02:00:00.000Z` (23:00 local the 29th, in a
   * zone BA shares no midnight-adjacent DST quirks with) is covered:
   *   x: UTC 29th / local 29th  -> local-only  (BA sum only)
   *   y: UTC 30th / local 29th  -> both        (BA sum AND UTC sum)
   *   z: UTC 30th / local 30th  -> UTC-only    (UTC sum only)
   * BA sum = x+y = 1100. UTC sum = y+z = 1300. They must disagree for this
   * test to mean anything — a corpus where both totals came out equal would
   * pass whether or not the fix ever shipped.
   */
  it("shows the same total as the macros card once the request carries the browser's zone", async () => {
    const entradas = [
      entry({ id: 'x', calories: 700, date: '2026-07-29T20:00:00.000Z' }),
      entry({ id: 'y', calories: 400, date: '2026-07-30T01:30:00.000Z' }),
      entry({ id: 'z', calories: 900, date: '2026-07-30T05:00:00.000Z' }),
    ];
    vi.mocked(nutritionService.getNutritionHistory).mockResolvedValue(entradas as never);

    // Stands in for the backend: sums calories for whichever entries fall
    // on "today", where "today" is read from the request's `tz` param when
    // present, and from the fake server's own UTC calendar day otherwise —
    // the exact fallback R4 describes for an absent `tz`.
    mockedApiClient.mockImplementation(async (url) => {
      const ahora = new Date();
      // Reads the VALUE of `tz`, never merely its presence. An oracle that
      // only checked the param existed would stay green against a hardcoded
      // `tz = 'UTC'` or `tz = ''`, since both still produce a URL carrying
      // `tz=` — and the empty one ships a request the real backend answers
      // with 400, blanking the dashboard while the suite reports success.
      const zonaPedida = new URL(String(url), 'http://test.local').searchParams.get('tz');
      // Absent `tz` falls back to this fake server's own UTC calendar day,
      // which is the fallback R4 describes. A PRESENT but invalid zone throws
      // right here instead of passing quietly — that is the point.
      const enDiaLocal = new Intl.DateTimeFormat('en-CA', {
        timeZone: zonaPedida ?? 'UTC',
        dateStyle: 'short',
      });
      const hoy = enDiaLocal.format(ahora);
      const total = entradas
        .filter((e) => enDiaLocal.format(new Date(e.date)) === hoy)
        .reduce((sum, e) => sum + e.calories, 0);

      return new Response(
        JSON.stringify({
          data: {
            todayCalories: total,
            weeklyWorkouts: 0,
            activeMinutes: 0,
            currentWeightKg: null,
            nextWorkout: null,
          },
        }),
        { status: 200 }
      );
    });

    await conRelojEn('America/Argentina/Buenos_Aires', '2026-07-30T02:00:00.000Z', async () => {
      render(<DashboardPage />);
      await screen.findByText(/\/\s*2000\s*kcal/);
    });

    const metricValue = screen.getByText('Calorías Hoy').previousElementSibling?.textContent;
    const macrosValue = screen.getByText(/\/\s*2000\s*kcal/).textContent;

    expect(macrosValue).toMatch(/^1100\s*\/\s*2000\s*kcal$/);
    expect(metricValue).toBe('1100');
  });
});
