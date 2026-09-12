<script module lang="ts">
  /** Plays once per launch, not once per mount. The wizard lives inside the /app layout, so a
   *  navigation that re-creates it must not replay the ident; a module flag outlives the component
   *  and dies with the process, which is exactly the lifetime "once per launch" means. */
  let played = false
  export const introAlreadyPlayed = () => played
  export const markIntroPlayed = () => { played = true }
</script>

<script lang="ts">
  import { onMount } from 'svelte'
  import Wordmark from '$lib/components/Wordmark.svelte'
  import { onLaunchRevealed } from '$lib/util/launch-reveal'

  let { oncomplete }: { oncomplete: () => void } = $props()

  /** Reduced motion gets the destination without the journey: the lockup, held briefly, no drop and
   *  no rings. Both the OS preference and izumi's own motion setting are honoured. */
  const reduced = typeof window === 'undefined' ? false
    : document.documentElement.dataset.motion === 'reduced'
      || Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches)

  /** Kept in sync with the stylesheet below. The last frame of the fade decides when the wizard is
   *  reachable again, so the number lives next to the thing that owns the fade. */
  const RUNTIME = reduced ? 1250 : 2660
  const SKIP_FADE = 190

  let leaving = $state(false)
  /** Every animation below is paused until this flips. A Deck launch mounts this component while
   *  the window is still hidden and, under Gamescope, while the body is held invisible waiting for
   *  the native page zoom — so an ident started at mount plays its drop and its ripples to nobody
   *  and the viewer joins it somewhere in the middle. Starting on the first visible frame keeps the
   *  whole sequence on screen without making it a millisecond longer. */
  let armed = $state(false)
  let done = false

  function finish() {
    if (done) return
    done = true
    markIntroPlayed()
    oncomplete()
  }

  /** Any key, any click, any tap. An ident nobody can interrupt is an ident that gets resented on
   *  the second launch, and this one is deliberately the only thing on screen. Input that arrives
   *  before the first visible frame is NOT a skip: on the Deck that is the A press which launched
   *  izumi from Steam still working its way through, and it used to cancel an ident that had not
   *  yet shown a single frame. */
  function skip() {
    if (!armed || leaving || done) return
    leaving = true
    setTimeout(finish, SKIP_FADE)
  }

  onMount(() => {
    let timer: ReturnType<typeof setTimeout> | undefined
    const cancelReveal = onLaunchRevealed(() => {
      armed = true
      timer = setTimeout(finish, RUNTIME)
    })
    const onKey = (event: KeyboardEvent) => {
      if (event.repeat) return
      event.stopPropagation()
      skip()
    }
    window.addEventListener('keydown', onKey, true)
    window.addEventListener('pointerdown', skip, true)
    // A Deck controller never produces either of the above: its buttons arrive as native events the
    // app-wide translator routes, and it publishes this one while the ident is up.
    window.addEventListener('intro-dismiss', skip)
    return () => {
      cancelReveal()
      clearTimeout(timer)
      window.removeEventListener('keydown', onKey, true)
      window.removeEventListener('pointerdown', skip, true)
      window.removeEventListener('intro-dismiss', skip)
    }
  })
</script>

