<script lang="ts">
  import type { Media } from '$lib/anilist/types'
  import SmallCard from '$lib/components/cards/SmallCard.svelte'

  let { media, view }: { media: Media; view: 'people' | 'recommendations' } = $props()
  const recommendations = $derived(
    (media.recommendations?.nodes ?? [])
      .filter((node): node is { rating?: number; mediaRecommendation: Media } => !!node.mediaRecommendation)
      .map((node) => node.mediaRecommendation),
  )
</script>

{#if view === 'people'}
  <div class="space-y-7">
    <section>
      <h3 class="mb-3 text-lg font-black">{media.type === 'MANGA' ? 'Characters' : 'Characters & Japanese voices'}</h3>
      {#if media.characters?.edges?.length}
        <div class="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {#each media.characters.edges as character (character.node.id)}
            {@const actor = character.voiceActors?.[0]}
            <div class="flex min-w-0 overflow-hidden rounded-lg border border-border bg-secondary/30">
              <img src={character.node.image?.large} alt="" loading="lazy" class="aspect-[2/3] w-20 shrink-0 object-cover" />
              <div class="min-w-0 flex-1 p-3">
                <div class="truncate font-black">{character.node.name.full}</div>
                <div class="text-xs text-muted-foreground">{character.role.toLowerCase()}</div>
                {#if actor}
                  <div class="mt-3 flex items-center gap-2">
                    <img src={actor.image?.large} alt="" loading="lazy" class="size-9 rounded-full object-cover" />
                    <div class="min-w-0">
                      <div class="truncate text-sm font-bold">{actor.name.full}</div>
                      <div class="text-[0.65rem] uppercase tracking-wide text-muted-foreground">Japanese voice</div>
                    </div>
                  </div>
                {/if}
              </div>
            </div>
          {/each}
        </div>
      {:else}<p class="text-sm text-muted-foreground">No character credits are available.</p>{/if}
    </section>

    <section>
      <h3 class="mb-3 text-lg font-black">Staff</h3>
      {#if media.staff?.edges?.length}
        <div class="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {#each media.staff.edges as credit (`${credit.node.id}-${credit.role}`)}
            <div class="flex items-center gap-3 rounded-lg border border-border bg-secondary/30 p-2">
              <img src={credit.node.image?.large} alt="" loading="lazy" class="size-14 rounded-md object-cover" />
              <div class="min-w-0">
                <div class="truncate font-bold">{credit.node.name.full}</div>
                <div class="line-clamp-2 text-xs text-muted-foreground">{credit.role}</div>
              </div>
            </div>
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
