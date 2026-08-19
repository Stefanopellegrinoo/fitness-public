export type SessionAction = 'resume' | 'start-requested' | 'none';

/**
 * Decides what /workout/active should do on load.
 * Visiting the page must NEVER start a session implicitly: starting requires
 * either an explicit routineId in the URL or an already-active session.
 */
export function resolveSessionAction(
  activeSession: { routineId?: string | null } | null,
  requestedRoutineId: string | undefined
): SessionAction {
  if (requestedRoutineId && activeSession?.routineId !== requestedRoutineId) {
    return 'start-requested';
  }
  if (activeSession) {
    return 'resume';
  }
  return 'none';
}
