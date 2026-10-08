<script lang="ts">
  import type { Media } from '$lib/anilist/types'
  import { compactCountdown, longCountdown } from '$lib/themes/countdown'
  import { airingDate, countdownShown, fullCountdown, wordsCountdown } from '$lib/detail/airing-countdown'
  import { themePresentation } from '$lib/themes/runtime'
  import { resolveDetail, type DetailCountdown } from '$lib/themes/presentation'

  // "Episode 12 in 2d 21h", "Episode 12 will be released in 4 days 19 hrs 43 mins", "Episode 12 airs in
  // 4 days 19 hours", the full count down to seconds, or "Next episode 12" over its local airing time.
  // `full` ticks each second, the others each minute.
  let {
    media,
    variant,
    within,
    className = 'mt-3',
  }: {
    media: Media
    variant: Exclude<DetailCountdown, 'none'>
    /** Days ahead the countdown still shows; the theme's `detail.countdownWithin` without it. */
    within?: number
    /** Desktop siblings space with a trailing `mb-3` rather than this component's own leading
     * `mt-3` — see FactList's `className` for why. */
    className?: string
  } = $props()
  const opened = Date.now()
  let now = $state(opened)
  $effect(() => {
    const timer = setInterval(() => (now = Date.now()), variant === 'full' ? 1000 : 60_000)
    return () => clearInterval(timer)
  })
  const next = $derived(media.nextAiringEpisode)
  // `airingAt` is absolute; older records only carry `timeUntilAiring` (relative to when they were fetched).
  const seconds = $derived(next ? Math.max(0, Math.round(next.airingAt ? next.airingAt - now / 1000 : next.timeUntilAiring)) : 0)
  const withinDays = $derived(within ?? resolveDetail($themePresentation).countdownWithin)
  // The absolute time `date` prints: the record's own, else counted from when the page opened.
  const airsAt = $derived(next?.airingAt ?? Math.round(opened / 1000) + (next?.timeUntilAiring ?? 0))
</script>

{#if next && countdownShown(seconds, withinDays)}
  {#if variant === 'long'}
    <p data-part="detail.countdown" data-variant={variant} class="{className} w-fit max-w-full rounded-lg bg-secondary/60 px-3 py-2 text-sm font-semibold">
      Episode {next.episode} will be released in <span data-part="detail.countdown.time" class="text-theme">{longCountdown(seconds)}</span>
    </p>
  {:else if variant === 'compact'}
    <p data-part="detail.countdown" data-variant={variant} class="{className} text-sm font-bold text-muted-foreground">
      Episode {next.episode} in <span data-part="detail.countdown.time" class="tabular-nums text-foreground">{compactCountdown(seconds)}</span>
    </p>
  {:else if variant === 'words'}
    <!-- One line: the time is the part that matters, so a narrow column ellipsizes rather than wraps. -->
    <p data-part="detail.countdown" data-variant={variant} class="{className} truncate text-sm text-muted-foreground">
      <span data-part="detail.countdown.label">Episode {next.episode} airs in</span> <span data-part="detail.countdown.time" class="font-bold text-theme">{wordsCountdown(seconds)}</span>
    </p>
  {:else if variant === 'full'}
    <p data-part="detail.countdown" data-variant={variant} class="{className} w-fit max-w-full rounded-lg bg-secondary/60 px-3 py-2 text-sm font-semibold">
      <span data-part="detail.countdown.label" class="block">Episode {next.episode} will be released in</span>
      <span data-part="detail.countdown.time" class="block tabular-nums text-theme">{fullCountdown(seconds)}</span>
    </p>
  {:else}
    <p data-part="detail.countdown" data-variant={variant} class="{className} w-fit max-w-full rounded-lg bg-secondary/60 px-3 py-2 text-sm">
      <span data-part="detail.countdown.label" class="block font-semibold">Next episode {next.episode}</span>
      <span data-part="detail.countdown.time" class="block text-muted-foreground">{airingDate(airsAt)}</span>
    </p>
  {/if}
{/if}
