import { tick } from 'svelte'
import { get } from 'svelte/store'
import { goto } from '$app/navigation'
import { isTv } from '$lib/platform'
import { oskOpen, playing } from '$lib/player/session'
import { focusByNav, setNavMoveOwner, type Dir } from '$lib/nav'
import { handleLayeredBack } from '$lib/nav/back'
import { pageBumpers, stepSection } from '$lib/nav/bumpers'
import { describeFocus, focusRestoreAllowed, resolveFocus, type FocusDescriptor } from '$lib/nav/focus-memory'
import { isNavigable } from '$lib/nav/focusable'
import { topNavLayer } from '$lib/nav/layers'
import { backPending, navEpoch } from '$lib/nav/nav-state'
import { isPadEvent } from '$lib/nav/pad-controls'
import { onPadButton, type PadButton } from '$lib/nav/pad-events'
import { SETTINGS_ROOT, isSettingsPath, normaliseSettingsPath, settingsRailHref } from './hierarchy'
import { SETTING_PARAM } from './search'

// NuvioTV's two focus zones for Settings in controller mode (Android TV, Steam Deck Game mode; spec
// §5.2). Focus resting on a rail item shows its section 140 ms later without moving; Right or A
// enters the pane on the control last used on that page, else its first; Left at the pane's edge is
// the nav engine's region crossing back to the lit rail item (the region default). The settings
// layout installs this on its controller branch. Every rule reads the DOM, so jsdom tests cover it.
// B is the layered Back, which the TV remote's Back is routed into here; on a pad L1/R1 step sections and Y opens search.

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
const BACK_KEYS = ['Escape', 'BrowserBack', 'GoBack']
const dialogOpen = () => [...document.querySelectorAll<HTMLElement>('[data-nav-trap]')].some((trap) => trap.checkVisibility?.() ?? true)
/** Pane memory's key for a page. The bare landing shows Playback, so it shares Playback's key. */
function pageKey(pathname: string): string {
  const path = normaliseSettingsPath(pathname)
  return path === SETTINGS_ROOT ? settingsRailHref(path) ?? path : path
}

/** Where Right or A lands in `pane`: the control last focused on page `path` while it is still
 *  there, else the pane's first control. null for an empty pane. */
