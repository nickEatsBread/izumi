import { tick } from 'svelte'
import { goto } from '$app/navigation'
import { focusByNav, setNavMoveOwner, type Dir } from '$lib/nav'
import { describeFocus, focusRestoreAllowed, resolveFocus, type FocusDescriptor } from '$lib/nav/focus-memory'
import { isNavigable } from '$lib/nav/focusable'
import { isSettingsPath, normaliseSettingsPath } from './hierarchy'
import { SETTING_PARAM } from './search'

// NuvioTV's two focus zones for Settings in controller mode (Android TV, Steam Deck Game mode; spec
// §5.2). Focus resting on a rail item shows its section 140 ms later without moving; Right or A
// enters the pane on the control last used on that page, else its first; Left at the pane's edge is
// the nav engine's region crossing back to the lit rail item (the region default). The settings
// layout installs this on its controller branch. Every rule reads the DOM, so jsdom tests cover it.

export const RAIL_PREVIEW_MS = 140
/** A switch from the rail replaces the history entry, so Back leaves Settings in one step however
 *  many sections were previewed, and focus stays where it is. */
const SWITCH = { replaceState: true, keepFocus: true, noScroll: true } as const
const RAIL_LINK = '[data-settings-rail] a[href]'
const LIT_LINK = `${RAIL_LINK}[aria-current="page"]`

// Session memory (spec §5.2), kept in memory like route focus memory: a reload starts fresh.
let lastSection: string | null = null
const lastRows = new Map<string, FocusDescriptor>()

const isLit = (link: Element) => link.getAttribute('aria-current') === 'page'

/** Where Right or A lands in `pane`: the control last focused on page `path` while it is still
 *  there, else the pane's first control. null for an empty pane. */
export function paneEntryTarget(pane: ParentNode, path: string = location.pathname): HTMLElement | null {
  const remembered = lastRows.get(path)
  const hit = remembered ? resolveFocus(remembered, pane) : null
  if (hit && isNavigable(hit)) return hit
  return [...pane.querySelectorAll<HTMLElement>('[data-focusable]')].find(isNavigable) ?? null
}

/** Focus the lit rail item, revealed inside the rail. false when there is none. */
export function focusRailEntry(root: ParentNode = document): boolean {
  const link = root.querySelector<HTMLElement>(LIT_LINK)
  if (!link || !isNavigable(link)) return false
  focusByNav(link, true)
  return true
}

/** Which edges of a scroller have more content past them (the pane's faint chevrons). */
export function scrollEdges(el: { scrollTop: number; clientHeight: number; scrollHeight: number }): { up: boolean; down: boolean } {
  return { up: el.scrollTop > 1, down: el.scrollTop + el.clientHeight < el.scrollHeight - 1 }
}

export interface ControllerNavigation { type: string; from: URL | null; to: URL | null }

/** The settings layout's afterNavigate in controller mode. Entering Settings at its bare route opens
 *  the section remembered from earlier this session (the bare route shows Playback), and entering it
 *  with a pad or a remote puts focus on the lit rail item. A history step keeps route focus memory's
 *  restore and a search hit keeps its own reveal. Every landing remembers the lit section. */
export async function controllerLanded(navigation: ControllerNavigation, root: ParentNode = document): Promise<void> {
  const { type, from, to } = navigation
  if (!to) return
  const entering = (!from || !isSettingsPath(from.pathname)) && type !== 'popstate'
  if (entering && lastSection && normaliseSettingsPath(to.pathname) === '/app/settings') {
    await goto(lastSection, { replaceState: true, noScroll: true })
    if (focusRestoreAllowed()) focusRailEntry(root)
    return
  }
  const lit = root.querySelector(LIT_LINK)?.getAttribute('href')
  if (lit) lastSection = lit
  if (entering && !to.searchParams.has(SETTING_PARAM) && focusRestoreAllowed()) focusRailEntry(root)
}

/** Install the zones on the controller layout's root; returns the teardown. */
export function installControllerZones(root: HTMLElement): () => void {
  let pending: ReturnType<typeof setTimeout> | null = null
  const pane = () => root.querySelector<HTMLElement>('[data-settings-pane]')
  const cancelPreview = () => {
    if (pending !== null) clearTimeout(pending)
    pending = null
  }

  async function showSection(href: string): Promise<void> {
    await goto(href, SWITCH)
    const scroller = pane()
    if (scroller) scroller.scrollTop = 0
  }

  /** Right or A on a rail item: show its section now if it is not the one shown, then focus the
   *  pane's entry control. */
  async function enterPane(link: HTMLAnchorElement): Promise<void> {
    cancelPreview()
    const href = link.getAttribute('href')
    if (href && !isLit(link)) await showSection(href)
    await tick()
    const scroller = pane()
    const target = scroller ? paneEntryTarget(scroller) : null
    if (target) focusByNav(target, true)
  }

  const owner = (active: HTMLElement, dir: Dir): HTMLElement | null | undefined => {
    if (dir !== 'right') return undefined
    const link = active.closest<HTMLAnchorElement>(RAIL_LINK)
    if (!link || !root.contains(link)) return undefined
    const scroller = pane()
    if (isLit(link)) return scroller ? paneEntryTarget(scroller) : null
    void enterPane(link)
    return null
  }

  const onFocusIn = (event: FocusEvent) => {
    if (!(event.target instanceof HTMLElement)) return
    const link = event.target.closest<HTMLAnchorElement>(RAIL_LINK)
    if (link) {
      cancelPreview()
      const href = link.getAttribute('href')
      if (href && !isLit(link)) pending = setTimeout(() => { pending = null; void showSection(href) }, RAIL_PREVIEW_MS)
      return
    }
    if (!pane()?.contains(event.target)) return
    const row = describeFocus(event.target)
    if (row) lastRows.set(location.pathname, row)
  }

  // Focus leaving the rail (Left to the app strip, a dialog) drops a preview still waiting.
  const onFocusOut = (event: FocusEvent) => {
    const next = event.relatedTarget
    const rail = root.querySelector('[data-settings-rail]')
    if (pending !== null && !(next instanceof Node && rail?.contains(next))) cancelPreview()
  }

  // A or OK on a rail item arrives as a click with no pointer behind it (detail 0) and enters the
  // pane; a tap or a mouse click stays an ordinary link.
  const onClick = (event: MouseEvent) => {
    const link = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>(RAIL_LINK) : null
    if (!link || event.detail > 0 || event.defaultPrevented) return
    event.preventDefault()
    void enterPane(link)
  }

  root.addEventListener('focusin', onFocusIn)
  root.addEventListener('focusout', onFocusOut)
  root.addEventListener('click', onClick)
  const stopOwner = setNavMoveOwner(owner)
  return () => {
    cancelPreview()
    root.removeEventListener('focusin', onFocusIn)
    root.removeEventListener('focusout', onFocusOut)
    root.removeEventListener('click', onClick)
    stopOwner()
  }
}

/** Test hook: forget the remembered section and rows. */
export function resetControllerZonesForTests(): void {
  lastSection = null
  lastRows.clear()
}
