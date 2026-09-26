<script lang="ts">
  import type { Media } from '$lib/anilist/types'
  import { mediaFacts } from '$lib/detail/facts'

  // The standard facts as a label/value table (site-style info panels), a scrolling row of
  // value-over-label cards (phone apps), or chips.
  let { media, variant }: { media: Media; variant: 'table' | 'cards' | 'chips' } = $props()
  const facts = $derived(mediaFacts(media))
</script>

{#if facts.length}
  {#if variant === 'table'}
    <dl data-part="detail.facts" data-variant={variant} class="mt-3 grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1.5 text-sm">
      {#each facts as fact (fact.key)}
        <div data-part="fact" class="contents">
          <dt data-part="fact.label" class="font-bold text-muted-foreground">{fact.label}</dt>
          <dd data-part="fact.value" class="min-w-0 truncate text-foreground">
            {#if fact.href}<a href={fact.href} class="underline-offset-2 hover:underline">{fact.value}</a>{:else}{fact.value}{/if}
          </dd>
        </div>
      {/each}
    </dl>
  {:else if variant === 'cards'}
    <dl data-part="detail.facts" data-variant={variant} class="-mx-4 mt-3 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none] sm:mx-0 sm:px-0">
      {#each facts as fact (fact.key)}
        <div data-part="fact" class="flex min-w-[5.5rem] shrink-0 flex-col items-center rounded-xl bg-secondary/60 px-3 py-2 text-center">
          <dd data-part="fact.value" class="text-sm font-black text-foreground">
            {#if fact.href}<a href={fact.href}>{fact.value}</a>{:else}{fact.value}{/if}
          </dd>
          <dt data-part="fact.label" class="order-last mt-0.5 text-[0.68rem] font-semibold uppercase tracking-wide text-muted-foreground">{fact.label}</dt>
        </div>
      {/each}
    </dl>
  {:else}
    <dl data-part="detail.facts" data-variant={variant} class="mt-3 flex flex-wrap gap-1.5 text-xs">
      {#each facts as fact (fact.key)}
        <div data-part="fact" class="inline-flex items-center gap-1 rounded-full bg-secondary/70 px-2.5 py-1">
          <dt data-part="fact.label" class="font-semibold text-muted-foreground">{fact.label}</dt>
          <dd data-part="fact.value" class="font-bold text-foreground">
            {#if fact.href}<a href={fact.href}>{fact.value}</a>{:else}{fact.value}{/if}
          </dd>
        </div>
      {/each}
    </dl>
  {/if}
{/if}