export function paneEntryTarget(pane: ParentNode, path: string = location.pathname): HTMLElement | null {
  const remembered = lastRows.get(pageKey(path))
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
 *  restore and a search hit or a #block link keeps its own reveal. Every landing remembers the lit
 *  section. */
export async function controllerLanded(navigation: ControllerNavigation, root: ParentNode = document): Promise<void> {
  const { type, from, to } = navigation
  if (!to) return
  const entering = (!from || !isSettingsPath(from.pathname)) && type !== 'popstate'
  const reveal = to.searchParams.has(SETTING_PARAM) || to.hash !== ''
  if (entering && lastSection && !reveal && normaliseSettingsPath(to.pathname) === SETTINGS_ROOT) {
    await goto(lastSection, { replaceState: true, noScroll: true })
    if (focusRestoreAllowed()) focusRailEntry(root)
    return
  }
  const lit = root.querySelector(LIT_LINK)?.getAttribute('href')
  if (lit) lastSection = lit
  if (entering && !reveal && focusRestoreAllowed()) focusRailEntry(root)
}

/** Install the zones on the controller layout's root; returns the teardown. */
export function installControllerZones(root: HTMLElement): () => void {
  let pending: ReturnType<typeof setTimeout> | null = null
  // The section switch in flight, so a held Right or a Right during a preview's load waits on it
  // instead of restarting the same load.
  let showing: { href: string; done: Promise<void> } | null = null
  const pane = () => root.querySelector<HTMLElement>('[data-settings-pane]')
  // The section on screen once the switch in flight lands: aria-current moves only when it has.
  const shownHref = () => showing?.href ?? root.querySelector(LIT_LINK)?.getAttribute('href') ?? null
  const cancelPreview = () => {
    if (pending !== null) clearTimeout(pending)
    pending = null
  }

  function showSection(href: string): Promise<void> {
    if (showing?.href === href) return showing.done
    const entry = { href, done: Promise.resolve() }
    showing = entry
    entry.done = (async () => {
      try {
        await goto(href, SWITCH)
      } finally {
        if (showing === entry) showing = null
      }
      const scroller = pane()
      if (scroller) scroller.scrollTop = 0
    })()
    return entry.done
  }

  /** Right or A on a rail item: show its section now unless it is on screen with no switch loading
   *  (a load still running for another section would replace the pane), then focus the pane's entry
   *  control unless focus moved on while the section loaded. */
  async function enterPane(link: HTMLAnchorElement): Promise<void> {
    cancelPreview()
    const from = document.activeElement
    const href = link.getAttribute('href')
    if (href && (showing || !isLit(link))) await showSection(href)
    await tick()
    if (document.activeElement !== from) return
    const scroller = pane()
    const target = scroller ? paneEntryTarget(scroller) : null
    if (target) focusByNav(target, true)
  }

  const owner = (active: HTMLElement, dir: Dir): HTMLElement | null | undefined => {
    if (dir !== 'right') return undefined
    const link = active.closest<HTMLAnchorElement>(RAIL_LINK)
    if (!link || !root.contains(link)) return undefined
    const scroller = pane()
    if (!showing && isLit(link)) return scroller ? paneEntryTarget(scroller) : null
    enterPane(link).catch(() => {})
    return null
  }

  const onFocusIn = (event: FocusEvent) => {
    if (!(event.target instanceof HTMLElement)) return
    const link = event.target.closest<HTMLAnchorElement>(RAIL_LINK)
    if (link) {
      cancelPreview()
      const href = link.getAttribute('href')
      const armed = get(navEpoch)
      // A Back or any other navigation started meanwhile wins: the preview's replacing goto would
      // supersede it and overwrite the history entry it moved to.
      if (href && href !== shownHref()) pending = setTimeout(() => {
        pending = null
        if (!backPending() && get(navEpoch) === armed) showSection(href).catch(() => {})
      }, RAIL_PREVIEW_MS)
      return
    }
    const scroller = pane()
    if (!scroller?.contains(event.target)) return
    const row = describeFocus(event.target, scroller)
    if (row) lastRows.set(pageKey(location.pathname), row)
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
    enterPane(link).catch(() => {})
  }

  // The TV remote's Back is an Escape from the activity (MainActivity.kt). The shell's TV branch
  // does not walk Settings, so here it takes the layered Back B uses: an open picker, dialog or the
  // keyboard closes through its own handler first (this stands aside), then a sub-page goes up, the
  // pane returns to the rail and the rail leaves Settings.
  const onKeydown = (event: KeyboardEvent) => {
    if (!get(isTv) || !BACK_KEYS.includes(event.key) || isPadEvent(event) || event.defaultPrevented) return
    if (get(oskOpen) || topNavLayer() || dialogOpen() || !isSettingsPath(location.pathname)) return
    if (!handleLayeredBack('system')) return
    event.preventDefault()
    event.stopImmediatePropagation()
  }

  const onPad = ({ name, pressed }: PadButton) => {
    if (!pressed || get(playing) || get(oskOpen) || topNavLayer() || dialogOpen()) return
    if (name === 'y') {
      root.querySelector<HTMLElement>('[data-settings-search] button')?.click()
      return
    }
    if (name !== 'l1' && name !== 'r1') return
    const links = [...root.querySelectorAll<HTMLAnchorElement>(RAIL_LINK)]
    // From the section a switch still loading will show, so a quick second press steps on from it.
    const current = shownHref() ?? undefined
    const href = stepSection(links.map((link) => link.getAttribute('href') ?? ''), current, name === 'l1' ? -1 : 1)
    const link = links.find((candidate) => candidate.getAttribute('href') === href)
    if (!href || !link) return
    focusByNav(link, true)
    // The focus just queued a preview; a bumper switches at once instead.
    cancelPreview()
    showSection(href).catch(() => {})
  }

  root.addEventListener('focusin', onFocusIn)
  root.addEventListener('focusout', onFocusOut)
  root.addEventListener('click', onClick)
  window.addEventListener('keydown', onKeydown, true)
  const stopOwner = setNavMoveOwner(owner)
  const stopPad = onPadButton(onPad)
  pageBumpers.set(true)
  document.documentElement.dataset.navHintY = 'Search'
  return () => {
    cancelPreview()
    root.removeEventListener('focusin', onFocusIn)
    root.removeEventListener('focusout', onFocusOut)
    root.removeEventListener('click', onClick)
    window.removeEventListener('keydown', onKeydown, true)
    stopOwner()
    stopPad()
    pageBumpers.set(false)
    delete document.documentElement.dataset.navHintY
  }
}

/** Test hook: forget the remembered section and rows. */
export function resetControllerZonesForTests(): void {
  lastSection = null
  lastRows.clear()
}
