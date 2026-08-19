// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SetPlanRow } from './set-plan-row';
import type { SetPlanEntry } from '@/lib/routines/routine-mapping';

const entry: SetPlanEntry = { id: 'sp_1', setType: 'BACKOFF', repsMin: 8, repsMax: 10 };

describe('SetPlanRow', () => {
  it('renders type and reps and hides advanced fields by default', () => {
    render(<SetPlanRow entry={entry} index={1} canMoveUp canMoveDown onChange={() => {}} onRemove={() => {}} onDuplicate={() => {}} onMoveUp={() => {}} onMoveDown={() => {}} />);
    expect((screen.getByLabelText('Tipo de set') as HTMLSelectElement).value).toBe('BACKOFF');
    expect(screen.queryByLabelText('%top')).toBeNull();
  });

  it('reveals advanced fields when "más" is clicked', () => {
    render(<SetPlanRow entry={entry} index={1} canMoveUp canMoveDown onChange={() => {}} onRemove={() => {}} onDuplicate={() => {}} onMoveUp={() => {}} onMoveDown={() => {}} />);
    fireEvent.click(screen.getByText('más'));
    expect(screen.getByLabelText('%top')).toBeTruthy();
  });

  it('calls onChange with a number when reps min changes', () => {
    const onChange = vi.fn();
    render(<SetPlanRow entry={entry} index={1} canMoveUp canMoveDown onChange={onChange} onRemove={() => {}} onDuplicate={() => {}} onMoveUp={() => {}} onMoveDown={() => {}} />);
    fireEvent.change(screen.getByLabelText('Reps min'), { target: { value: '6' } });
    expect(onChange).toHaveBeenCalledWith({ repsMin: 6 });
  });

  it('calls onChange with the new set type', () => {
    const onChange = vi.fn();
    render(<SetPlanRow entry={entry} index={1} canMoveUp canMoveDown onChange={onChange} onRemove={() => {}} onDuplicate={() => {}} onMoveUp={() => {}} onMoveDown={() => {}} />);
    fireEvent.change(screen.getByLabelText('Tipo de set'), { target: { value: 'TOP' } });
    expect(onChange).toHaveBeenCalledWith({ setType: 'TOP' });
  });
});
