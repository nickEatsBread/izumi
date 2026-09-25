/** Countdown text for theme templates. Compact is badge-sized ("2d 21h"); long is sentence-sized
 *  ("4 days 19 hrs 43 mins"). Themes change the case with CSS (`text-transform`). */
function units(seconds: number) {
  const s = Math.max(0, Math.floor(seconds))
  return { d: Math.floor(s / 86400), h: Math.floor((s % 86400) / 3600), m: Math.floor((s % 3600) / 60) }
}

export function compactCountdown(seconds: number): string {
  const { d, h, m } = units(seconds)
  if (d > 0) return `${d}d ${h}h`
  if (h > 0) return `${h}h ${m}m`
  return `${Math.max(1, m)}m`
}

export function longCountdown(seconds: number): string {
  const { d, h, m } = units(seconds)
  const parts: string[] = []
  if (d) parts.push(`${d} ${d === 1 ? 'day' : 'days'}`)
  if (d || h) parts.push(`${h} ${h === 1 ? 'hr' : 'hrs'}`)
  const minutes = d || h ? m : Math.max(1, m)
  parts.push(`${minutes} ${minutes === 1 ? 'min' : 'mins'}`)
  return parts.join(' ')
}
