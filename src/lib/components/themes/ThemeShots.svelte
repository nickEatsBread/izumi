<script lang="ts">
  import { untrack } from 'svelte'
  import Palette from '@lucide/svelte/icons/palette'
  import { motion, reducedMotion } from '$lib/motion/gm-motion'
  import { SCREEN_LABELS, type ThemeScreenshot } from '$lib/themes/packages'

  let { shots, name, playing = false, index = $bindable(0), phone = false, chrome = true, strip = false }: {
    shots: ThemeScreenshot[]
    name: string
    /** Fade through the screens on a timer: hovered or focused cards and the featured banner. */
    playing?: boolean
    index?: number
    /** Phone screenshots are letterboxed instead of cropped. */
    phone?: boolean
    /** The screen-name chip and dots, shown while the screens are cycling. */
    chrome?: boolean
    /** Phone screens side by side, store style, instead of one at a time. */
    strip?: boolean
  } = $props()

  const current = $derived(shots[index] ?? shots[0])
  // The timer only lands on screens whose image already decoded, so a fade never shows a blank: it
  // waits on one still loading and skips one that failed.
  let ready = $state<Record<string, 'loading' | 'ready' | 'failed'>>({})
  function preload() {
    for (const shot of shots.slice(1)) {
      if (shot.url in ready) continue
      ready[shot.url] = 'loading'
      const image = new Image()
      image.referrerPolicy = 'no-referrer'
      image.src = shot.url
      image.decode().then(() => { ready[shot.url] = 'ready' }, () => { ready[shot.url] = 'failed' })
    }
  }
  function advance() {
    for (let step = 1; step < shots.length; step++) {
      const next = (index + step) % shots.length
      const state = next === 0 ? 'ready' : ready[shots[next].url]
      if (state === 'loading') return
      if (state === 'ready') { index = next; return }
    }
  }
  $effect(() => {
    if (!playing || strip || shots.length < 2 || reducedMotion()) return
    untrack(preload)
    const timer = setInterval(advance, 1600)
    return () => { clearInterval(timer); index = 0 }
  })
</script>

<div class="theme-shots" class:phone data-theme-shots>
  {#if strip && shots.length}
    <div class="strip">{#each shots.slice(0, 3) as shot (shot.url)}<img src={shot.url} alt={`${name}: ${SCREEN_LABELS[shot.screen]}`} loading="lazy" referrerpolicy="no-referrer" decoding="async" />{/each}</div>
  {:else if current}
    {#key current.url}
      <!-- The outgoing image stays opaque under the incoming one, so the fade never dips to the background. -->
      <img src={current.url} alt={`${name}: ${SCREEN_LABELS[current.screen]}`} referrerpolicy="no-referrer" decoding="async"
        in:motion={{ opacity: [0, 1], duration: 500 }} out:motion={{ duration: 500 }} />
    {/key}
    {#if chrome && playing && shots.length > 1}
      <span class="chip">{SCREEN_LABELS[current.screen]}</span>
      <span class="dots" aria-hidden="true">{#each shots as shot (shot.url)}<i class:on={shot === current}></i>{/each}</span>
    {/if}
  {:else}
    <Palette size={42} strokeWidth={1} aria-hidden="true" />
  {/if}
</div>

<style>
  .theme-shots { position: relative; aspect-ratio: 16 / 10; overflow: hidden; display: grid; place-items: center; border-radius: inherit; background: hsl(var(--muted)); color: hsl(var(--muted-foreground)); }
  img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
  .phone img { object-fit: contain; }
  .strip { position: absolute; inset: 0; display: flex; justify-content: center; gap: 4%; padding: 5% 4%; }
  .strip img { position: static; width: auto; height: 100%; max-width: 30%; object-fit: cover; border-radius: 6px; box-shadow: 0 6px 18px hsl(0 0% 0% / .35); }
  .chip { position: absolute; left: 10px; bottom: 10px; z-index: 2; padding: 3px 9px; border-radius: 999px; background: #000a; color: #fff; font-size: 11px; font-weight: 700; }
  .dots { position: absolute; right: 10px; bottom: 14px; z-index: 2; display: flex; gap: 4px; }
  .dots i { width: 5px; height: 5px; border-radius: 999px; background: #fff7; }
  .dots i.on { width: 14px; background: #fff; }
</style>
