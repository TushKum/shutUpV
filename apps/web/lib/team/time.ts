// The server's view of time for team screens. Pure.

/**
 * Has the deadline passed by the server clock? As app.deadline_passed: at the deadline itself the window is already
 * closed (a save at 23:00:00 is refused), a missing deadline has not passed, and while the event is paused a deadline
 * after the pause began has not (it moves later on resume).
 */
export function deadlinePassed(at: string | null | undefined, nowMs: number, pause: { paused: boolean; pausedAt: string | null } = { paused: false, pausedAt: null }): boolean {
  if (!at) return false;
  const t = new Date(at).getTime();
  if (pause.paused && pause.pausedAt && t > new Date(pause.pausedAt).getTime()) return false;
  return nowMs >= t;
}
