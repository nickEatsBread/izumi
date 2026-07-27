<script lang="ts">
  // The screen between "you picked a source" and "video is playing".
  //
  // That gap used to be dead: the picker greyed its own rows out and nothing else happened until
  // either the player appeared or, after a grace period, the debrid caching screen did. On a slow
  // resolve it read as a freeze.
  //
  // Layout is title → animation → status → release, over a blurred still of the show's own
  // artwork. izumi has no clear-art logo layer, so the title renders as text, which is the same
  // fallback the shape is borrowed from.
  import { onDestroy } from 'svelte'
  import lottie, { type AnimationItem } from 'lottie-web'
  import animationData from './source-loader.json'

  let { title = '', caption = 'Connecting', detail = '', onCancel }: {
    title?: string
    caption?: string
    detail?: string
    onCancel?: () => void
  } = $props()

  let host = $state<HTMLDivElement | null>(null)
  let anim: AnimationItem | undefined

  // The OS asking for less motion is not a request for a static lottie — it is a request for the
  // animation not to run. It still renders one frame, so the screen keeps its shape and its text.
  const reduced = typeof window !== 'undefined'
    && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

  $effect(() => {
    if (!host || anim) return
    anim = lottie.loadAnimation({
      container: host,
      renderer: 'svg',
      loop: !reduced,
      autoplay: !reduced,
      animationData: structuredClone(animationData),
      rendererSettings: { preserveAspectRatio: 'xMidYMid meet', progressiveLoad: false },
    })
    if (reduced) anim.goToAndStop(0, true)
  })

  onDestroy(() => anim?.destroy())
</script>

<div class="flex w-full max-w-xl flex-col items-center gap-6 px-6 text-center">
  {#if title}
    <h1 class="text-3xl font-black leading-tight tracking-tight text-white drop-shadow-[0_10px_30px_rgba(0,0,0,0.6)] sm:text-4xl">
      {title}
    </h1>
  {/if}

  <div bind:this={host} class="h-28 w-52" aria-hidden="true"></div>

  <div class="space-y-2">
    <p class="text-xs font-bold uppercase tracking-[0.36em] text-white drop-shadow-[0_2px_10px_rgba(0,0,0,0.9)]">{caption}</p>
    {#if detail}
      <p class="max-w-md truncate text-sm text-white/75" {title}>{detail}</p>
    {/if}
  </div>

  {#if onCancel}
    <button
      data-focusable
      onclick={onCancel}
      class="rounded-full border border-white/20 bg-black/40 px-5 py-2 text-xs font-semibold text-white/85 transition-colors hover:bg-black/60 hover:text-white"
    >Cancel</button>
  {/if}
</div>
