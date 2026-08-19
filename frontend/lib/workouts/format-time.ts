/**
 * Formats an elapsed session duration for the active-workout timer.
 * Sub-hour: MM:SS. From one hour on: H:MM:SS — a raw minute count like
 * "940:12" is unreadable and gets mistaken for hundreds of hours.
 */
export function formatSessionTime(totalSeconds: number): string {
  const safeSeconds = Math.max(0, totalSeconds)
  const hours = Math.floor(safeSeconds / 3600)
  const mins = Math.floor((safeSeconds % 3600) / 60)
  const secs = safeSeconds % 60

  const mm = mins.toString().padStart(2, '0')
  const ss = secs.toString().padStart(2, '0')

  return hours > 0 ? `${hours}:${mm}:${ss}` : `${mm}:${ss}`
}
