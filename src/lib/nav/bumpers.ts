import { writable } from 'svelte/store'

/** True while a theme's top bar has claimed L1/R1 for its section tabs (`shell.top.bumpers`). The
 *  featured banner and the schedule read it to move their own bumper use out of the way. */
export const bumperTabs = writable(false)

/** The tab L1 (-1) or R1 (+1) moves to from `current`, or null at either end: sections never wrap,
 *  so a held bumper can't spin through the app. Off any tab it starts from the matching end. */
export function stepSection(hrefs: string[], current: string | undefined, dir: -1 | 1): string | null {
  const index = current ? hrefs.indexOf(current) : -1
  if (index < 0) return hrefs[dir > 0 ? 0 : hrefs.length - 1] ?? null
  return hrefs[index + dir] ?? null
}

/** True while a page steps its own sections with L1/R1 (Settings in controller mode, spec §5.5); the
 *  theme's bumper tabs leave L1/R1 to it there. */
export const pageBumpers = writable(false)
