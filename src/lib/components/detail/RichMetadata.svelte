<script lang="ts">
  import type { Media } from '$lib/anilist/types'
  import SmallCard from '$lib/components/cards/SmallCard.svelte'

  let { media, view }: { media: Media; view: 'people' | 'recommendations' } = $props()
  const recommendations = $derived(
    (media.recommendations?.nodes ?? [])
      .filter((node): node is { rating?: number; mediaRecommendation: Media } => !!node.mediaRecommendation)
      .map((node) => node.mediaRecommendation),
  )
  const tmdbPeople = $derived(media.catalog?.provider === 'tmdb')
  const personHref = (id: number) => tmdbPeople ? `/app/person/tmdb/${id}`
    : !media.catalog || media.catalog.provider === 'anilist' ? `/app/staff/${id}` : undefined
</script>

{#if view === 'people'}
  <div class="space-y-7">
    <section data-slot="detail.characters">
      <h3 class="mb-3 text-lg font-black">{media.type === 'MANGA' ? 'Characters' : 'Characters & Japanese voices'}</h3>
      {#if media.characters?.edges?.length}
        <div class="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {#each media.characters.edges as character (character.node.id)}
            {@const actor = character.voiceActors?.[0]}
            {#if tmdbPeople}
              <a data-part="person" href={personHref(character.node.id)} data-focusable class="flex min-w-0 overflow-hidden rounded-lg border border-border bg-secondary/30 transition-colors hover:bg-accent/40 focus-visible:ring-2 focus-visible:ring-ring">
                <img data-part="person.photo" src={character.node.image?.large} alt="" loading="lazy" decoding="async" class="aspect-[2/3] w-20 shrink-0 object-cover" />
                <span class="min-w-0 flex-1 p-3">
                  <span data-part="person.name" class="block truncate font-black">{character.node.name.full}</span>
                  <span data-part="person.role" class="block text-xs text-muted-foreground">{character.role.toLowerCase()}</span>
                </span>
              </a>
            {:else}
            <div data-part="person" class="flex min-w-0 overflow-hidden rounded-lg border border-border bg-secondary/30">
              <img data-part="person.photo" src={character.node.image?.large} alt="" loading="lazy" decoding="async" class="aspect-[2/3] w-20 shrink-0 object-cover" />
              <div class="min-w-0 flex-1 p-3">
                <div data-part="person.name" class="truncate font-black">{character.node.name.full}</div>
                <div data-part="person.role" class="text-xs text-muted-foreground">{character.role.toLowerCase()}</div>
                {#if actor}
                  <svelte:element this={personHref(actor.id) ? 'a' : 'div'} href={personHref(actor.id)} data-focusable={personHref(actor.id) ? '' : undefined} class="mt-3 flex items-center gap-2 rounded-md hover:bg-accent/50">
                    <img src={actor.image?.large} alt="" loading="lazy" decoding="async" class="size-9 rounded-full object-cover" />
                    <div class="min-w-0">
                      <div class="truncate text-sm font-bold">{actor.name.full}</div>
                      <div class="text-[0.65rem] uppercase tracking-wide text-muted-foreground">Japanese voice</div>
                    </div>
                  </svelte:element>
                {/if}
              </div>
            </div>
            {/if}
          {/each}
        </div>
      {:else}<p class="text-sm text-muted-foreground">No character credits are available.</p>{/if}
    </section>

    <section data-slot="detail.staff">
      <h3 class="mb-3 text-lg font-black">Staff</h3>
      {#if media.staff?.edges?.length}
        <div class="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {#each media.staff.edges as credit (`${credit.node.id}-${credit.role}`)}
            <svelte:element this={personHref(credit.node.id) ? 'a' : 'div'} data-part="person" href={personHref(credit.node.id)} data-focusable={personHref(credit.node.id) ? '' : undefined} class="flex items-center gap-3 rounded-lg border border-border bg-secondary/30 p-2 hover:bg-accent/40 focus-visible:ring-2 focus-visible:ring-ring">
              <img data-part="person.photo" src={credit.node.image?.large} alt="" loading="lazy" decoding="async" class="size-14 rounded-md object-cover" />
              <div class="min-w-0">
                <div data-part="person.name" class="truncate font-bold">{credit.node.name.full}</div>
                <div data-part="person.role" class="line-clamp-2 text-xs text-muted-foreground">{credit.role}</div>
              </div>
            </svelte:element>
          {/each}
        </div>
      {:else}<p class="text-sm text-muted-foreground">No staff credits are available.</p>{/if}
    </section>
  </div>
{:else if recommendations.length}
  <div class="grid grid-cols-2 gap-4 sm:flex sm:flex-wrap">
    {#each recommendations as recommendation (recommendation.id)}
      <div class="min-w-0 sm:w-[152px]"><SmallCard media={recommendation} fill /></div>
    {/each}
  </div>
{:else}
  <p class="text-muted-foreground">No recommendations yet.</p>
{/if}
