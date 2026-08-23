/**
 * Shared viewport gate for catalogue/list rows.
 *
 * CSS zoom on the document makes IntersectionObserver unreliable in the WebViews we ship, so the
 * rows still need a getBoundingClientRect check. Keeping that check here means the whole page owns
 * one passive scroll listener, one resize listener and one ResizeObserver instead of every row
 * installing its own copies.
 */
export interface NearViewportOptions {
  onEnter: () => void
  /** How far ahead to activate, in viewport heights. Matches the old per-row default. */
  marginViewports?: number
  /** Recheck when siblings collapse and change the row's position without a scroll event. */
  observeParent?: boolean
}

interface Entry {
  node: HTMLElement
  options: NearViewportOptions
  parent?: Element
}

const entries = new Set<Entry>()
const observedParents = new Map<Element, number>()
let resizeObserver: ResizeObserver | undefined
let frame = 0
let listening = false

export function isNearViewport(top: number, viewportHeight: number, marginViewports = 1.5): boolean {
  return Number.isFinite(top)
    && top < Math.max(1, viewportHeight) * Math.max(0, marginViewports)
}

function viewportHeight(): number {
  return Math.max(window.innerHeight || 0, document.documentElement.clientHeight || 0, 1)
}

function stopListening(): void {
  if (!listening || entries.size) return
  listening = false
  window.removeEventListener('scroll', schedule)
  window.removeEventListener('resize', schedule)
  if (frame) cancelAnimationFrame(frame)
  frame = 0
  resizeObserver?.disconnect()
  resizeObserver = undefined
  observedParents.clear()
}

function unobserveParent(parent?: Element): void {
  if (!parent) return
  const count = observedParents.get(parent) ?? 0
  if (count <= 1) {
    observedParents.delete(parent)
    resizeObserver?.unobserve(parent)
  } else {
    observedParents.set(parent, count - 1)
  }
}

function remove(entry: Entry): void {
  if (!entries.delete(entry)) return
  unobserveParent(entry.parent)
  stopListening()
}

function check(): void {
  frame = 0
  const height = viewportHeight()
  for (const entry of [...entries]) {
    if (!entry.node.isConnected) {
      remove(entry)
      continue
    }
    if (!isNearViewport(
      entry.node.getBoundingClientRect().top,
      height,
      entry.options.marginViewports,
    )) continue
    // Remove first: onEnter commonly changes layout synchronously and can trigger the shared RO.
    remove(entry)
    entry.options.onEnter()
  }
}

function schedule(): void {
  if (!entries.size || frame) return
  frame = requestAnimationFrame(check)
}

function startListening(): void {
  if (listening) return
  listening = true
  window.addEventListener('scroll', schedule, { passive: true })
  window.addEventListener('resize', schedule)
}

function observeParent(entry: Entry): void {
  if (entry.options.observeParent === false || !entry.node.parentElement) return
  const parent = entry.node.parentElement
  entry.parent = parent
  if (!resizeObserver) resizeObserver = new ResizeObserver(schedule)
  const count = observedParents.get(parent) ?? 0
  if (count === 0) resizeObserver.observe(parent)
  observedParents.set(parent, count + 1)
}

/** Svelte action. The gate is one-shot: after activation the entry owns no global resources. */
export function nearViewport(node: HTMLElement, options: NearViewportOptions) {
  const entry: Entry = { node, options }
  entries.add(entry)
  observeParent(entry)
  startListening()
  schedule()
  return {
    update(next: NearViewportOptions) { entry.options = next; schedule() },
    destroy() { remove(entry) },
  }
}
