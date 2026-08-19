import { describe, it, expect } from 'vitest'
import { formatSessionTime } from './format-time'

describe('formatSessionTime', () => {
  it('formats sub-hour durations as MM:SS', () => {
    expect(formatSessionTime(0)).toBe('00:00')
    expect(formatSessionTime(5)).toBe('00:05')
    expect(formatSessionTime(332)).toBe('05:32')
    expect(formatSessionTime(3599)).toBe('59:59')
  })

  it('formats durations of an hour or more as H:MM:SS instead of piling up minutes', () => {
    expect(formatSessionTime(3600)).toBe('1:00:00')
    expect(formatSessionTime(3661)).toBe('1:01:01')
    expect(formatSessionTime(12 * 3600 + 34 * 60 + 56)).toBe('12:34:56')
  })

  it('clamps negative values to zero (client/server clock skew)', () => {
    expect(formatSessionTime(-3)).toBe('00:00')
  })
})
