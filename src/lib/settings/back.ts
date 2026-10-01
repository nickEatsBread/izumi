import { get } from 'svelte/store'
import { goto } from '$app/navigation'
import { isMobile } from '$lib/platform'
import { markBackPending } from '$lib/nav/nav-state'
import { previousPath, settingsOrigin, stepsBackTo } from '$lib/navigation/history-trail'
import { isSettingsPath, normaliseSettingsPath, settingsNode, settingsParent } from './hierarchy'

// Back inside Settings with nothing open (spec §3.8 step 9, owner decision 4).
// - Desktop/Deck rail layout: B on a page moves focus to its rail item (Right then returns to the
//   row B left), a sub-page goes up to its parent, and B on the rail leaves Settings.
// - Phone layout: every page goes up one level; the index leaves Settings.
// Going up or leaving returns through history when the page to return to is the previous entry,
// so Back never stacks a second copy of it (the old header ping-pong); otherwise it replaces.
// This is the one module on the Back path that imports $app/navigation (nav/back.ts reaches
// navigation only through it).

export type SettingsBackSource = 'gamepad' | 'system' | 'header'
export type SettingsBackAction = 'leave' | 'up' | 'rail'

/** data-nav-id given to the row B left, and the rail link's data-nav-right target. */
export const RAIL_RETURN_ID = 'settings-rail-return'
/** The category column: the aside region (commit 7, off TV) or the rail list itself (everywhere). */
export const SETTINGS_RAIL_SELECTOR = '[data-nav-region="settings"], [data-settings-rail]'
const SETTINGS_SURFACE_SELECTOR = '[data-nav-surface="settings"]'

const visible = (el: HTMLElement) => el.checkVisibility?.() ?? true

/** The current page's rail link: the region's default item (commit 7), else the rail item marked
 *  aria-current="page" (other aria-current elements, a hero dot or a drawer item, never count).
 *  null when no rail is on screen or it has no item for this page. */
export function settingsRailLink(): HTMLElement | null {
  const regionDefault = document.querySelector<HTMLElement>('[data-nav-region="settings"] [data-nav-region-default]')
  if (regionDefault && visible(regionDefault)) return regionDefault
  const current = document.querySelector<HTMLElement>('[data-settings-rail] [aria-current="page"]')
  return current && visible(current) ? current : null
}

/** What settingsBack(source) would do now; null outside Settings. A pure read, shared with the B
 *  prompt (nav/back.ts computeBackHint). The phone header's arrow only exists on a phone child page
 *  and always goes up. */
export function settingsBackAction(
  source: SettingsBackSource,
  pathname: string = location.pathname,
  focus: Element | null = document.activeElement,
): SettingsBackAction | null {
  if (!isSettingsPath(pathname)) return null
  const node = settingsNode(pathname)
  if (get(isMobile) || source === 'header') return node.level === 0 ? 'leave' : 'up'
  if (focus?.closest(SETTINGS_RAIL_SELECTOR)) return 'leave'
  if (node.level >= 2) return 'up'
  return settingsRailLink() ? 'rail' : 'leave'
}

/** The Settings step of the layered Back. false outside Settings. */
export function settingsBack(source: SettingsBackSource): boolean {
  const action = settingsBackAction(source)
  if (action === null) return false
  if (action === 'up') goUp()
  // 'rail' leaves Settings instead when the rail link cannot take focus.
  else if (action === 'leave' || !focusRailItem()) leaveSettings()
  return true
}

/** Up to the structural parent: history.back() when the previous entry is the parent (or a page it
 *  accepts), else replace this entry with the parent. */
export function goUp(pathname: string = location.pathname): void {
  const parent = settingsParent(pathname)
  if (!parent) return
  markBackPending()
  const previous = previousPath()
  if (previous !== null && parent.accepts.includes(normaliseSettingsPath(previous))) history.back()
  else void goto(parent.href, { replaceState: true })
}

/** Out of Settings: back through history to the first page before it, else replace with where
 *  Settings was entered from (or Home). */
export function leaveSettings(): void {
  markBackPending()
  const steps = stepsBackTo((path) => !isSettingsPath(path))
  if (steps !== null) history.go(-steps)
  else void goto(settingsOrigin() ?? '/app/home', { replaceState: true })
}

/** Focus the current page's rail link. When B came from the settings content, the row it left gets
 *  data-nav-id=RAIL_RETURN_ID (its own nav id is kept and used instead) and the rail link's
 *  data-nav-right points at it, so Right returns to that row. Any older mark is removed first. */
export function focusRailItem(from: Element | null = document.activeElement): boolean {
  const link = settingsRailLink()
  if (!link) return false
  for (const holder of document.querySelectorAll<HTMLElement>(`[data-nav-id="${RAIL_RETURN_ID}"]`)) holder.removeAttribute('data-nav-id')
  for (const railItem of document.querySelectorAll<HTMLElement>('[data-settings-rail] [data-nav-right], [data-nav-region="settings"] [data-nav-right]')) {
    railItem.removeAttribute('data-nav-right')
  }
  const row = from instanceof HTMLElement && from.closest(SETTINGS_SURFACE_SELECTOR)
    ? from.closest<HTMLElement>('[data-focusable]')
    : null
  if (row) {
    if (!row.dataset.navId) row.dataset.navId = RAIL_RETURN_ID
    link.dataset.navRight = row.dataset.navId
  }
  link.focus({ preventScroll: true })
  link.scrollIntoView?.({ block: 'nearest' })
  return true
}
