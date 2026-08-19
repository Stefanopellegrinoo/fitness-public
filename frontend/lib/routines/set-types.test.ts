import { describe, it, expect } from 'vitest';
import { SET_TYPE_OPTIONS } from './set-types';

describe('SET_TYPE_OPTIONS', () => {
  it('covers all 8 set types with non-empty labels', () => {
    const values = SET_TYPE_OPTIONS.map((o) => o.value);
    expect(new Set(values)).toEqual(new Set(['WORKING', 'WARMUP', 'TOP', 'BACKOFF', 'DROP', 'MYOREP', 'RESTPAUSE', 'AMRAP']));
    expect(SET_TYPE_OPTIONS.every((o) => o.label.length > 0)).toBe(true);
  });
});
