// When the debrid caching screen is worth showing.
//
// It is a full-screen takeover reporting download progress, so it should appear only when there is
// a download worth reporting. Three attempts got this wrong in turn:
//
//   * "the row was marked uncached" — most of that time is our own account lookups, not the service
//     fetching anything;
//   * "a wall-clock grace expired" — fires on any slow resolve whatever the cause;
//   * "the provider said not-ready twice" — the poll's opening probes are 250ms apart, so a torrent
//     that completed immediately still satisfied it.
//
// The real distinction is how much work is LEFT. A torrent already cached at the service still has
// to materialise on the account, and while it does the provider reports 'downloading' with progress
// climbing to 100 almost at once — that is not something the user needs a progress screen for. A
// genuine download is still nowhere near done after several seconds.

/** Probes reporting not-ready before the screen is even considered. */
export const PROBES_BEFORE_SCREEN = 2
/** A cached torrent should have materialised well inside this. */
export const MIN_WAIT_BEFORE_SCREEN_MS = 6000
/** Past this, it is finishing — showing a progress bar about to hit 100 is just a flash. */
export const NEARLY_DONE_PCT = 90

export interface CachingScreenInput {
  /** How many not-ready probes the provider has reported. */
  probes: number
  /** Milliseconds since the resolve began. */
  waitedMs: number
  /** Provider-reported completion, 0-100, or undefined when it does not say. */
  progress?: number
}

export function shouldShowCachingScreen({ probes, waitedMs, progress }: CachingScreenInput): boolean {
  if (probes < PROBES_BEFORE_SCREEN) return false
  if (waitedMs < MIN_WAIT_BEFORE_SCREEN_MS) return false
  // No progress reported at all is not evidence of being nearly done — several providers simply
  // omit it, and by this point the wait is real either way.
  return (progress ?? 0) < NEARLY_DONE_PCT
}
