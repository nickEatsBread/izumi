import { get } from 'svelte/store'
import type { Action } from 'svelte/action'
import { isTv } from '$lib/platform'
import { inputType } from './input'
import { isNavigable } from './focusable'
import { setFocusHint } from './focus-hint'
import { describeFocus, resolveFocus, type FocusDescriptor } from './focus-memory'
import { navEpoch, navInFlight } from './nav-state'
import { navLayerSerial, pushNavLayer, topNavLayer, type NavLayerCloseReason, type NavLayerRestore } from './layers'

// `use:navLayer={{ onClose }}` turns a dropdown, sheet or dialog into a nav layer (spec §3.3): a
// d-pad trap that B and Escape close one at a time. Closing it hands focus back to whatever opened
// it: at once for the d-pad, TV or a keyboard-focused opener; as a hint for the next d-pad press
// after a touch or mouse close (a Deck tap arrives as a mouse click, and a ring would appear).

export type NavLayerInitialFocus = 'dpad' | 'always' | 'none'

export interface NavLayerOptions {
  onClose: (reason: NavLayerCloseReason) => void | false
  /** Default 'overlay'. */
  kind?: string
  /** 'dpad' (default): the first non-text control, only for the d-pad or TV. 'always': whatever
   *  the modality. 'none': the component focuses itself. Focus already inside is never moved. */
  initialFocus?: NavLayerInitialFocus
  /** Default 'auto'. */
  returnFocus?: NavLayerRestore
}

export type LayerFocusReturn = 'restore' | 'hint' | 'skip'

/** Pure. 'skip' when opted out, after a navigation, on a hand-off, or when focus already moved
 *  somewhere real; 'restore' when forced, for the d-pad, on TV or for a focus-visible opener;
 *  otherwise 'hint'. */
export function decideLayerFocusReturn(input: {
  restore: NavLayerRestore
  epochChanged: boolean
  navInFlight: boolean
  serialChanged: boolean
  focusMoved: boolean
  inputType: 'mouse' | 'touch' | 'dpad'
  isTv: boolean
  openerFocusVisible: boolean
}): LayerFocusReturn {
  if (input.restore === 'none') return 'skip'
  if (input.epochChanged || input.navInFlight || input.serialChanged || input.focusMoved) return 'skip'
  if (input.restore === 'always' || input.inputType === 'dpad' || input.isTv || input.openerFocusVisible) return 'restore'
  return 'hint'
}

interface MountedLayer {
  node: HTMLElement
  opener: FocusDescriptor | null
  openerEl: HTMLElement | null
  openerFocusVisible: boolean
}

// Layers this action mounted, for the hand-off rules below.
const mounted = new Set<MountedLayer>()
let recentlyClosed: { layer: MountedLayer; at: number } | null = null
/** A layer that opens this soon after another closed, with focus lost, replaced it. */
const HANDOFF_MS = 250

export function resetOverlayForTests(): void {
  mounted.clear()
  recentlyClosed = null
}

// Commit 5's isTextEntryField (text-field.ts) supersedes this local rule.
const NON_TEXT_INPUT_TYPES = ['checkbox', 'radio', 'range', 'color', 'button', 'submit', 'reset', 'file', 'image', 'hidden']
const isTextEntry = (el: HTMLElement) =>
  el.isContentEditable
  || el instanceof HTMLTextAreaElement
  || (el instanceof HTMLInputElement && !NON_TEXT_INPUT_TYPES.includes(el.type))

function matchesFocusVisible(el: Element): boolean {
  try { return el.matches(':focus-visible') } catch { return false }
}

const usable = (el: HTMLElement | null): el is HTMLElement =>
  !!el && el.isConnected && !el.closest('[inert]') && !el.matches(':disabled')

/** Destroyed, detached or fading out. */
const gone = (layer: MountedLayer) => !mounted.has(layer) || !layer.node.isConnected || !!layer.node.closest('[inert]')

/** `use:navLayer={{ onClose, kind?, initialFocus?, returnFocus? }}`: pushes a layer on mount (the
 *  opener is whatever held focus then), removes it on destroy, marks the node
 *  `data-nav-trap data-nav-escape` if the markup does not, applies initialFocus one frame after
 *  mount, and returns focus one frame after the layer starts closing (decideLayerFocusReturn). */
