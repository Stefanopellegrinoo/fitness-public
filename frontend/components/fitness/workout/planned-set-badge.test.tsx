// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PlannedSetBadge } from './planned-set-badge';
import type { PlannedSet } from '@/lib/types/api.types';

const plan = (p: Partial<PlannedSet>): PlannedSet => ({ order: 1, setType: 'WORKING', ...p });

describe('PlannedSetBadge', () => {
  it('shows the SetType label and the rep range', () => {
    render(<PlannedSetBadge plan={plan({ setType: 'TOP', repsMin: 3, repsMax: 5 })} />);
    expect(screen.getByLabelText('Tipo de set').textContent).toBe('Top set');
    expect(screen.getByText(/3–5 reps/)).toBeTruthy();
  });

  it('shows %top when there is no explicit target weight', () => {
    render(<PlannedSetBadge plan={plan({ setType: 'BACKOFF', percentOfTopSet: 80 })} />);
    expect(screen.getByText(/80% top/)).toBeTruthy();
  });

  it('shows the explicit target weight and hides %top when both exist', () => {
    render(<PlannedSetBadge plan={plan({ targetWeightKg: 100, percentOfTopSet: 80 })} />);
    expect(screen.getByText(/100kg/)).toBeTruthy();
    expect(screen.queryByText(/80% top/)).toBeNull();
  });

  it('shows RIR and rest when present', () => {
    render(<PlannedSetBadge plan={plan({ targetRir: 2, restSeconds: 120 })} />);
    expect(screen.getByText(/RIR 2/)).toBeTruthy();
    expect(screen.getByText(/120s/)).toBeTruthy();
  });
});
