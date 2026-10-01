import { get } from 'svelte/store'
import { isTv } from '$lib/platform'
import { inputType } from './input'
import { isNavigable } from './focusable'
import { setFocusHint } from './focus-hint'

// Where focus was, in a form that survives the element being re-rendered (spec §3.9). A nav layer
// describes its opener when it opens and resolves it again when it closes; the chooser, the
// keyboard's close fallback and (commit 10) route returns reuse the same pair.

/** A keyed ancestor of the described element: the attribute that identifies it and its value. */
export interface FocusAncestor { attr: string; value: string }

export interface FocusDescriptor {
  navId?: string
  id?: string
  /** An `a[href]`'s attribute value. */
  href?: string
  /** The closest `[data-setting-key]`. */
  settingKey?: string
  tag: string
  /** aria-label, else text, whitespace-collapsed, trimmed, at most 80 characters. */
  label: string
  /** Index among the document's focus candidates (TWIN_CANDIDATES) with the same tag and label. */
  labelIndex: number
  /** location.pathname + location.search when described. */
  path: string
  /** The closest `[data-nav-region]` value. */
  region?: string
  /** Up to four keyed ancestors, innermost first: the "nearest connected ancestor" fallback. */
  ancestors?: FocusAncestor[]
  /** `<data-row>|<data-nav-key>` of a card (commit 10): the same title in two rows is two cards. */
  cardKey?: string
}

const ANCESTOR_ATTRIBUTES = ['data-nav-id', 'id', 'data-setting-key', 'data-row', 'data-nav-region']
const ANCESTOR_LIMIT = 4
const LABEL_LIMIT = 80
/** Elements that can take focus: the only ones numbered by tag and label. A page-sized container
 *  (a DIV wrapping the whole page when the opener is a `div[role=button]` card) is never read, so
 *  describing focus stays cheap on every layer open and, from commit 10, every navigation. */
const TWIN_CANDIDATES = '[data-focusable], [tabindex], a[href], button, input, select, textarea, summary'

function labelOf(el: Element): string {
  return (el.getAttribute('aria-label') ?? el.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, LABEL_LIMIT)
}

/** Focus candidates under `root` with this tag and label, in document order. describeFocus and
 *  resolveFocus share it, so a labelIndex means the same thing on both sides. */
function labelTwins(root: ParentNode, tag: string, label: string): HTMLElement[] {
  const twins: HTMLElement[] = []
  for (const candidate of root.querySelectorAll<HTMLElement>(TWIN_CANDIDATES)) {
    if (candidate.tagName === tag && labelOf(candidate) === label) twins.push(candidate)
  }
  return twins
}

function byAttribute(root: ParentNode, attribute: string, value: string): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(`[${attribute}]`)].filter((el) => el.getAttribute(attribute) === value)
}

/** The element itself when the d-pad can land on it, else its first navigable `[data-focusable]`. */
function focusTargetIn(el: HTMLElement): HTMLElement | null {
  if (!el.isConnected || el.closest('[inert]')) return null
  if (isNavigable(el)) return el
  return [...el.querySelectorAll<HTMLElement>('[data-focusable]')].find(isNavigable) ?? null
}

function firstTarget(candidates: readonly HTMLElement[]): HTMLElement | null {
  for (const candidate of candidates) {
    const target = focusTargetIn(candidate)
    if (target) return target
  }
  return null
}

export function describeFocus(el: Element | null | undefined): FocusDescriptor | null {
  if (!(el instanceof HTMLElement)) return null
  const doc = el.ownerDocument
  if (el === doc.body || el === doc.documentElement) return null
  const label = labelOf(el)
  const twins = labelTwins(doc, el.tagName, label)
  const ancestors: FocusAncestor[] = []
  for (let parent = el.parentElement; parent && ancestors.length < ANCESTOR_LIMIT; parent = parent.parentElement) {
    const current = parent
    const attr = ANCESTOR_ATTRIBUTES.find((name) => current.hasAttribute(name))
    if (attr) ancestors.push({ attr, value: current.getAttribute(attr) ?? '' })
  }
  return {
    navId: el.getAttribute('data-nav-id') || undefined,
    id: el.id || undefined,
    href: el instanceof HTMLAnchorElement ? el.getAttribute('href') || undefined : undefined,
    settingKey: el.closest('[data-setting-key]')?.getAttribute('data-setting-key') || undefined,
    tag: el.tagName,
    label,
    labelIndex: Math.max(0, twins.indexOf(el)),
    path: location.pathname + location.search,
    region: el.closest('[data-nav-region]')?.getAttribute('data-nav-region') || undefined,
    ancestors,
    ...cardKeyField(el),
  }
}

