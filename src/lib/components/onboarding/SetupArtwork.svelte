<script lang="ts">
  import { MediaQuery } from 'svelte/reactivity'
  const mobile = new MediaQuery('(max-width: 767px), (max-height: 500px) and (pointer: coarse)')
  import { phttp } from '$lib/net/http'
  let { intent = { anime: true, films: true } }: { intent?: { anime: boolean; films: boolean } } = $props()

  /** Neither library chosen. The footer already refuses to advance, so rather than leaving the
   *  wall showing catalogs the user just opted out of, it fills with dogs and the odd hug. */
  const empty = $derived(!intent.anime && !intent.films)
  const mode = $derived(empty || (intent.anime && intent.films) ? 'both' : intent.films ? 'movies' : 'anime')

  const posterFilms = ['oYuLEt3zVCKq57qu2F8dT7NIa6f.jpg', 'gEU2QniE6E77NI6lCU6MxlNBvIx.jpg', '39wmItIWsg5sZMyRUHLkWBcuVCM.jpg', 'qJ2tW6WMUDux911r6m7haRef0WH.jpg', '8Gxv8gSFCU0XGDykEGv7zR1n2ua.jpg', 'd5NXSklXo0qyIYkgV94XAgMIckC.jpg']
    .map(path => 'https://image.tmdb.org/t/p/w342/' + path)
  const posterAnime = ['bx154587-qQTzQnEJJ3oB.jpg', 'bx16498-buvcRTBx4NSm.jpg', 'bx113415-LHBAeoZDIsnF.jpg', 'bx127230-DdP4vAdssLoz.png', 'bx151807-it355ZgzquUd.png', 'bx21-ELSYx3yMPcKM.jpg']
    .map(path => 'https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/' + path)

  let strays = $state.raw<string[]>([])
  const urls = (value: unknown): string[] =>
    (Array.isArray(value) ? value : []).flatMap((entry) => {
      const url = typeof entry === 'string' ? entry : typeof (entry as { url?: unknown })?.url === 'string' ? (entry as { url: string }).url : ''
      return url.startsWith('https://') ? [url] : []
    })

  // Fetched once, only when the empty state is actually reached, and only if it has not already
  // been fetched — this is a flourish, so a failure just leaves the ordinary artwork in place.
  $effect(() => {
    if (!empty || strays.length) return
    let stale = false
    void (async () => {
      const [dogs, hugs] = await Promise.all([
        phttp('https://dog.ceo/api/breeds/image/random/10').then(r => r.json()).then(d => urls((d as { message?: unknown }).message)).catch(() => []),
        phttp('https://nekos.best/api/v2/hug?amount=2').then(r => r.json()).then(d => urls((d as { results?: unknown }).results)).catch(() => []),
      ])
      if (stale || !dogs.length) return
      // Hugs land a third and two thirds of the way in, so they read as a surprise among the dogs
      // rather than a block of anime at the end.
      const mixed = [...dogs]
      hugs.slice(0, 2).forEach((hug, index) => mixed.splice(Math.round(mixed.length * (index + 1) / 3), 0, hug))
      strays = mixed
    })()
    return () => { stale = true }
  })

  const pick = (source: string[], offset: number) =>
    Array.from({ length: 6 }, (_, index) => source[(index + offset) % source.length])
  const films = $derived(empty && strays.length ? pick(strays, 0) : posterFilms)
  const anime = $derived(empty && strays.length ? pick(strays, 3) : posterAnime)
</script>

<div class="artwork-wall" data-mode={mode} aria-hidden="true">
  {#if mobile.current}
    <!-- Six portrait assets, no duplicate loop layers or hidden catalog downloads on phones. -->
    <div class="mobile-posters">
      {#each [0, 1] as column}
        <div class="mobile-column">
          {#each [0, 1, 2] as row}
            {@const index = row * 2 + column}
            {@const isAnime = mode === 'anime' || (mode === 'both' && (row + column) % 2 === 0)}
            {@const src = isAnime ? anime[index] : films[index]}
            <div class="poster">
              <img {src} srcset={isAnime ? undefined : `${src.replace('/w342/', '/w185/')} 185w, ${src} 342w`} sizes="50vw" width="342" height="513" alt="" draggable="false" decoding="async" referrerpolicy="no-referrer" class="shown" onload={(event) => (event.currentTarget as HTMLImageElement).dataset.loaded = 'true'} onerror={(event) => delete (event.currentTarget as HTMLImageElement).dataset.loaded} />
            </div>
          {/each}
        </div>
      {/each}
    </div>
  {:else}
  <div class="poster-columns">
    {#each [0, 1, 2] as column}
      <div class="poster-column" class:reverse={column === 1}>
        <!-- Identical halves make the loop seamless. Images stay mounted when the focus changes,
             so choosing a catalog crossfades the artwork without resetting its movement. -->
        {#each [0, 1] as repeat (repeat)}
          <div class="poster-group">
            {#each films as _, index}
              {@const mixedAnime = (index + column) % 2 === 0}
              <div class="poster">
                <img src={films[(index + column * 2) % films.length]} class:shown={mode === 'movies' || (mode === 'both' && !mixedAnime)} alt="" draggable="false" decoding="async" referrerpolicy="no-referrer" onload={(event) => (event.currentTarget as HTMLImageElement).dataset.loaded = 'true'} onerror={(event) => delete (event.currentTarget as HTMLImageElement).dataset.loaded} />
                <img src={anime[(index + column * 2) % anime.length]} class:shown={mode === 'anime' || (mode === 'both' && mixedAnime)} alt="" draggable="false" decoding="async" referrerpolicy="no-referrer" onload={(event) => (event.currentTarget as HTMLImageElement).dataset.loaded = 'true'} onerror={(event) => delete (event.currentTarget as HTMLImageElement).dataset.loaded} />
              </div>
            {/each}
          </div>
        {/each}
      </div>
    {/each}
  </div>
  {/if}
</div>

<style>
  .artwork-wall { position: absolute; inset: 0; overflow: hidden; background: #121316; contain: paint; }
  .artwork-wall::after { content: ''; position: absolute; inset: 0; background: linear-gradient(0deg, #111216 0%, #11121618 30%, #11121640 100%); pointer-events: none; }
  .poster-columns { --poster-gap: 1rem; position: absolute; inset: -22% -12%; display: grid; align-items: start; grid-template-columns: repeat(3, 1fr); gap: var(--poster-gap); transform: rotate(10deg); }
  .poster-column { animation: drift 140s linear infinite; will-change: transform; }
  .poster-column.reverse { margin-top: -35%; animation-direction: reverse; }
  .poster-group { display: grid; gap: var(--poster-gap); padding-bottom: var(--poster-gap); }
  .poster { position: relative; aspect-ratio: 2 / 3; overflow: hidden; border-radius: .6rem; background: #24262e; box-shadow: 0 8px 24px #0005; }
  img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; opacity: 0; transition: opacity 650ms cubic-bezier(.2, .65, .3, 1); }
  img.shown:global([data-loaded]) { opacity: .88; }
  @keyframes drift { from { transform: translateY(0); } to { transform: translateY(-50%); } }
  .mobile-posters { position: absolute; inset: -8% -7% auto; display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: .75rem; transform: rotate(-8deg); }
  .mobile-column { display: grid; gap: .75rem; }
  .mobile-column:nth-child(2) { margin-top: -35%; }
  .mobile-posters .poster { border-radius: .5rem; box-shadow: none; }
  .mobile-posters img { transition: none; }
  @media (prefers-reduced-motion: reduce) { .poster-column { animation: none; will-change: auto; } img { transition: none; } }
</style>
