/** Compact visual countdown for a Unix timestamp. Unit symbols stay lowercase so this reads as a
 * duration (`19h 50m`), not an all-caps status code. */
export function airingCountdown(airingAt: number, nowMs = Date.now()): string {
  const seconds = Math.max(0, Math.floor(airingAt - nowMs / 1000))
  if (seconds <= 0) return 'Airing now'
  if (seconds < 60) return `${seconds}s`
  const days = Math.floor(seconds / 86_400)
  const hours = Math.floor((seconds % 86_400) / 3_600)
  const minutes = Math.floor((seconds % 3_600) / 60)
  if (days > 0) return `${days}d${hours > 0 ? ` ${hours}h` : ''}`
  if (hours > 0) return `${hours}h${minutes > 0 ? ` ${minutes}m` : ''}`
  return `${minutes}m`
}

/** Screen-reader version of the compact countdown. Visual unit symbols save space, while assistive
 * technology gets unambiguous, naturally pluralized words. */
export function airingCountdownAccessible(airingAt: number, nowMs = Date.now()): string {
  const seconds = Math.max(0, Math.floor(airingAt - nowMs / 1000))
  if (seconds <= 0) return 'airing now'
  if (seconds < 60) return `${seconds} ${seconds === 1 ? 'second' : 'seconds'}`
  const days = Math.floor(seconds / 86_400)
  const hours = Math.floor((seconds % 86_400) / 3_600)
  const minutes = Math.floor((seconds % 3_600) / 60)
  const parts = [
    days ? `${days} ${days === 1 ? 'day' : 'days'}` : '',
    hours ? `${hours} ${hours === 1 ? 'hour' : 'hours'}` : '',
    !days && minutes ? `${minutes} ${minutes === 1 ? 'minute' : 'minutes'}` : '',
  ].filter(Boolean)
  return parts.join(' and ')
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
