// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ActiveSetRow } from './active-set-row';
import type { SessionSet } from '@/lib/workouts/session-exercises';

const set = (s: Partial<SessionSet>): SessionSet => ({ id: 's1', weight: 0, reps: 8, completed: false, ...s });
const noop = () => {};

const weightInput = () => screen.getByLabelText('Peso del set') as HTMLInputElement;

describe('ActiveSetRow', () => {
  it('renders the methodology badge when the set has a plan', () => {
    render(<ActiveSetRow set={set({ plan: { order: 1, setType: 'TOP', repsMin: 3, repsMax: 5 } })} index={1} onUpdate={noop} onSetWeight={noop} onToggle={noop} onRemove={noop} />);
    expect(screen.getByLabelText('Tipo de set').textContent).toBe('Top set');
  });

  it('displays the suggested weight (and a "sugerido" tag) when weight is 0', () => {
    render(<ActiveSetRow set={set({ weight: 0 })} index={1} suggestedWeight={80} onUpdate={noop} onSetWeight={noop} onToggle={noop} onRemove={noop} />);
    expect(weightInput().value).toBe('80');
    expect(screen.getByText(/sugerido/i)).toBeTruthy();
  });

  it('prefers the logged weight over the suggestion once entered', () => {
    render(<ActiveSetRow set={set({ weight: 85 })} index={1} suggestedWeight={80} onUpdate={noop} onSetWeight={noop} onToggle={noop} onRemove={noop} />);
    expect(weightInput().value).toBe('85');
    expect(screen.queryByText(/sugerido/i)).toBeNull();
  });

  it('calls onUpdate/onToggle/onRemove from the controls', () => {
    const onUpdate = vi.fn(), onToggle = vi.fn(), onRemove = vi.fn();
    render(<ActiveSetRow set={set({})} index={1} onUpdate={onUpdate} onSetWeight={noop} onToggle={onToggle} onRemove={onRemove} />);
    fireEvent.click(screen.getByLabelText('Subir peso'));
    expect(onUpdate).toHaveBeenCalledWith('weight', 2.5);
    fireEvent.click(screen.getByLabelText('Completar set'));
    expect(onToggle).toHaveBeenCalled();
    fireEvent.click(screen.getByLabelText('Borrar serie'));
    expect(onRemove).toHaveBeenCalled();
  });

  it('commits a typed weight on blur', () => {
    const onSetWeight = vi.fn();
    render(<ActiveSetRow set={set({ weight: 0 })} index={1} onUpdate={noop} onSetWeight={onSetWeight} onToggle={noop} onRemove={noop} />);
    fireEvent.focus(weightInput());
    fireEvent.change(weightInput(), { target: { value: '100' } });
    fireEvent.blur(weightInput());
    expect(onSetWeight).toHaveBeenCalledWith(100);
  });

  it('commits a typed weight on Enter', () => {
    const onSetWeight = vi.fn();
    render(<ActiveSetRow set={set({ weight: 60 })} index={1} onUpdate={noop} onSetWeight={onSetWeight} onToggle={noop} onRemove={noop} />);
    fireEvent.focus(weightInput());
    fireEvent.change(weightInput(), { target: { value: '62.5' } });
    fireEvent.keyDown(weightInput(), { key: 'Enter' });
    expect(onSetWeight).toHaveBeenCalledWith(62.5);
  });

  it('reverts to the previous weight without committing when the input is emptied', () => {
    const onSetWeight = vi.fn();
    render(<ActiveSetRow set={set({ weight: 80 })} index={1} onUpdate={noop} onSetWeight={onSetWeight} onToggle={noop} onRemove={noop} />);
    fireEvent.focus(weightInput());
    fireEvent.change(weightInput(), { target: { value: '' } });
    fireEvent.blur(weightInput());
    expect(onSetWeight).not.toHaveBeenCalled();
    expect(weightInput().value).toBe('80');
  });

  it('rejects a negative weight', () => {
    const onSetWeight = vi.fn();
    render(<ActiveSetRow set={set({ weight: 80 })} index={1} onUpdate={noop} onSetWeight={onSetWeight} onToggle={noop} onRemove={noop} />);
    fireEvent.focus(weightInput());
    fireEvent.change(weightInput(), { target: { value: '-5' } });
    fireEvent.blur(weightInput());
    expect(onSetWeight).not.toHaveBeenCalled();
    expect(weightInput().value).toBe('80');
  });

  it('does not commit when focusing and blurring without changes, so a suggestion stays a suggestion', () => {
    const onSetWeight = vi.fn();
    render(<ActiveSetRow set={set({ weight: 0 })} index={1} suggestedWeight={80} onUpdate={noop} onSetWeight={onSetWeight} onToggle={noop} onRemove={noop} />);
    fireEvent.focus(weightInput());
    fireEvent.blur(weightInput());
    expect(onSetWeight).not.toHaveBeenCalled();
    expect(screen.getByText(/sugerido/i)).toBeTruthy();
  });
});
