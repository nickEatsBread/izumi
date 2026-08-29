<script lang="ts">
  let { source }: { source: string } = $props()

  const normalized = $derived(source.toLowerCase().replaceAll(/[^a-z]/g, ''))
  let failedSource = $state('')
  const imageFailed = $derived(failedSource === normalized)
  const text = $derived(source === 'Rotten Tomatoes' ? 'RT'
    : source === 'Metacritic' ? 'MC'
    : source === 'MyAnimeList' ? 'MAL'
    : source === 'Source' ? 'SRC'
    : source)
</script>

<span class="inline-flex h-4 shrink-0 items-center justify-center font-black leading-none" aria-hidden="true">
  {#if normalized === 'anilist'}
    <img src="/brand/anilist.svg" alt="" class="size-4 object-contain" />
  {:else if normalized === 'myanimelist'}
    <img src="/brand/myanimelist.svg" alt="" class="size-4 rounded-sm object-contain" />
  {:else if normalized === 'tmdb'}
    <img
      src="https://www.themoviedb.org/assets/v4/logos/v2/blue_square_2-d537fb228cf3ded904ef09b136fe3fec72548ebc1fea3fbbd1ad9e36364db38b.svg"
      alt=""
      class="size-4 rounded-sm object-contain"
    />
  {:else if normalized === 'kitsu' && !imageFailed}
    <img src="https://avatars.githubusercontent.com/u/7648832?s=64&amp;v=4" alt="" class="size-4 rounded-sm object-cover" onerror={() => (failedSource = normalized)} />
  {:else if normalized === 'simkl' && !imageFailed}
    <img src="https://simkl.com/favicon.ico" alt="" class="size-4 object-contain" onerror={() => (failedSource = normalized)} />
  {:else}
    <span class="text-[0.65rem] tracking-[-0.03em] {normalized === 'imdb' ? 'rounded-sm bg-[#f5c518] px-1 py-0.5 text-black' : 'text-foreground/75'}">{text}</span>
  {/if}
</span>
