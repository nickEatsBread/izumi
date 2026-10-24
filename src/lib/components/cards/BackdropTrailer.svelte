<script lang="ts">
  // The API 6 backdrop trailer: after `dwell` ms, the title's YouTube trailer plays once, muted, over the
  // artwork (fading in and out over 500 ms), then the artwork returns. It loads and starts hidden a second into the
  // dwell (`PRELOAD_MS`): YouTube draws its own play/pause button for the first ~4 s of playback, which
  // YoutubeTrailer waits out, so that wait runs alongside the dwell instead of after it (the opening
  // seconds of the trailer play unseen). Desktop only; never under reduced
  // motion, data saver, the player, a hidden window or the Theme trailers setting off. `onended(natural)`
  // fires once for a trailer that started playing: natural = it reached its end. A trailer that has not shown 15 s after its dwell
  // counts as failed. Its mute state is the backdrop one, so hover previews never unmute it. It holds
  // while the full trailer dialog or a hover-preview trailer is up, so two videos never play at once.
  import { untrack } from 'svelte'
  import YoutubeTrailer from './YoutubeTrailer.svelte'
  import { backdropTrailerOn } from './backdrop-trailer'
  import { isAndroid, isMobile, isTv } from '$lib/platform'
  import { gameMode, playing as playerUp } from '$lib/player/session'
  import { backdropTrailers, motionPreference } from '$lib/settings/ui'
  import { windowMinimized } from '$lib/stores/window-state'
  import { backdropTrailerMuted, hoverTrailers, trailerPopup } from '$lib/stores/trailer'

  let { id, title = 'Trailer', enabled, dwell, part, mutePart, muteClass = 'bottom-4 right-4 z-30', held = false, onplaying, onended }: {
    id?: string; title?: string; enabled: boolean; dwell: number; part: string; mutePart: string; muteClass?: string; held?: boolean
    onplaying?: () => void; onended?: (natural: boolean) => void
  } = $props()

  let pageHidden = $state(typeof document !== 'undefined' && document.hidden)
  // Every host plays it in a header at the top of its page: past 100 px down, it stops.
  const scrolledAway = () => typeof window !== 'undefined' && window.scrollY > 100
  let scrolled = $state(scrolledAway())
  const saveData = typeof navigator !== 'undefined' && (navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData === true
  const on = $derived(backdropTrailerOn({
    enabled, id, setting: $backdropTrailers, desktop: !$isMobile && !$isAndroid && !$isTv && !$gameMode,
    // The same rule as reducedMotion() in gm-motion.ts, written against the store so it stays reactive.
    reducedMotion: $motionPreference === 'reduce' || ($motionPreference !== 'full' && typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches),
    saveData, playerUp: $playerUp, pageHidden: pageHidden || $windowMinimized, held: held || scrolled || $trailerPopup !== null || $hoverTrailers > 0,
  }))

  // Template state, only ever written by the code below (no effect reads it).
  let mounted = $state(false)
  let waiting = $state(true) // the dwell is still running: the trailer may load, not show
  let playing = $state(false)
  // Bookkeeping, plain so callbacks and teardowns read it without tracking.
  let started = false // YouTube reported playing and onended has not fired yet
  const finished = new Set<string>() // ended or failed: not replayed while this component lives
  const PRELOAD_MS = 1000
  let fadeTimer: ReturnType<typeof setTimeout> | undefined
  let startTimer: ReturnType<typeof setTimeout> | undefined

  // The gate. Whenever `on` (or the title) changes, the teardown takes the trailer away and the next
  // run restarts the full dwell. The teardown also runs when this component is destroyed. A new dwell
  // only applies from the next run: changing it never stops a playing trailer.
  $effect(() => {
    if (!on || !id || finished.has(id)) return
    waiting = true
    // Creating the YouTube player stalls the page for a few hundred ms, so it waits out the host's own
    // change (a hero slide's 650 ms cross-fade) instead of freezing it.
    const preloadTimer = setTimeout(() => (mounted = true), Math.min(PRELOAD_MS, untrack(() => dwell)))
    const dwellTimer = setTimeout(() => {
      waiting = false
      startTimer = setTimeout(() => onEnd(false), 15_000)
    }, untrack(() => dwell))
    return () => {
      clearTimeout(preloadTimer)
      clearTimeout(dwellTimer)
      stop()
    }
  })

  /** Taken away before its end (gate closed, title changed, destroyed): back to idle, report once. */
  function stop() {
    clearTimeout(fadeTimer)
    clearTimeout(startTimer)
    mounted = false
    playing = false
    if (started) {
      started = false
      onended?.(false)
    }
  }
  function onStart() {
    if (started || !id || finished.has(id)) return
    clearTimeout(startTimer)
    started = true
    playing = true
    onplaying?.()
  }
  /** From YoutubeTrailer (natural end, its iframe already fading out, or a failure) or the start watchdog. */
  function onEnd(natural: boolean) {
    if (id) finished.add(id)
    clearTimeout(startTimer)
    playing = false
    if (started) {
      started = false
      onended?.(natural)
    }
    clearTimeout(fadeTimer)
    if (natural) fadeTimer = setTimeout(() => (mounted = false), 500)
    else mounted = false
  }
</script>

<svelte:document onvisibilitychange={() => (pageHidden = document.hidden)} />
<svelte:window onscroll={() => (scrolled = scrolledAway())} />

{#if id && mounted}
  <div data-part={part} data-state={playing ? 'playing' : undefined} class="pointer-events-none absolute inset-0 overflow-hidden">
    <YoutubeTrailer {id} {title} loop={false} fit="cover" {mutePart} {muteClass} trailerMuted={backdropTrailerMuted} wait={waiting} onplaying={onStart} onended={onEnd} />
  </div>
{/if}
