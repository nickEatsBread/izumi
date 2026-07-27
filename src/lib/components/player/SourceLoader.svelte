<script lang="ts">
  // The screen between "you picked a source" and "video is playing".
  //
  // That gap used to be dead: the picker greyed its own rows out and nothing else happened until
  // either the player appeared or, after a grace period, the debrid caching screen did. On a slow
  // resolve it read as a freeze.
  //
  // Lanterns drifting on water, each carrying one of YOUR configured addons — so the wait shows
  // what is actually being asked, not a generic spinner. The cargo slots are <image> nodes in the
  // Lottie output; their href is swapped for real addon icons at runtime.
  import { onDestroy, onMount } from 'svelte'
  import lottie, { type AnimationItem } from 'lottie-web'
  import { iconSrc } from '$lib/stremio/addon-logo'
  import animationData from './source-loader.json'

  let { logos = [], caption = 'Finding your source', detail = '', onCancel }: {
    logos?: string[]
    caption?: string
    detail?: string
    onCancel?: () => void
  } = $props()

  let host = $state<HTMLDivElement | null>(null)
  let anim: AnimationItem | undefined

  // The OS asking for less motion is not a request for a static lottie — it is a request for the
  // animation not to run at all. The lanterns still render (one frame), so the screen keeps its
  // shape and the caption still explains itself.
  const reduced = typeof window !== 'undefined'
    && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

  /** The animation with the user's addon icons substituted into its cargo assets.
   *
   *  Done at the DATA layer, not by rewriting <image> hrefs after render: lottie emits more
   *  <image> nodes than there are cargo layers (each asset also appears in defs), so walking the
   *  rendered nodes by index silently assigns icons to the wrong lanterns. Substituting the asset
   *  each layer already references cannot mismatch. */
  function withCargo(icons: string[]) {
    const data = structuredClone(animationData) as typeof animationData & {
      assets: { id: string; p: string; u?: string }[]
    }
    if (icons.length) {
      data.assets.forEach((asset, i) => {
        const src = icons[i % icons.length]
        const usable = iconSrc(src)
        if (usable) { asset.p = usable; asset.u = '' }
      })
    }
    return data
  }

  function mount(icons: string[]) {
    if (!host) return
    anim?.destroy()
    host.replaceChildren()
    anim = lottie.loadAnimation({
      container: host,
      renderer: 'svg',
      loop: !reduced,
      autoplay: !reduced,
      animationData: withCargo(icons),
      rendererSettings: { preserveAspectRatio: 'xMidYMid meet', progressiveLoad: false },
    })
    if (reduced) anim.goToAndStop(60, true)
  }

  // Addons can land after the first paint, so remount when the SET changes — but only then, or an
  // unrelated re-render would restart the drift mid-loop.
  let mountedKey = ''
  $effect(() => {
    const key = logos.join('|')
    if (!host || key === mountedKey) return
    mountedKey = key
    mount(logos)
  })

  onMount(() => () => anim?.destroy())
  onDestroy(() => anim?.destroy())
</script>

<div class="flex flex-col items-center gap-5 px-6 text-center">
  <div bind:this={host} class="h-[200px] w-[360px] max-w-full" aria-hidden="true"></div>

  <div class="space-y-1.5">
    <p class="text-sm font-bold tracking-wide text-white/90">{caption}</p>
    {#if detail}
      <p class="text-xs text-white/55">{detail}</p>
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
