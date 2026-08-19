import { describe, it, expect } from 'vitest';
import { resolveSessionAction } from './session-action';

describe('resolveSessionAction', () => {
  it('resumes when there is an active session and no specific routine requested', () => {
    expect(resolveSessionAction({ routineId: 'r1' }, undefined)).toBe('resume');
  });

  it('resumes when the active session matches the requested routine', () => {
    expect(resolveSessionAction({ routineId: 'r1' }, 'r1')).toBe('resume');
  });

  it('starts the requested routine when it differs from the active session', () => {
    expect(resolveSessionAction({ routineId: 'r1' }, 'r2')).toBe('start-requested');
  });

  it('starts the requested routine when there is no active session', () => {
    expect(resolveSessionAction(null, 'r2')).toBe('start-requested');
  });

  it('does NOT start anything when there is no active session and no routine requested', () => {
    expect(resolveSessionAction(null, undefined)).toBe('none');
  });
});
