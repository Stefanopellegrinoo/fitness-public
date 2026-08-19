// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { RoutineForm } from './routine-form';

/**
 * Which days a NEW routine starts with, and what tapping one does.
 *
 * MEASURED in a real browser before this was fixed: the form seeded
 * `selectedDays: ["L"]`, so Monday came pre-selected on a routine the user had
 * not begun to describe. Tapping "L" — the natural gesture for "I train on
 * Mondays" — TOGGLED IT OFF, leaving no days selected, and "Siguiente" went
 * disabled with nothing on screen explaining why. Step 1 has no error message
 * at all: its `onNext` only advances, so the disabled button IS the entire
 * feedback.
 *
 * The other half of the cost is silent: a user who wants Tuesday and Thursday
 * picks those two and never notices Monday was already on, and the routine is
 * created with a third day they never asked for.
 *
 * Editing an existing routine is a different question and keeps its own days —
 * pinned below so the fix cannot leak into that path.
 */
describe('RoutineForm — días de una rutina nueva', () => {
  // Anchored on purpose: a bare name would also match "Siguiente..." for "S".
  const dia = (letra: string) => screen.getByRole('button', { name: new RegExp(`^${letra}$`) });
  const siguiente = () => screen.getByRole('button', { name: /Siguiente/ }) as HTMLButtonElement;

  // "Selected" is a visual state; the class carrying it is what the chip uses
  // for the active background. Asserted through the button's own class list so
  // the test breaks if selection stops being expressed at all.
  const estaSeleccionado = (letra: string) => {
    const el = dia(letra);
    return el.className.includes('bg-primary');
  };

  it('no preselecciona ningún día', () => {
    render(<RoutineForm mode="create" onSubmit={vi.fn()} />);

    for (const letra of ['L', 'M', 'X', 'J', 'V', 'S', 'D']) {
      expect(estaSeleccionado(letra), `el día ${letra} no debería venir marcado`).toBe(false);
    }
  });

  /**
   * The regression itself, stated as the user's gesture: tapping a day must
   * turn it ON. With Monday seeded, this exact click turned it OFF.
   */
  it('tocar un día lo selecciona, no lo apaga', () => {
    render(<RoutineForm mode="create" onSubmit={vi.fn()} />);

    fireEvent.click(dia('L'));

    expect(estaSeleccionado('L')).toBe(true);
  });

  /**
   * And the consequence that reached the button: with a name typed and one day
   * tapped, the user can move on. Before the fix this same sequence left
   * `selectedDays` empty and the button disabled.
   */
  it('habilita Siguiente con un nombre y un día tocado', () => {
    render(<RoutineForm mode="create" onSubmit={vi.fn()} />);

    fireEvent.change(screen.getByPlaceholderText(/Push/i), { target: { value: 'Rutina nueva' } });
    fireEvent.click(dia('L'));

    expect(siguiente().disabled).toBe(false);
  });

  it('mantiene Siguiente deshabilitado mientras no haya ningún día', () => {
    render(<RoutineForm mode="create" onSubmit={vi.fn()} />);

    fireEvent.change(screen.getByPlaceholderText(/Push/i), { target: { value: 'Rutina nueva' } });

    expect(siguiente().disabled).toBe(true);
  });

  /** Editing keeps the days the routine already has — untouched by the fix. */
  it('al editar conserva los días de la rutina existente', () => {
    render(
      <RoutineForm
        mode="edit"
        initial={{
          name: 'PPL',
          days: [{ name: 'Miércoles', weekday: 'MIERCOLES', order: 1, exercises: [] }],
        }}
        onSubmit={vi.fn()}
      />
    );

    expect(estaSeleccionado('X')).toBe(true);
    expect(estaSeleccionado('L')).toBe(false);
  });
});
