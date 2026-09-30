import { get } from 'svelte/store'
import { isTv } from '$lib/platform'
import { inputType } from './input'
import { isNavigable } from './focusable'

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
  }
}

/** Order: data-nav-id > id > a[href] > the same control (else the first) inside [data-setting-key]
 *  > same tag + label + labelIndex > the nearest keyed ancestor's first [data-focusable]. Only
 *  connected, enabled, non-inert controls count. null when nothing matches. */
export function resolveFocus(descriptor: FocusDescriptor, root: ParentNode = document): HTMLElement | null {
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
