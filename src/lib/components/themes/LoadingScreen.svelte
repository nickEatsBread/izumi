<script lang="ts">
  // API 8 loading screens (`loading.title`, `loading.episode`): the theme's display-only template over a
  // wait. The host mounts it while the theme has a screen for this moment; it shows while `loading`, then
  // `screen.exit` ms more with data-state="done" (and no pointer events) so a stylesheet can fade it out.
  // Every motion is the stylesheet's, in plain CSS; `--loading-elapsed` keeps it in step across the
  // opening screen → player cover hand-over (loading-clock.ts).
  import { onDestroy, untrack } from 'svelte'
  import ThemeNode from './ThemeNode.svelte'
  import { beginLoading, endLoading } from '$lib/themes/loading-clock'
  import type { DisplayModel, LoadingScreen } from '$lib/themes/presentation'

  let { screen, model, loading, episode = false, variant, class: className = '' }: {
    screen: LoadingScreen
    model: DisplayModel
    loading: boolean
    /** `loading.episode` (opening screen and player cover); otherwise `loading.title`. */
    episode?: boolean
    /** `series` or `catalog` for a title page; `opening` or `player` for an episode. */
    variant: string
    class?: string
  } = $props()

  const moment = untrack(() => (episode ? 'episode' : 'title'))
  let phase = $state<'off' | 'on' | 'done'>('off')
  let elapsed = $state('0ms')
  $effect(() => {
    const waiting = loading
    const exit = screen.exit ?? 0
    untrack(() => {
      if (waiting && phase !== 'on') { elapsed = beginLoading(moment); phase = 'on' }
      else if (!waiting && phase === 'on') { endLoading(moment); phase = exit ? 'done' : 'off' }
    })
    if (waiting || !exit) return
    const timer = setTimeout(() => { phase = 'off' }, exit)
    return () => clearTimeout(timer)
  })
  onDestroy(() => { if (phase === 'on') endLoading(moment) })
</script>

{#if phase !== 'off'}
  <div data-slot={episode ? 'loading.episode' : 'loading.title'} data-variant={variant} data-state={phase === 'done' ? 'done' : 'loading'}
       class="loading-screen {className}" class:pointer-events-none={phase === 'done'} style:--loading-elapsed={elapsed} aria-hidden="true">
    {#if screen.template}<ThemeNode node={screen.template} {model} eager />{/if}
  </div>
{/if}

<style>
  /* The template is the screen: its root fills it, so `overlay` artwork reaches every edge. */
  .loading-screen { display: grid; overflow: hidden; }
  .loading-screen > :global(.theme-template), .loading-screen > :global(.theme-template > *) { height: 100%; }
</style>
