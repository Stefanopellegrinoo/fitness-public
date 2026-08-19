// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { RoutineForm } from './routine-form';
import type { RoutineDraft } from '@/lib/routines/routine-mapping';

const initial: RoutineDraft = {
  name: 'PPL',
  days: [{ name: 'Lunes', weekday: 'LUNES', order: 1, exercises: [
    { exerciseId: 'ex1', name: 'Press', order: 0, advanced: false, sets: { workingSets: 3, repsMin: 8, repsMax: 12, rpe: 8 } },
  ] }],
};

describe('RoutineForm methodology toggle', () => {
  it('switches an exercise to advanced and reveals the set editor', () => {
    render(<RoutineForm mode="edit" initial={initial} onSubmit={vi.fn()} />);
    // Step 1 (info) -> step 2 (exercises): advance via the header button
    fireEvent.click(screen.getByRole('button', { name: /Siguiente/ }));
    // Simple mode: the advanced editor is absent
    expect(screen.queryByText('Agregar set')).toBeNull();
    // Toggle the exercise to Advanced
    fireEvent.click(screen.getByText('Avanzado'));
    expect(screen.getByText('Agregar set')).toBeTruthy();
  });

  it('warns before collapsing a non-homogeneous advanced exercise to simple', () => {
    const initialAdv: any = {
      name: 'PPL',
      days: [{ name: 'Lunes', weekday: 'LUNES', order: 1, exercises: [
        { exerciseId: 'ex1', name: 'Squat', order: 0, advanced: true,
          sets: { workingSets: 1 },
          setPlans: [{ setType: 'TOP', repsMin: 3, repsMax: 5 }, { setType: 'BACKOFF', repsMin: 8, repsMax: 10, percentOfTopSet: 80 }] },
      ] }],
    };
    render(<RoutineForm mode="edit" initial={initialAdv} onSubmit={() => Promise.resolve()} />);
    // navigate to step 2, then click "Simple"
    fireEvent.click(screen.getByRole('button', { name: /Siguiente/ }));
    fireEvent.click(screen.getByText('Simple'));
    expect(screen.getByText(/perdés la config avanzada/i)).toBeTruthy();
  });

  it('clears a pending collapse prompt when an earlier exercise is removed (index-keyed prompt bug)', () => {
    // Day has THREE exercises: [0] plain simple (A), [1] advanced +
    // non-homogeneous (B), [2] advanced + non-homogeneous (C). This is the
    // minimum shape that actually reproduces the bug: collapsePrompt is
    // keyed as `${code}-${idx}`, so opening the confirm on B sets it to
    // "L-1". Removing A shifts B out and C DOWN into index 1 — the exact
    // slot the stale "L-1" prompt still points at. Without the fix, C would
    // wrongly inherit a warning it never asked for. (A 2-exercise day can't
    // exercise this: there'd be no third exercise to shift into the stale
    // index, so the prompt being gone is indistinguishable from "there's
    // nothing left to show it on".)
    const initialThree: any = {
      name: 'PPL',
      days: [{ name: 'Lunes', weekday: 'LUNES', order: 1, exercises: [
        { exerciseId: 'ex1', name: 'Press', order: 0, advanced: false,
          sets: { workingSets: 3, repsMin: 8, repsMax: 12, rpe: 8 } },
        { exerciseId: 'ex2', name: 'Squat', order: 1, advanced: true,
          sets: { workingSets: 1 },
          setPlans: [{ setType: 'TOP', repsMin: 3, repsMax: 5 }, { setType: 'BACKOFF', repsMin: 8, repsMax: 10, percentOfTopSet: 80 }] },
        { exerciseId: 'ex3', name: 'Deadlift', order: 2, advanced: true,
          sets: { workingSets: 1 },
          setPlans: [{ setType: 'TOP', repsMin: 3, repsMax: 5 }, { setType: 'BACKOFF', repsMin: 8, repsMax: 10, percentOfTopSet: 80 }] },
      ] }],
    };
    render(<RoutineForm mode="edit" initial={initialThree} onSubmit={() => Promise.resolve()} />);
    fireEvent.click(screen.getByRole('button', { name: /Siguiente/ }));

    // Three exercises each render a "Simple" mode-toggle button (order
    // A, B, C); the second ("Squat"/B) is the advanced/non-homogeneous one
    // whose toggle opens the confirm prompt.
    const simpleToggles = screen.getAllByText('Simple');
    expect(simpleToggles).toHaveLength(3);
    fireEvent.click(simpleToggles[1]);
    expect(screen.getByText(/perdés la config avanzada/i)).toBeTruthy();

    // Remove the FIRST exercise ("Press"/A) via the exercise-level remove
    // button, now identified by its accessible name.
    const removeButtons = screen.getAllByLabelText('Eliminar ejercicio');
    expect(removeButtons).toHaveLength(3);
    fireEvent.click(removeButtons[0]);

    // The prompt must be gone — "Deadlift"/C, now shifted into the stale
    // index, never asked to collapse and must not show the warning it never
    // requested.
    expect(screen.queryByText(/perdés la config avanzada/i)).toBeNull();
  });

  it('blocks saving when an advanced set-plan value is out of range', () => {
    const initialOutOfRange: any = {
      name: 'PPL',
      days: [{ name: 'Lunes', weekday: 'LUNES', order: 1, exercises: [
        { exerciseId: 'ex1', name: 'Squat', order: 0, advanced: true,
          sets: { workingSets: 1 },
          // RPE 50 is outside the valid 1-10 range — must block onSubmit.
          setPlans: [{ setType: 'WORKING', repsMin: 8, repsMax: 10, targetRpe: 50 }] },
      ] }],
    };
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(<RoutineForm mode="edit" initial={initialOutOfRange} onSubmit={onSubmit} />);
    fireEvent.click(screen.getByRole('button', { name: /Siguiente/ }));
    fireEvent.click(screen.getByRole('button', { name: /Guardar|Finalizar/ }));
    // Scope to the error alert — the "RPE" field label in the set-plan row
    // also matches /RPE/i as plain text, so a bare getByText is ambiguous.
    expect(screen.getByRole('alert').textContent).toMatch(/RPE/i);
    expect(onSubmit).not.toHaveBeenCalled();
  });
});
