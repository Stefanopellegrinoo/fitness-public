// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SetPlanEditor } from './set-plan-editor';
import type { SetPlanEntry } from '@/lib/routines/routine-mapping';

const sets: SetPlanEntry[] = [{ id: 'sp_a', setType: 'WORKING', repsMin: 8, repsMax: 12 }];

describe('SetPlanEditor', () => {
  it('appends a WORKING set when "Agregar set" is clicked', () => {
    const onChange = vi.fn();
    render(<SetPlanEditor sets={sets} onChange={onChange} />);
    fireEvent.click(screen.getByText('Agregar set'));
    const next = onChange.mock.calls[0][0] as SetPlanEntry[];
    expect(next).toHaveLength(2);
    expect(next[1].setType).toBe('WORKING');
  });

  it('applies a preset by replacing the list (after inline confirm)', () => {
    const onChange = vi.fn();
    render(<SetPlanEditor sets={sets} onChange={onChange} />);
    fireEvent.change(screen.getByLabelText('Plantilla'), { target: { value: 'top-backoff' } });
    fireEvent.click(screen.getByText('Reemplazar'));
    const next = onChange.mock.calls[0][0] as SetPlanEntry[];
    expect(next[0].setType).toBe('TOP');
    expect(next.every((s) => s.id)).toBe(true);
  });

  it('removes a set', () => {
    const two: SetPlanEntry[] = [
      { id: 'sp_a', setType: 'WORKING' },
      { id: 'sp_b', setType: 'BACKOFF' },
    ];
    const onChange = vi.fn();
    render(<SetPlanEditor sets={two} onChange={onChange} />);
    fireEvent.click(screen.getAllByLabelText('Borrar')[0]);
    const next = onChange.mock.calls[0][0] as SetPlanEntry[];
    expect(next).toHaveLength(1);
    expect(next[0].id).toBe('sp_b');
  });

  it('duplicates a row immediately after the source with a new id', () => {
    const two: SetPlanEntry[] = [
      { id: 'sp_a', setType: 'WORKING', repsMin: 8, repsMax: 12 },
      { id: 'sp_b', setType: 'BACKOFF', repsMin: 6, repsMax: 8 },
    ];
    const onChange = vi.fn();
    render(<SetPlanEditor sets={two} onChange={onChange} />);
    fireEvent.click(screen.getAllByLabelText('Duplicar')[0]);
    const next = onChange.mock.calls[0][0] as SetPlanEntry[];
    expect(next).toHaveLength(3);
    expect(next[0].id).toBe('sp_a');
    expect(next[1].id).not.toBe(next[0].id);
    expect(next[1]).toMatchObject({ setType: 'WORKING', repsMin: 8, repsMax: 12 });
    expect(next[2].id).toBe('sp_b');
  });

  it('moves the first row down, swapping it with the second', () => {
    const two: SetPlanEntry[] = [
      { id: 'sp_a', setType: 'WORKING' },
      { id: 'sp_b', setType: 'BACKOFF' },
    ];
    const onChange = vi.fn();
    render(<SetPlanEditor sets={two} onChange={onChange} />);
    fireEvent.click(screen.getAllByLabelText('Bajar')[0]);
    const next = onChange.mock.calls[0][0] as SetPlanEntry[];
    expect(next.map((s) => s.id)).toEqual(['sp_b', 'sp_a']);
  });

  it('moves the second row up, swapping it with the first', () => {
    const two: SetPlanEntry[] = [
      { id: 'sp_a', setType: 'WORKING' },
      { id: 'sp_b', setType: 'BACKOFF' },
    ];
    const onChange = vi.fn();
    render(<SetPlanEditor sets={two} onChange={onChange} />);
    fireEvent.click(screen.getAllByLabelText('Subir')[1]);
    const next = onChange.mock.calls[0][0] as SetPlanEntry[];
    expect(next.map((s) => s.id)).toEqual(['sp_b', 'sp_a']);
  });

  it('applies a preset immediately with no confirm strip when the list is empty', () => {
    const onChange = vi.fn();
    render(<SetPlanEditor sets={[]} onChange={onChange} />);
    fireEvent.change(screen.getByLabelText('Plantilla'), { target: { value: 'drop' } });
    expect(onChange).toHaveBeenCalledTimes(1);
    const next = onChange.mock.calls[0][0] as SetPlanEntry[];
    expect(next).toHaveLength(3);
    expect(next.map((s) => s.setType)).toEqual(['WORKING', 'DROP', 'DROP']);
    expect(next.every((s) => !!s.id)).toBe(true);
    expect(screen.queryByText('Reemplazar')).toBeNull();
  });
});