/** Order: the card key (commit 10) > data-nav-id > id > a[href] > the same control (else the first)
 *  inside [data-setting-key] > same tag + label + labelIndex > the nearest keyed ancestor's first
 *  [data-focusable]. Only connected, enabled, non-inert controls count. null when nothing matches. */
export function resolveFocus(descriptor: FocusDescriptor, root: ParentNode = document): HTMLElement | null {
  if (descriptor.cardKey) {
    const card = cardByKey(descriptor.cardKey, root)
    if (card) return card
  }
  if (descriptor.navId) {
    const hit = firstTarget(byAttribute(root, 'data-nav-id', descriptor.navId))
    if (hit) return hit
  }
  if (descriptor.id) {
    const hit = firstTarget(byAttribute(root, 'id', descriptor.id))
    if (hit) return hit
  }
  if (descriptor.href) {
    const hit = firstTarget(byAttribute(root, 'href', descriptor.href).filter((el) => el instanceof HTMLAnchorElement))
    if (hit) return hit
  }
  const sameControl = (el: HTMLElement) => el.tagName === descriptor.tag && labelOf(el) === descriptor.label
  if (descriptor.settingKey) {
    for (const row of byAttribute(root, 'data-setting-key', descriptor.settingKey)) {
      const controls = [row, ...row.querySelectorAll<HTMLElement>('[data-focusable]')]
        .filter((el) => el.matches('[data-focusable]') && isNavigable(el))
      const hit = controls.find(sameControl) ?? controls[0]
      if (hit) return hit
    }
  }
  if (descriptor.label) {
    const twins = labelTwins(root, descriptor.tag, descriptor.label)
    const preferred = twins[descriptor.labelIndex]
    const hit = firstTarget(preferred ? [preferred, ...twins] : twins)
    if (hit) return hit
  }
  for (const ancestor of descriptor.ancestors ?? []) {
    const hit = firstTarget(byAttribute(root, ancestor.attr, ancestor.value))
    if (hit) return hit
  }
  return null
}

/** resolveFocus + el.focus({ preventScroll: true }); returns the element or null. */
export function restoreFocus(descriptor: FocusDescriptor | null | undefined, root?: ParentNode): HTMLElement | null {
  if (!descriptor) return null
  const el = resolveFocus(descriptor, root)
  el?.focus({ preventScroll: true })
  return el
}

/** Focus may be moved for the user only on the d-pad or TV; touch and mouse keep their own. */
export function focusRestoreAllowed(): boolean {
  return get(inputType) === 'dpad' || get(isTv)
}

/** Hand focus back to `target` after the control that held it went away (spec §3.9, the Anime
 *  shader prompt's answer buttons): focus it when focus may move for the user, otherwise leave it
 *  as the focus hint, so the first d-pad press lands there rather than on the page's first control. */
export function handFocusBack(target: HTMLElement | null | undefined): void {
  if (!target) return
  if (focusRestoreAllowed()) target.focus({ preventScroll: true })
  else setFocusHint(target)
}

// --- Route focus memory (commit 10; spec §3.9 route-generic amendment, decision 18) ------------
// The app layout remembers what held focus on a page as it is left (beforeNavigate) and, when a
// history step returns to that page (afterNavigate with type 'popstate': B, the system Back, the
// mouse back button), puts focus back on it. Controller users only (focusRestoreAllowed). Kept in
// memory, never persisted: a reload starts fresh.

/** Routes that keep a remembered focus; the least recently remembered one is dropped first. */
export const ROUTE_FOCUS_LIMIT = 50

const routeFocus = new Map<string, FocusDescriptor>()
/** A key press, a touch or a click while a restore waits means the user has moved on. */
const ROUTE_RESTORE_CANCEL_EVENTS = ['keydown', 'pointerdown', 'click'] as const

/** `pathname + search`: the key a route's focus is remembered under. */
export function routeFocusKey(url: URL | Location): string {
  return url.pathname + url.search
}

/** A card's identity across a re-render: its row's `data-row` and its own `data-nav-key` (the Themes
 *  markers: `continue:<id>` on ContinueCard, `media:<id>` on SmallCard, rows from Carousel), or null
 *  unless both exist. */
export function routeCardKey(el: Element): string | null {
  const key = el instanceof HTMLElement ? el.dataset.navKey : undefined
  const row = el.closest<HTMLElement>('[data-row]')?.dataset.row
  return key && row ? `${row}|${key}` : null
}

