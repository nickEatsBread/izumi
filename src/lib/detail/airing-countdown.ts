// The series countdown's API 4 formats (`detail.countdown` `words`, `full` and `date`), kept pure so
// the wording is testable without a page. `compact` and `long` live in $lib/themes/countdown, which
// theme templates share.

const DAY = 86_400

function units(seconds: number) {
  const s = Math.max(0, Math.floor(seconds))
  return { d: Math.floor(s / DAY), h: Math.floor((s % DAY) / 3600), m: Math.floor((s % 3600) / 60), s: s % 60 }
}
const count = (n: number, noun: string) => `${n} ${noun}${n === 1 ? '' : 's'}`

/** The two largest units in words: "2 days 3 hours", "3 hours 4 minutes", or "4 minutes" in the last
 *  hour (never "0 minutes" while the episode is still to come). */
export function wordsCountdown(seconds: number): string {
  const { d, h, m } = units(seconds)
  if (d > 0) return `${count(d, 'day')} ${count(h, 'hour')}`
  if (h > 0) return `${count(h, 'hour')} ${count(m, 'minute')}`
  return count(Math.max(1, m), 'minute')
}

/** Every unit down to seconds, zeros included: "2 days 3 hrs 4 mins 5 secs". */
export function fullCountdown(seconds: number): string {
  const { d, h, m, s } = units(seconds)
  return `${count(d, 'day')} ${count(h, 'hr')} ${count(m, 'min')} ${count(s, 'sec')}`
}

/** The local airing time, "Sun, Aug 2 at 4:16 PM": the day in the viewer's locale and the time on
 *  their 12- or 24-hour clock (the locale's own, as the schedule shows it). `airingAt` is in seconds. */
export function airingDate(airingAt: number, options: { locale?: string; timeZone?: string } = {}): string {
  const at = new Date(airingAt * 1000)
  const day = new Intl.DateTimeFormat(options.locale, { weekday: 'short', month: 'short', day: 'numeric', timeZone: options.timeZone }).format(at)
  const time = new Intl.DateTimeFormat(options.locale, { hour: 'numeric', minute: '2-digit', timeZone: options.timeZone }).format(at)
  return `${day} at ${time}`
}

/** Whether a countdown shows: the episode is still to come and, with `countdownWithin`, no more than
 *  that many days away. */
export function countdownShown(seconds: number, withinDays?: number): boolean {
  return seconds > 0 && (withinDays == null || seconds <= withinDays * DAY)
}
