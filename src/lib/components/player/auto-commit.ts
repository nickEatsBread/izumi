// When the auto-play countdown is allowed to commit, kept pure so it can be tested without a clock.
//
// The curated best-release lookup (releases.moe) is deliberately off the critical path: the picker
// paints, ranks and counts down on `seadex === null`, and a matched entry re-ranks the list when it
// lands. That is right for the LIST — but the countdown commits after a couple of seconds, and an
// entry landing a moment later re-ranks nothing, because playback already started. With "Mark best
// releases" on, the auto-pick would then quietly ignore the very curation the setting exists for.
//
// So the bar fills as before and, if the lookup is still in flight when it reaches the end, the
// commit HOLDS at full for a short grace. The grace is capped: a slow or hanging releases.moe must
// cost a moment, never the playback itself.

export type AutoCommitPhase = 'counting' | 'holding' | 'commit'

export type AutoCommitInput = {
  /** Milliseconds since the countdown started. */
  elapsed: number
  /** The countdown the user is watching. */
  autoMs: number
  /** Is the curated best-release lookup for this title still in flight? */
  curatedPending: boolean
  /** How long past the countdown that lookup may hold the commit. */
  graceMs?: number
}

export const AUTO_CURATED_GRACE_MS = 1200

export function autoCommitPhase({
  elapsed, autoMs, curatedPending, graceMs = AUTO_CURATED_GRACE_MS,
}: AutoCommitInput): AutoCommitPhase {
  if (elapsed < autoMs) return 'counting'
  if (curatedPending && elapsed < autoMs + graceMs) return 'holding'
  return 'commit'
}

/** The 0..1 the progress bar fills to. Held at full through the grace, never past it. */
export const autoCommitProgress = (elapsed: number, autoMs: number) =>
  Math.min(1, elapsed / autoMs)