function cardKeyField(el: Element): { cardKey?: string } {
  const cardKey = routeCardKey(el)
  return cardKey ? { cardKey } : {}
}

function cardByKey(cardKey: string, root: ParentNode = document): HTMLElement | null {
  for (const el of root.querySelectorAll<HTMLElement>('[data-nav-key]')) {
    if (routeCardKey(el) !== cardKey) continue
    const target = focusTargetIn(el)
    if (target) return target
  }
  return null
}

/** Remember what holds focus now (or `el`) under `key`. Controller users only; an empty focus
 *  (the body) saves nothing and keeps what was remembered before. */
export function rememberRouteFocus(key: string, el: Element | null = typeof document === 'undefined' ? null : document.activeElement): void {
  if (!el || el === document.body || !focusRestoreAllowed()) return
  const descriptor = describeFocus(el)
  if (!descriptor) return
  routeFocus.delete(key)
  routeFocus.set(key, descriptor)
  while (routeFocus.size > ROUTE_FOCUS_LIMIT) {
    const oldest = routeFocus.keys().next().value
    if (oldest === undefined) break
    routeFocus.delete(oldest)
  }
}

/** resolveFocus's answer only when it is the control that was left (the same nav id, id, link,
 *  setting row, or tag and label), never a stand-in from the ancestor fallback. */
function isSameControl(el: HTMLElement, descriptor: FocusDescriptor): boolean {
  const now = describeFocus(el)
  if (!now) return false
  return (!!descriptor.navId && now.navId === descriptor.navId)
    || (!!descriptor.id && now.id === descriptor.id)
    || (!!descriptor.href && now.href === descriptor.href)
    || (!!descriptor.settingKey && now.settingKey === descriptor.settingKey)
    || (now.tag === descriptor.tag && now.label === descriptor.label)
}

/** Strict resolution for a route return: a card by its row and key or not at all (the same title
 *  in another row is a stand-in), any other control only when it is the same control. A miss lets
 *  the page's own first focus (Home's focusWhenIdle) stand. */
function resolveRouteFocus(descriptor: FocusDescriptor): HTMLElement | null {
  if (descriptor.cardKey) return cardByKey(descriptor.cardKey)
  const el = resolveFocus(descriptor)
  return el && isSameControl(el, descriptor) ? el : null
}

/** Put focus back on what `key` remembers. Tries at once, then every frame for up to `timeoutMs`
 *  (default 1000) while lazily rendered rows arrive. Focus set automatically meanwhile (Home's
 *  focusWhenIdle) is overridden; a key press, touch or click gives up. `focus` defaults to
 *  focus({ preventScroll: true }) plus scrollIntoView({ block: 'nearest' }). Resolves the element,
 *  or null when nothing is remembered, the control is gone, the user moved on or `signal` aborted. */
export function restoreRouteFocus(
  key: string,
  options: { timeoutMs?: number; focus?: (el: HTMLElement) => void; signal?: AbortSignal } = {},
): Promise<HTMLElement | null> {
  const descriptor = routeFocus.get(key)
  if (!descriptor || options.signal?.aborted) return Promise.resolve(null)
  const timeoutMs = options.timeoutMs ?? 1000
  const focus = options.focus ?? ((el: HTMLElement) => {
    el.focus({ preventScroll: true })
    el.scrollIntoView?.({ block: 'nearest' })
  })
  const started = performance.now()
  return new Promise((resolve) => {
    let frame = 0
    let settled = false
    const settle = (el: HTMLElement | null) => {
      if (settled) return
      settled = true
      cancelAnimationFrame(frame)
      for (const type of ROUTE_RESTORE_CANCEL_EVENTS) window.removeEventListener(type, giveUp, true)
      options.signal?.removeEventListener('abort', giveUp)
      resolve(el)
    }
    const giveUp = () => settle(null)
    const attempt = () => {
      if (settled) return
      const el = resolveRouteFocus(descriptor)
      if (el) {
        if (document.activeElement !== el) focus(el)
        settle(el)
      } else if (performance.now() - started >= timeoutMs) {
        settle(null)
      } else {
        frame = requestAnimationFrame(attempt)
      }
    }
    for (const type of ROUTE_RESTORE_CANCEL_EVENTS) window.addEventListener(type, giveUp, true)
    options.signal?.addEventListener('abort', giveUp)
    attempt()
  })
}

export function resetFocusMemoryForTests(): void {
  routeFocus.clear()
}
