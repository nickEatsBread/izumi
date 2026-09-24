/**
 * Featured-banner slide scheduling: decode artwork off-DOM first, commit the slide second.
 *
 * Stepping straight to a slide whose artwork has not been decoded yet paints a skeleton, then pops
 * to the image a few frames later once the bitmap lands. On a desktop GPU that pop is a blink; on
 * the Steam Deck (a zoomed 1280×800 WebKitGTK page rasterised by an iGPU under Gamescope) it is a
 * visible flicker on every L1/R1 press and every auto-advance whose image is not already hot in the
 * memory cache — "random" only because it depends on what the cache still holds.
 *
 * The scheduler owns that ordering and nothing else: which artwork a slide needs, how it is
 * decoded and what a commit does are all supplied by the component, so this stays a pure module
 * that the Windows CI can test without a DOM.
 */
export interface SlideSchedulerOptions {
  /** Decode one artwork URL. Resolve `true` once its pixels are ready, `false` if it failed. */
  decode: (src: string) => Promise<boolean>
  /** Show slide `index`. `ready` is true only when every requested artwork decoded successfully. */
  commit: (index: number, direction: 1 | -1, ready: boolean) => void
  /** Never hold a step hostage to a slow network: after this long the slide swaps with its skeleton. */
  deadlineMs?: number
}

export interface SlideScheduler {
  /** Ask for `index` to become the visible slide once its `sources` are decoded (or the deadline hits). */
  request: (index: number, direction: 1 | -1, sources: string[]) => void
  /** Decode `sources` in the background so a later request for them commits immediately. */
  warm: (sources: string[]) => void
  /** Whether every one of `sources` has already decoded successfully. */
  ready: (sources: string[]) => boolean
  /** The slide index waiting on its artwork, or null when nothing is pending. */
  pending: () => number | null
  /** Drop a pending request (and its deadline) without committing it. */
  cancel: () => void
}

export function createSlideScheduler({ decode, commit, deadlineMs = 900 }: SlideSchedulerOptions): SlideScheduler {
  const decoded = new Set<string>()
  const failed = new Set<string>()
  const inflight = new Map<string, Promise<void>>()
  let pending: number | null = null
  let token = 0
  let deadline: ReturnType<typeof setTimeout> | undefined

  // One decode per URL, shared by warm-ups and requests. A failure is remembered so a broken
  // image never re-fetches on every rotation, and never blocks the commit again.
  function load(src: string): Promise<void> {
    if (!src || decoded.has(src) || failed.has(src)) return Promise.resolve()
    let job = inflight.get(src)
    if (!job) {
      job = decode(src)
        .then((ok) => { (ok ? decoded : failed).add(src) }, () => { failed.add(src) })
        .finally(() => { inflight.delete(src) })
      inflight.set(src, job)
    }
    return job
  }
  const settled = (sources: string[]) => sources.every((src) => !src || decoded.has(src) || failed.has(src))
  const ready = (sources: string[]) => sources.every((src) => !src || decoded.has(src))

  function cancel() {
    pending = null
    token += 1
    if (deadline !== undefined) clearTimeout(deadline)
    deadline = undefined
  }

  return {
    ready,
    pending: () => pending,
    cancel,
    warm(sources) {
      for (const src of sources) void load(src)
    },
    request(index, direction, sources) {
      cancel()
      if (settled(sources)) {
        commit(index, direction, ready(sources))
        return
      }
      pending = index
      const mine = token
      // Whichever finishes first — every decode, or the deadline — commits exactly once; the token
      // bump makes the later arrival a no-op, and a newer request supersedes both.
      const finish = () => {
        if (mine !== token) return
        cancel()
        commit(index, direction, ready(sources))
      }
      deadline = setTimeout(finish, deadlineMs)
      void Promise.all(sources.map(load)).then(finish)
    },
  }
}