<div class="intro" class:reduced class:leaving class:armed data-intro>
  <div class="stage" aria-hidden="true">
    <div class="mark-slot">
      {#if !reduced}
        <span class="drop"></span>
        <span class="flash"></span>
        <span class="bloom"></span>
        <span class="ring ring-1"></span>
        <span class="ring ring-2"></span>
        <span class="ring ring-3"></span>
        <span class="ring crest"></span>
      {/if}
      <img class="mark" src="/brand/izumi-mark-color.svg" alt="" width="132" height="132" draggable="false" />
    </div>
    <div class="word"><Wordmark /></div>
  </div>
</div>

<style>
  .intro {
    --aqua: #5CEAD8;
    --sky: #1FA6F0;
    --indigo: #4E63F5;
    --night: #0E1524;
    position: fixed;
    inset: 0;
    z-index: 200;
    display: grid;
    place-items: center;
    overflow: hidden;
    contain: paint;
    background:
      radial-gradient(120% 90% at 50% 44%, #16233b 0%, var(--night) 55%, #070c16 100%);
    animation: intro-out 480ms cubic-bezier(.4, 0, .85, .3) 2160ms both;
  }
  .intro.reduced { animation: intro-out 300ms ease 950ms both; }
  /* Held at frame zero until the window is genuinely on screen. `both` fill means every layer
     already shows its own opening frame — the mark invisible, the drop still above the top edge —
     so the pause reads as the dark backdrop it is, not as a half-built lockup. */
  .intro:not(.armed), .intro:not(.armed) :global(*) { animation-play-state: paused; }
  /* A skip has to feel like a skip, so it overrides the scheduled exit rather than waiting for it. */
  .intro.leaving { animation: intro-cut 190ms ease both; }

  .stage { display: flex; flex-direction: column; align-items: center; gap: clamp(1.1rem, 2.6vmin, 2rem); animation: lockup-out 320ms cubic-bezier(.5, 0, .9, .4) 2100ms both; }
  .intro.reduced .stage, .intro.leaving .stage { animation: none; }

  /* Every splash layer is centred on the mark rather than on the screen, so the drop lands exactly
     where the whirlpool forms instead of a wordmark's height below it. */
  .mark-slot { position: relative; display: grid; place-items: center; width: clamp(128px, 24vmin, 256px); aspect-ratio: 1; }
  .mark-slot > span { position: absolute; left: 50%; top: 50%; border-radius: 50%; pointer-events: none; }

  .mark { width: 100%; height: auto; transform-origin: 50% 50%; animation: mark-curl 900ms cubic-bezier(.18, .9, .24, 1) 560ms both; }
  .intro.reduced .mark { animation: fade-in 260ms ease both; }

  .word { color: #F4F8FF; animation: word-rise 560ms cubic-bezier(.2, .7, .2, 1) 1180ms both; }
  .intro.reduced .word { animation: fade-in 260ms ease 80ms both; }
  .word :global(.izumi-wordmark) { width: clamp(10rem, 27vmin, 23rem); height: auto; aspect-ratio: 6.8 / 2; }

  /* The drop is the mark's own story: one source falling in. It elongates as it accelerates and
     flattens on contact, which is what sells the impact the rings then answer. */
  .drop { width: 13%; height: 17%; background: linear-gradient(160deg, var(--aqua), var(--sky) 55%, var(--indigo)); border-radius: 50% 50% 50% 50% / 62% 62% 38% 38%; box-shadow: 0 0 14px #1FA6F066; animation: drop-fall 520ms cubic-bezier(.5, .02, .86, .38) both; }

  .flash { width: 46%; height: 46%; background: radial-gradient(circle, #F4F8FF 0%, #9ce9ff88 40%, transparent 70%); animation: flash 300ms ease-out 400ms both; }
  .bloom { width: 260%; height: 260%; background: radial-gradient(circle, #1FA6F059 0%, #4E63F52e 45%, transparent 70%); animation: bloom 1300ms cubic-bezier(.15, .75, .3, 1) 400ms both; }

  .ring { width: 380%; height: 380%; border: 1.5px solid var(--sky); animation: ripple 1250ms cubic-bezier(.12, .7, .25, 1) both; }
  .ring-1 { border-color: var(--aqua); animation-delay: 400ms; }
  .ring-2 { border-color: var(--sky); animation-delay: 520ms; }
  .ring-3 { border-color: var(--indigo); animation-delay: 660ms; }
  /* The last wave is the wide slow one that carries the eye off the edge of the screen as the
     ident dissolves — the hand-off into the wizard, rather than a cut to it. */
  .crest { width: 620%; height: 620%; border-color: #5CEAD866; border-width: 3px; animation: crest 1500ms cubic-bezier(.1, .72, .22, 1) 830ms both; }

  @keyframes drop-fall {
    0% { transform: translate(-50%, calc(-50% - 46vh)) scale(.7, 1.5); opacity: 0; }
    12% { opacity: 1; }
    76% { transform: translate(-50%, -50%) scale(.94, 1.12); opacity: 1; }
    100% { transform: translate(-50%, -50%) scale(2.3, .16); opacity: 0; }
  }
  @keyframes flash { 0% { transform: translate(-50%, -50%) scale(.25); opacity: 0; } 25% { opacity: 1; } 100% { transform: translate(-50%, -50%) scale(2.4); opacity: 0; } }
  @keyframes bloom { 0% { transform: translate(-50%, -50%) scale(.2); opacity: 0; } 18% { opacity: 1; } 100% { transform: translate(-50%, -50%) scale(1.7); opacity: .18; } }
  @keyframes ripple { 0% { transform: translate(-50%, -50%) scale(.03); opacity: 0; } 10% { opacity: .85; } 100% { transform: translate(-50%, -50%) scale(2.6); opacity: 0; } }
  @keyframes crest { 0% { transform: translate(-50%, -50%) scale(.02); opacity: 0; } 14% { opacity: .7; } 100% { transform: translate(-50%, -50%) scale(2.4); opacity: 0; } }
  @keyframes mark-curl {
    0% { transform: rotate(-155deg) scale(.16); opacity: 0; }
    24% { opacity: 1; }
    100% { transform: rotate(0deg) scale(1); opacity: 1; }
  }
  @keyframes word-rise { from { transform: translateY(9px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }
  @keyframes lockup-out { from { transform: scale(1); opacity: 1; } to { transform: scale(1.12); opacity: 0; } }
  @keyframes intro-out { from { transform: scale(1); opacity: 1; } to { transform: scale(1.08); opacity: 0; } }
  @keyframes intro-cut { from { opacity: 1; } to { opacity: 0; } }
  @keyframes fade-in { from { opacity: 0; } to { opacity: 1; } }
</style>
