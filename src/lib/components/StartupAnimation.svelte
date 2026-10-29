<script lang="ts">
  // A pack's startup animation: full screen over the booting app at launch (when `app.html` put up
  // its black cover), or on request right after a pack is set up. Any key, click, tap or controller
  // button skips it, and it never holds the app longer than STARTUP_MAX_MS.
  import { onMount, tick } from 'svelte'
  import { onLaunchRevealed } from '$lib/util/launch-reveal'
  import { onPadButton } from '$lib/nav/pad-events'
  import {
    STARTUP_COVER_CLASS,
    STARTUP_MAX_MS,
    STARTUP_PLAYED_KEY,
    startupAnimationPlaying,
    startupAnimationRequest,
    startupAnimationUrl,
  } from '$lib/startup/animation'

  let src = $state('')
  let leaving = $state(false)
  let video = $state<HTMLVideoElement>()
  let root = $state<HTMLElement>()
  let playing = false
  let cap: ReturnType<typeof setTimeout> | undefined
  /** The video `app.html` started before any app code loaded, taken over rather than started again. */
  let early: HTMLVideoElement | null = null
  let stopReveal: (() => void) | undefined

  function uncover() {
    document.documentElement.classList.remove(STARTUP_COVER_CLASS)
  }

  async function begin() {
    if (playing) return
    playing = true
    leaving = false
    try { sessionStorage.setItem(STARTUP_PLAYED_KEY, '1') } catch { /* private storage */ }
    early = document.getElementById('boot-intro') as HTMLVideoElement | null
    if (early) {
      startupAnimationPlaying.set(true)
      cap = setTimeout(finish, STARTUP_MAX_MS)
      early.addEventListener('ended', finish, { once: true })
      early.addEventListener('error', finish, { once: true })
      early.addEventListener('pointerdown', finish)
      // The black cover only hides the app until the video is up; the video is above everything.
      if (!early.paused && early.readyState > 2) uncover()
      else early.addEventListener('playing', uncover, { once: true })
      if (early.ended || early.error) finish()
      return
    }
    // Re-reads the info from Rust, so a cached copy that outlived the file paints no cover next time.
    const url = await startupAnimationUrl()
    if (!url) {
      playing = false
      uncover()
      return
    }
    // A video in the page keeps WebKit loading, and the window only appears once it has finished.
    if (document.visibilityState !== 'visible') {
      await new Promise<void>((resolve) => document.addEventListener('visibilitychange', function shown() {
        if (document.visibilityState !== 'visible') return
        document.removeEventListener('visibilitychange', shown)
        resolve()
      }))
    }
    src = url
    startupAnimationPlaying.set(true)
    cap = setTimeout(finish, STARTUP_MAX_MS)
    await tick()
    root?.focus({ preventScroll: true })
    // Under Gamescope the body stays hidden until the Deck zoom is applied; start on the first
    // frame the user can see so the opening isn't spent on a hidden surface.
    stopReveal = onLaunchRevealed(() => {
      void video?.play().catch(finish)
    })
  }

  // Faded from script and removed on its last frame: a CSS opacity transition blinks its element
  // back for a frame as it ends on WebKitGTK, and the video's dark last frame flashed over Home.
  const LEAVE_MS = 300
  function fadeOut(element: HTMLElement | null | undefined, done: () => void) {
    if (!element) return done()
    element.style.pointerEvents = 'none'
    const start = performance.now()
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / LEAVE_MS)
      element.style.opacity = String(1 - t * (2 - t))
      if (t < 1) requestAnimationFrame(step)
      else done()
    }
    requestAnimationFrame(step)
  }

  function finish() {
    if (!playing || leaving) return
    leaving = true
    clearTimeout(cap)
    stopReveal?.()
    uncover()
    const adopted = early
    fadeOut(adopted ?? root, () => {
      adopted?.remove()
      early = null
      src = ''
      leaving = false
      playing = false
      startupAnimationPlaying.set(false)
    })
  }

  function onKey(e: KeyboardEvent) {
    if (!playing) return
    e.preventDefault()
    e.stopImmediatePropagation()
    finish()
  }

  onMount(() => {
    if (document.documentElement.classList.contains(STARTUP_COVER_CLASS)) void begin()
    let first = true
    const stopRequests = startupAnimationRequest.subscribe(() => {
      if (first) { first = false; return }
      void begin()
    })
    const stopPad = onPadButton((input) => { if (input.pressed && playing) finish() })
    window.addEventListener('keydown', onKey, true)
    return () => {
      stopRequests()
      stopPad()
      window.removeEventListener('keydown', onKey, true)
      clearTimeout(cap)
      stopReveal?.()
      uncover()
    }
  })
</script>

{#if src}
  <div
    bind:this={root}
    class="startup-animation"
    class:leaving
    role="dialog"
    aria-modal="true"
    aria-label="Startup animation"
    data-nav-trap
    data-nav-escape
    data-startup-animation
    tabindex="-1"
    onpointerdown={finish}
  >
    <video
      bind:this={video}
      {src}
      muted
      playsinline
      preload="auto"
      onplaying={uncover}
      onended={finish}
      onerror={finish}
    ></video>
  </div>
{/if}

<style>
  .startup-animation {
    position: fixed;
    inset: 0;
    /* Above the on-screen keyboard (190), like the first-run intro ident. */
    z-index: 200;
    background: #000;
    outline: none;
  }
  video {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
</style>
