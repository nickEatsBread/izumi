<script lang="ts">
  import Award from '@lucide/svelte/icons/award'
  import type { Media } from '$lib/anilist/types'
  import { title } from '$lib/anilist/media'
  import { findAnimeAwardWins } from '$lib/catalog/anime-awards'
  import { fetchAwardSummary, namedProviderAward, type AwardRecognition, type AwardSummary } from '$lib/catalog/awards'

  let { media }: { media: Media } = $props()

  let general = $state<AwardSummary[]>([])
  const supported = $derived(media.catalog?.provider === 'tmdb' || media.catalog?.provider === 'stremio')
  const anime = $derived(supported ? findAnimeAwardWins(title(media)) : [])
  const recognitions = $derived.by((): AwardRecognition[] => general
    .flatMap((item) => item.recognitions)
    .sort((left, right) => Number(right.result === 'winner') - Number(left.result === 'winner')))
  const topGeneral = $derived(recognitions[0])
  const relatedGeneral = $derived(recognitions.slice(1, 3))
  const hiddenGeneral = $derived(Math.max(0, recognitions.length - 3))
  const providerAwardName = $derived(namedProviderAward(media.awards))

  $effect(() => {
    const imdbId = supported ? media.externalIds?.imdb : undefined
    general = []
    if (!imdbId) return
    const abort = new AbortController()
    void fetchAwardSummary(imdbId, abort.signal).then((summary) => {
      if (!abort.signal.aborted) general = summary
    })
    return () => abort.abort()
  })

</script>

{#if supported && (topGeneral || providerAwardName || anime.length)}
  <aside aria-label="Awards"
    class="relative z-10 mx-5 mb-5 flex w-fit max-w-[calc(100%-2.5rem)] flex-col gap-2 rounded-xl border border-white/10 bg-black/55 px-3 py-2.5 text-white shadow-[0_8px_24px_rgba(0,0,0,.28)] backdrop-blur-md sm:mx-8 xl:absolute xl:bottom-8 xl:right-8 xl:mx-0 xl:mb-0 xl:max-w-[26rem]">
    {#if topGeneral}
      <div class="flex items-center gap-2.5">
        <span class="grid size-8 shrink-0 place-items-center rounded-lg bg-amber-400/12 text-amber-300">
          <Award size={17} strokeWidth={1.9} aria-hidden="true" />
        </span>
        <div class="min-w-0">
          <div class="text-[0.58rem] font-black uppercase tracking-[0.16em] text-amber-200/90">{topGeneral.result}</div>
          <div class="mt-0.5 line-clamp-2 text-xs font-semibold leading-snug text-white/85" title={topGeneral.label}>{topGeneral.label}</div>
        </div>
      </div>
      {#if relatedGeneral.length}
        <div class="ml-[2.625rem] space-y-1 border-t border-white/10 pt-2">
          {#each relatedGeneral as recognition (`${recognition.label}:${recognition.result}`)}
            <div class="flex min-w-0 items-baseline gap-2 text-[0.68rem]">
              <span class="min-w-0 flex-1 truncate font-semibold text-white/72" title={recognition.label}>{recognition.label}</span>
              <span class="shrink-0 capitalize text-white/42">{recognition.result}</span>
            </div>
          {/each}
          {#if hiddenGeneral}<div class="text-[0.66rem] font-bold text-amber-200/65">+{hiddenGeneral} more</div>{/if}
        </div>
      {/if}
    {:else if providerAwardName}
      <div class="flex items-center gap-2.5">
        <span class="grid size-8 shrink-0 place-items-center rounded-lg bg-amber-400/12 text-amber-300">
          <Award size={17} strokeWidth={1.9} aria-hidden="true" />
        </span>
        <div class="min-w-0">
          <div class="text-[0.58rem] font-black uppercase tracking-[0.16em] text-amber-200/90">Recognition</div>
          <div class="mt-0.5 truncate text-xs font-semibold text-white/75">{providerAwardName}</div>
        </div>
      </div>
    {/if}

    {#if anime.length}
      <div class="flex items-center gap-2.5 {topGeneral || providerAwardName ? 'border-t border-white/10 pt-2' : ''}">
        <span class="grid size-8 shrink-0 place-items-center rounded-lg bg-orange-500/12 text-orange-300">
          <Award size={17} strokeWidth={1.9} aria-hidden="true" />
        </span>
        <div class="min-w-0">
          <div class="truncate text-[0.58rem] font-black uppercase tracking-[0.16em] text-orange-200/90">Crunchyroll winner</div>
          <div class="mt-0.5 truncate text-xs font-semibold text-white/75">{anime[0].year} {anime[0].category}{#if anime.length > 1} · +{anime.length - 1} more{/if}</div>
        </div>
      </div>
    {/if}
  </aside>
{/if}
