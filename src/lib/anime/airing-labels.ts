/** Miruro-style compact countdown for a Unix timestamp. Deliberately stable at the useful units:
 * days + hours when far away, hours + minutes on the same day, then seconds in the last minute. */
export function airingCountdown(airingAt: number, nowMs = Date.now()): string {
  const seconds = Math.max(0, Math.floor(airingAt - nowMs / 1000))
  if (seconds <= 0) return 'Airing now'
  if (seconds < 60) return `${seconds}s`
  const days = Math.floor(seconds / 86_400)
  const hours = Math.floor((seconds % 86_400) / 3_600)
  const minutes = Math.floor((seconds % 3_600) / 60)
  if (days > 0) return `${days}D${hours > 0 ? ` ${hours}H` : ''}`
  if (hours > 0) return `${hours}H${minutes > 0 ? ` ${minutes}M` : ''}`
  return `${minutes}M`
}

/** Human time used under Recently Released cards. */
export function releasedAgo(airingAt: number, nowMs = Date.now()): string {
  const seconds = Math.max(0, Math.floor(nowMs / 1000 - airingAt))
  if (seconds < 60) return 'Just released'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `Released ${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `Released ${hours}h ago`
  const days = Math.floor(hours / 24)
  return `Released ${days}d ago`
}
