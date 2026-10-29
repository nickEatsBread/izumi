import { get } from 'svelte/store'
import { playing } from '$lib/player/session'
import { idle } from './idle'

// WebKitGTK decodes an image the first time it paints, and on the Deck that decode holds the frame:
// a row's posters reached for the first time froze Home for 60-120 ms on each Down, while a second
// walk over the same rows was smooth. Home decodes the posters of the rows just below the screen
// ahead, while nothing moves, one image a slice, and keeps the decoded images referenced so the
// memory cache keeps their bitmaps for the cards' own <img> (the banner does the same, Hero.svelte).

/** Gap between two decodes: one image a slice leaves the frames around it alone. */
const SLICE_MS = 50
/** How long to wait before looking again while the page scrolls, the banner moves or a video plays. */
const BUSY_MS = 400

export function createImageWarmer<T>({ load, decode, busy, later = (fn) => idle(fn, SLICE_MS).cancel, limit = 48 }: {
  /** Starts the fetch at once (the network runs in parallel; only the decodes are spaced out). */
  load: (url: string) => T
  /** Resolves true once decoded; false or a rejection drops the image. */
  decode: (item: T) => Promise<boolean>
  busy: () => boolean
  /** Runs one slice later; returns its cancel. */
  later?: (fn: () => void) => () => void
  /** The decoded images held at most, least recently wanted dropped first. */
  limit?: number
}) {
  const held = new Map<string, T>()
  let queue: [string, T][] = []
  let cancel: (() => void) | undefined
  let decoding: string | undefined
  const next = (wait = false) => {
    if (cancel || decoding || !queue.length) return
    if (!wait) { cancel = later(run); return }
    const timer = setTimeout(run, BUSY_MS)
    cancel = () => clearTimeout(timer)
  }
  const run = () => {
    cancel = undefined
    if (!queue.length) return
    if (busy()) return next(true)
    const [url, item] = queue.shift()!
    decoding = url
    void decode(item).then((ok) => {
      if (!ok) return
      held.delete(url)
      held.set(url, item)
      if (held.size > limit) held.delete(held.keys().next().value!)
    }, () => {}).finally(() => { decoding = undefined; next() })
  }
  return {
    held,
    /** Replaces what is waiting with `urls`, nearest first. Those already decoded become the newest. */
    warm(urls: string[]) {
      const queued = new Map(queue)
      queue = []
      for (const url of new Set(urls)) {
        const kept = held.get(url)
        if (kept !== undefined) { held.delete(url); held.set(url, kept) }
        else if (url && url !== decoding) queue.push([url, queued.get(url) ?? load(url)])
      }
      // A settle starts at once rather than after a wait left over from the scroll.
      cancel?.()
      cancel = undefined
      next()
    },
    stop() { queue = []; cancel?.(); cancel = undefined },
  }
}

/** Rows below the screen whose first cards are decoded ahead: the one the screen cuts and two more. */
const ROWS_AHEAD = 3
const ROW_CARDS = 8
/** A scroll counts as over once no scroll event has come for this long (a d-pad step eases ~450 ms). */
const SETTLE_MS = 200
const DECODE_TIMEOUT_MS = 4000
let scrolledAt = -Infinity

// The banner's slide change: its outgoing slide stays drawn beside the incoming one until it ends.
function bannerMoving(): boolean {
  const hero = document.querySelector('[data-slot="home.hero"]')
  return !!hero && (!!hero.querySelector('.hero-fade-out, [data-state="leaving"]') || hero.querySelectorAll('.hero-slide-in').length > 1)
}

const homeWarmer = createImageWarmer<HTMLImageElement>({
  load(url) {
    const img = new Image()
    img.decoding = 'async'
    img.src = url
    return img
  },
  // A fetch that hangs must not hold up the rest of the rows.
  decode: (img) => Promise.race([img.decode().then(() => true), new Promise<boolean>((resolve) => setTimeout(resolve, DECODE_TIMEOUT_MS, false))]),
  busy: () => homeBusy(),
})

/** Whether Home is moving (a scroll eased in the last `quietMs`, the banner changing slide), playing
 *  a video or out of sight: no moment for work that holds the page for a frame. */
export function homeBusy(quietMs = SETTLE_MS): boolean {
  return get(playing) || document.hidden || performance.now() - scrolledAt < quietMs || bannerMoving()
}

/** Svelte action for a Home's root. Each time the page settles (a scroll ends, rows arrive), the
 *  posters of the rows just below the screen are decoded ahead. A built row gives the exact `src`
 *  its cards render; a row still waiting to be built (`data-pending-row="<id>"`) asks `covers`. */
export function warmRowsBelow(node: HTMLElement, covers: (id: string) => string[]) {
  let settle: ReturnType<typeof setTimeout> | undefined
  const warm = () => {
    const height = window.innerHeight
    const rows = [...node.querySelectorAll<HTMLElement>('[data-slot="row"], [data-pending-row]')]
      .map((row) => ({ row, box: row.getBoundingClientRect() }))
      .filter(({ box }) => box.bottom > height)
      .sort((a, b) => a.box.top - b.box.top)
      .slice(0, ROWS_AHEAD)
    homeWarmer.warm(rows.flatMap(({ row }) => {
      const pending = row.dataset.pendingRow
      return (pending !== undefined ? covers(pending) : [...row.querySelectorAll('img')].map((img) => img.getAttribute('src') ?? '')).slice(0, ROW_CARDS)
    }))
  }
  const soon = () => { clearTimeout(settle); settle = setTimeout(warm, SETTLE_MS) }
  // Capture also hears a row's own sideways scroll; passive keeps it off the scroll's path.
  const scrolled = () => { scrolledAt = performance.now(); soon() }
  const resize = new ResizeObserver(soon)
  resize.observe(node)
  window.addEventListener('scroll', scrolled, { capture: true, passive: true })
  return {
    update(next: (id: string) => string[]) { covers = next },
    destroy() {
      clearTimeout(settle)
      resize.disconnect()
      window.removeEventListener('scroll', scrolled, { capture: true })
      homeWarmer.stop()
    },
  }
}
