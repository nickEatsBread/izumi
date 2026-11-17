// The API 8 loading screens' shared clock. The episode screen moves from the opening screen to the player's
// cover mid-load (two components); `--loading-elapsed` (minus the time since the wait began) lets a
// stylesheet write `animation-delay: var(--loading-elapsed)` so a loop keeps its phase and an entrance
// does not replay at that hand-over. The client itself animates nothing.
export type LoadingMoment = 'title' | 'episode'

/** A screen that starts within this long of the last one ending continues the same wait (the hand-over
 *  waits on the player's code loading). */
export const HANDOVER_MS = 1500

const since: Record<LoadingMoment, number> = { title: 0, episode: 0 }
const live: Record<LoadingMoment, number> = { title: 0, episode: 0 }
const ended: Record<LoadingMoment, number> = { title: -Infinity, episode: -Infinity }

/** A screen of this moment starts showing; returns its `--loading-elapsed` ("-1840ms", "0ms"). */
export function beginLoading(moment: LoadingMoment, now = Date.now()): string {
  if (live[moment] === 0 && now - ended[moment] > HANDOVER_MS) since[moment] = now
  live[moment]++
  return `${Math.min(0, since[moment] - now)}ms`
}

/** A screen of this moment stops showing (its wait is over, or it unmounted). */
export function endLoading(moment: LoadingMoment, now = Date.now()): void {
  live[moment] = Math.max(0, live[moment] - 1)
  if (live[moment] === 0) ended[moment] = now
}
