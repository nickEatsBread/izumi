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
    syncStartupAnimationInfo,
  } from '$lib/startup/animation'

  let src = $state('')
  let leaving = $state(false)
  let video = $state<HTMLVideoElement>()
  let root = $state<HTMLElement>()
  let playing = false
  let cap: ReturnType<typeof setTimeout> | undefined
  let stopReveal: (() => void) | undefined

  function uncover() {
    document.documentElement.classList.remove(STARTUP_COVER_CLASS)
  }

  async function begin() {
    if (playing) return
    playing = true
    leaving = false
    try { sessionStorage.setItem(STARTUP_PLAYED_KEY, '1') } catch { /* private storage */ }
    const url = await startupAnimationUrl()
    if (!url) {
      // The cached info outlived the file: forget it so the next launch paints no cover.
      void syncStartupAnimationInfo()
      playing = false
      uncover()
      return
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

  function finish() {
    if (!playing || leaving) return
    leaving = true
    clearTimeout(cap)
    stopReveal?.()
    uncover()
    const done = src
    setTimeout(() => {
      src = ''
      leaving = false
      playing = false
      startupAnimationPlaying.set(false)
      if (done) URL.revokeObjectURL(done)
    }, 320)
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
      if (src) URL.revokeObjectURL(src)
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
    z-index: 2147483600;
    background: #000;
    outline: none;
    opacity: 1;
    transition: opacity 0.3s ease;
  }
  .startup-animation.leaving {
    opacity: 0;
    pointer-events: none;
  }
  video {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
</style>
