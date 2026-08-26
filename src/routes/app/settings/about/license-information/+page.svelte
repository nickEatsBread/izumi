<script lang="ts">
  const services = [
    {
      name: 'AniList',
      href: 'https://anilist.co',
      description: 'Anime and manga listings, metadata, schedules and optional account tracking.',
    },
    {
      name: 'Kitsu',
      href: 'https://kitsu.app',
      description: 'Anime listings, metadata, episodes and optional account tracking.',
    },
    {
      name: 'Jikan',
      href: 'https://jikan.moe',
      description: 'Public anime metadata used as an additional fallback when the primary anime services are unavailable.',
    },
    {
      name: 'Stremio',
      href: 'https://www.stremio.com',
      description: 'The add-on protocol used to request metadata, streams and subtitles from user-configured add-ons.',
    },
  ]
</script>

<div class="p-4 sm:p-8">
  <h2 class="mb-1 text-xl font-black">License Information</h2>
  <p class="mb-5 max-w-2xl text-sm text-muted-foreground">Open-source licensing, data providers and service acknowledgements.</p>

  <div class="max-w-2xl space-y-6">
    <section>
      <h3 class="mb-2 text-sm font-black">Open-source license</h3>
      <div class="rounded-lg border border-border p-4">
        <p class="text-sm">
          Izumi is free and open-source software licensed under the
          <strong>GNU Affero General Public License v3.0 or later</strong>.
        </p>
        <p class="mt-2 text-xs text-muted-foreground">
          Third-party libraries and components remain subject to their respective licenses and copyright notices.
        </p>
        <div class="mt-4 flex flex-wrap gap-2">
          <a
            href="https://github.com/nickEatsBread/izumi/blob/main/LICENSE"
            target="_blank"
            rel="noreferrer"
            class="rounded-md bg-secondary px-3 py-2 text-sm font-bold hover:bg-accent"
          >Read the full license</a>
          <a
            href="https://github.com/nickEatsBread/izumi"
            target="_blank"
            rel="noreferrer"
            class="rounded-md border border-border px-3 py-2 text-sm font-bold hover:bg-secondary"
          >View source code</a>
        </div>
      </div>
    </section>

    <section>
      <h3 class="mb-2 text-sm font-black">Metadata and service APIs</h3>
      <div class="divide-y divide-border rounded-lg border border-border">
        <div class="p-4">
          <a href="https://www.themoviedb.org" target="_blank" rel="noreferrer" class="block w-fit" aria-label="The Movie Database">
            <img src="/brand/tmdb.svg" alt="TMDB" class="h-6 w-auto" />
          </a>
          <p class="mt-2 text-xs text-muted-foreground">Movie and television listings, artwork and metadata.</p>
          <p class="mt-2 text-xs text-muted-foreground">This product uses the TMDB API but is not endorsed or certified by TMDB.</p>
        </div>

        {#each services as service (service.name)}
          <div class="p-4">
            <a href={service.href} target="_blank" rel="noreferrer" class="font-bold text-primary hover:underline">{service.name}</a>
            <p class="mt-1 text-xs text-muted-foreground">{service.description}</p>
          </div>
        {/each}
      </div>
      <p class="mt-3 text-xs text-muted-foreground">
        Izumi is an independent project. Service names, logos and trademarks belong to their respective owners.
      </p>
    </section>
  </div>
</div>