export const navLayer: Action<HTMLElement, NavLayerOptions> = (node, initial) => {
  let options = initial
  const epoch = get(navEpoch)
  const focused = document.activeElement
  const active = focused instanceof HTMLElement && focused !== document.body ? focused : null
  // Focus inside a layer that is fading out (or focus lost just after one closed) means this layer
  // replaced it: it inherits that layer's opener. Focus inside a live layer means this one opens on
  // top of it: that outer layer is where the opener is found again if it is re-rendered.
  const host = active ? [...mounted].reverse().find((layer) => layer.node.contains(active)) ?? null : null
  const recent = !active && recentlyClosed && performance.now() - recentlyClosed.at <= HANDOFF_MS ? recentlyClosed.layer : null
  const inherited = host && gone(host) ? host : recent
  const outer = host && !gone(host) ? host : null
  const self: MountedLayer = inherited
    ? { node, opener: inherited.opener, openerEl: inherited.openerEl, openerFocusVisible: inherited.openerFocusVisible }
    : { node, opener: describeFocus(active), openerEl: active, openerFocusVisible: !!active && matchesFocusVisible(active) }
  mounted.add(self)
  if (!node.hasAttribute('data-nav-trap')) node.setAttribute('data-nav-trap', '')
  if (!node.hasAttribute('data-nav-escape')) node.setAttribute('data-nav-escape', '')

  let destroyed = false
  let returnFrame = 0

  const openerTarget = (): HTMLElement | null => {
    if (usable(self.openerEl)) return self.openerEl
    return self.opener ? resolveFocus(self.opener, outer?.node ?? document) : null
  }

  const onClosing = () => {
    recentlyClosed = { layer: self, at: performance.now() }
    const serial = navLayerSerial()
    cancelAnimationFrame(returnFrame)
    returnFrame = requestAnimationFrame(() => {
      // A reversed outro: the layer is open again and keeps focus.
      if (!destroyed && node.isConnected && !node.closest('[inert]')) return
      // Closing together with the layer it opened from: that layer answers for both.
      if (outer && gone(outer)) return
      const target = openerTarget()
      if (!target) return
      const top = topNavLayer()?.node()
      const current = document.activeElement
      const decision = decideLayerFocusReturn({
        restore: options.returnFocus ?? 'auto',
        epochChanged: get(navEpoch) !== epoch,
        navInFlight: get(navInFlight),
        // Hand-off: a layer registered since this one closed, or one still open elsewhere, owns focus.
        serialChanged: navLayerSerial() !== serial || (!!top && !top.contains(target)),
        focusMoved: current instanceof HTMLElement && current !== document.body && !node.contains(current),
        inputType: get(inputType),
        isTv: get(isTv),
        openerFocusVisible: self.openerFocusVisible,
      })
      if (decision === 'restore') target.focus({ preventScroll: true })
      else if (decision === 'hint') setFocusHint(target)
    })
  }

  const initialFocus = options.initialFocus ?? 'dpad'
  const focusFrame = initialFocus === 'none' ? 0 : requestAnimationFrame(() => {
    if (destroyed || !node.isConnected) return
    if (initialFocus === 'dpad' && get(inputType) !== 'dpad' && !get(isTv)) return
    if (node.contains(document.activeElement)) return
    const first = [...node.querySelectorAll<HTMLElement>('[data-focusable]')].find((el) => isNavigable(el) && !isTextEntry(el))
    first?.focus({ preventScroll: true })
  })

  const remove = pushNavLayer({
    kind: options.kind ?? 'overlay',
    node: () => node,
    close: (reason) => options.onClose(reason),
    opener: self.opener,
    restore: options.returnFocus ?? 'auto',
    onClosing,
  })

  return {
    update(next: NavLayerOptions) {
      options = next
    },
    destroy() {
      destroyed = true
      if (focusFrame) cancelAnimationFrame(focusFrame)
      remove()
      mounted.delete(self)
    },
  }
}
