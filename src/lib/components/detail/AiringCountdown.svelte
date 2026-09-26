<script lang="ts">
  import { onMount } from 'svelte'
  import type { Media } from '$lib/anilist/types'
  import { compactCountdown, longCountdown } from '$lib/themes/countdown'

  // "Episode 12 in 2d 21h" or "Episode 12 will be released in 4 days 19 hrs 43 mins", ticking each minute.
  let {
    media,
    variant,
    className = 'mt-3',
  }: {
    media: Media
    variant: 'compact' | 'long'
    /** Desktop siblings space with a trailing `mb-3` rather than this component's own leading
     * `mt-3` — see FactList's `className` for why. */
    className?: string
  } = $props()
  let now = $state(Date.now())
  onMount(() => {
    const timer = setInterval(() => (now = Date.now()), 60_000)
    return () => clearInterval(timer)
  })
  const next = $derived(media.nextAiringEpisode)
  // `airingAt` is absolute; older records only carry `timeUntilAiring` (relative to when they were fetched).
  const seconds = $derived(next ? Math.max(0, Math.round(next.airingAt ? next.airingAt - now / 1000 : next.timeUntilAiring)) : 0)
</script>

{#if next && seconds > 0}
  <p data-part="detail.countdown" data-variant={variant} class="{className} text-sm {variant === 'long' ? 'w-fit max-w-full rounded-lg bg-secondary/60 px-3 py-2 font-semibold' : 'font-bold text-muted-foreground'}">
    {#if variant === 'long'}
      Episode {next.episode} will be released in <span class="text-theme">{longCountdown(seconds)}</span>
    {:else}
      Episode {next.episode} in <span class="tabular-nums text-foreground">{compactCountdown(seconds)}</span>
    {/if}
  </p>
{/if}
