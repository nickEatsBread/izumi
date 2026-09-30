import { derived, writable, type Readable, type Writable } from 'svelte/store'
import type { FocusDescriptor } from './focus-memory'

// One stack for everything that opens over a page and closes on Back: dropdowns, sheets, the select
// chooser, the PIN keypad (spec §3.3). The d-pad trap resolver (traps.ts), the controller's B
// (gamepad.ts), the shared Escape capture below and the app layout's popstate guard all ask it for
// the top layer, so one press closes one layer and nothing underneath. Leaf module: svelte/store
// and type-only imports.

export type NavLayerCloseReason = 'back' | 'preempted' | 'navigate'
export type NavLayerRestore = 'auto' | 'always' | 'none'

export interface NavLayer {
  /** 'select-menu' | 'multi-select' | 'native-picker' | 'household-pin' | 'overlay' | … */
  kind: string
  node: () => HTMLElement | null
  /** Return false to veto (busy). */
  close(reason: NavLayerCloseReason): void | false
  opener?: FocusDescriptor | null
  restore: NavLayerRestore
  /** Called when the entry becomes closing: `inert` seen on its node or an ancestor (a Svelte outro
   *  started) or the remover ran. Once per closing; an entry re-activated by a reversed outro can
   *  fire it again when it really closes. */
  onClosing?: () => void
}

export interface NavLayerEntry extends NavLayer { readonly id: number; closing: boolean }

let stack: NavLayerEntry[] = []
let serial = 0
let nextId = 1
let observer: MutationObserver | null = null
let escapeInstalled = false
const liveCount = writable(0)

/** performance.now() of the last accepted close or removal. PlayerOverlay ignores A/B for 500 ms
 *  after it, so the press that closed a layer never also pauses, skips or leaves the player. */
export const navLayerDismissedAt: Writable<number> = writable(-1e9)
/** True while at least one layer is open and not closing. */
export const navLayerOpen: Readable<boolean> = derived(liveCount, (count) => count > 0)

const stamp = () => navLayerDismissedAt.set(performance.now())
const refreshOpen = () => liveCount.set(stack.filter((entry) => !entry.closing).length)

function markClosing(entry: NavLayerEntry): void {
  if (entry.closing) return
  entry.closing = true
  stamp()
  refreshOpen()
  entry.onClosing?.()
}

function requestClose(entry: NavLayerEntry, reason: NavLayerCloseReason): void {
  if (entry.close(reason) !== false) stamp()
}

// Svelte sets `inert` on an outroing node at once but destroys it only after the outro, so a quick
// second press would otherwise land on a fading layer. Its entry is closing from the first frame.
function onInertChange(): void {
  for (const entry of [...stack]) {
    const node = entry.node()
    if (node?.closest('[inert]')) markClosing(entry)
    else if (entry.closing && node?.isConnected) {
      entry.closing = false
      refreshOpen()
    }
  }
}

// Window capture runs before every element, document and window-bubble handler, so a keyboard
// Escape, the TV activity's Escape and the phone bridge all close exactly the top layer.
function onEscapeCapture(event: KeyboardEvent): void {
  if (event.key !== 'Escape' || event.defaultPrevented) return
  const top = topNavLayer()
  const node = top?.node()
  if (!top || !node) return
  // Focus in a trap that no layer contains or sits in (the keyboard's keys): not ours to close.
  const focusTrap = document.activeElement?.closest('[data-nav-trap]')
  if (focusTrap && !stack.some((entry) => {
    const layerNode = entry.node()
    return !!layerNode && (layerNode.contains(focusTrap) || focusTrap.contains(layerNode))
  })) return
  event.preventDefault()
  event.stopImmediatePropagation()
  requestClose(top, 'back')
}

function syncWatchers(): void {
  if (typeof window === 'undefined') return
  const active = stack.length > 0
  if (active && !escapeInstalled) {
    window.addEventListener('keydown', onEscapeCapture, { capture: true })
    escapeInstalled = true
  } else if (!active && escapeInstalled) {
    window.removeEventListener('keydown', onEscapeCapture, { capture: true })
    escapeInstalled = false
  }
  if (active && !observer && typeof MutationObserver !== 'undefined') {
    observer = new MutationObserver(onInertChange)
    observer.observe(document.documentElement, { subtree: true, attributes: true, attributeFilter: ['inert'] })
  } else if (!active && observer) {
    observer.disconnect()
    observer = null
  }
}

/** Push; returns an idempotent remover. Removing a still-present entry fires onClosing (if it has
 *  not fired) and stamps navLayerDismissedAt. */
export function pushNavLayer(layer: NavLayer): () => void {
  const entry: NavLayerEntry = { ...layer, id: nextId++, closing: false }
  stack.push(entry)
  serial += 1
  refreshOpen()
  syncWatchers()
  let removed = false
  return () => {
    if (removed) return
    removed = true
    const index = stack.indexOf(entry)
    if (index < 0) return
    markClosing(entry)
    stack.splice(index, 1)
    stamp()
    refreshOpen()
    syncWatchers()
  }
}

/** Last entry whose node is connected, inside `scope` (default document), visible, not closing and
 *  not inside [inert]. A pure read: leaked entries are skipped, never pruned. */
export function topNavLayer(scope?: Node): NavLayerEntry | null {
  const root = scope ?? (typeof document === 'undefined' ? null : document)
  if (!root) return null
  for (let index = stack.length - 1; index >= 0; index -= 1) {
    const entry = stack[index]
    if (entry.closing) continue
    const node = entry.node()
    if (!node || !node.isConnected || !root.contains(node)) continue
    if (!(node.checkVisibility?.() ?? true)) continue
    if (node.closest('[inert]')) continue
    return entry
  }
  return null
}

/** No top layer → false. Otherwise asks it to close and returns true (a veto still consumed it). */
export function closeTopNavLayer(reason: NavLayerCloseReason = 'back'): boolean {
  const top = topNavLayer()
  if (!top) return false
  requestClose(top, reason)
  return true
}

/** close(reason) on every entry that is not already closing, top first; a veto keeps its entry. */
export function closeAllNavLayers(reason: NavLayerCloseReason): void {
  for (const entry of [...stack].reverse()) {
    if (!entry.closing) requestClose(entry, reason)
  }
}

/** Monotonic push counter: a focus return skips when it changed since the close (a hand-off). */
export function navLayerSerial(): number {
  return serial
}

export function resetNavLayersForTests(): void {
  stack = []
  serial = 0
  nextId = 1
  liveCount.set(0)
  navLayerDismissedAt.set(-1e9)
  syncWatchers()
}

import.meta.hot?.dispose(() => resetNavLayersForTests())
