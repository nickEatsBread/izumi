/** Long enough for a slow source lookup or direct torrent to find peers, while still staying
 * inside the ten-minute lifetime used for tokenized online/debrid URLs. */
export const MAX_NEXT_EPISODE_PRELOAD_LEAD_SECONDS = 8 * 60
export const MIN_NEXT_EPISODE_PRELOAD_LEAD_SECONDS = 90

/** Start at roughly the final third for ordinary/short episodes, capped at eight minutes for long
 * videos. The old fixed 85% trigger left a five-minute short with only 45 seconds to resolve and
 * gave a normal anime episode barely three minutes for torrent metadata plus buffering. */
export function shouldBeginNextEpisodePreload(position: number, duration: number): boolean {
  if (!Number.isFinite(position) || !Number.isFinite(duration) || duration <= 0 || position < 0) return false
  const lead = Math.min(
    MAX_NEXT_EPISODE_PRELOAD_LEAD_SECONDS,
    Math.max(MIN_NEXT_EPISODE_PRELOAD_LEAD_SECONDS, duration * 0.35),
  )
  return duration - position <= lead
}
