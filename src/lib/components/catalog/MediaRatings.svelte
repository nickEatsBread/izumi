<script lang="ts">
  import type { Media } from '$lib/anilist/types'
  import { compactRatingLabel, compactVotes, ratingLabel, ratingOutOfTen, ratingsFor } from '$lib/catalog/media-metadata'
  import RatingSourceMark from './RatingSourceMark.svelte'

  let { media, embeddedScore, compact = false }: { media: Media; embeddedScore?: number; compact?: boolean } = $props()
  const ratings = $derived(ratingsFor(media, embeddedScore))
  const tone = (score: number) => score >= 7.5
    ? 'border-emerald-400/25 bg-emerald-400/10'
    : score >= 6 ? 'border-amber-400/25 bg-amber-400/10'
    : 'border-rose-400/25 bg-rose-400/10'
</script>

{#if ratings.length}
  <div class="flex flex-wrap items-center gap-2" aria-label="Ratings">
    {#each ratings as rating (`${rating.source}:${rating.score}:${rating.scale}`)}
      {@const votes = compactVotes(rating.votes)}
      <span
        class="inline-flex min-h-7 items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-bold {tone(ratingOutOfTen(rating))}"
        title={`${rating.source} rating${votes ? ` from ${votes} votes` : ''}`}
        aria-label={`${rating.source} rating ${compactRatingLabel(rating)} out of 10${votes ? ` from ${votes} votes` : ''}`}
      >
        <RatingSourceMark source={rating.source} />
        <span>{compact ? compactRatingLabel(rating) : ratingLabel(rating)}</span>
        {#if votes && !compact}<span class="font-medium text-muted-foreground">{votes}</span>{/if}
      </span>
    {/each}
  </div>
{/if}
