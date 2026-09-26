<script lang="ts">
  import type { Media } from '$lib/anilist/types'
  import { mediaFacts, type MediaFact } from '$lib/detail/facts'

  // The standard facts as a label/value table (site-style info panels), a scrolling row of
  // value-over-label cards (phone apps), or chips.
  let {
    media,
    variant,
    className = 'mt-3',
    progress,
    controllerUi = false,
  }: {
    media: Media
    variant: 'table' | 'cards' | 'chips'
    /** Desktop siblings space themselves with a trailing `mb-3` instead of this component's own
     * leading `mt-3` — callers there pass `className="mb-3"` so the gap survives even when this
     * ends up the last element before an unspaced sibling (e.g. the action bar). */
    className?: string
    /** Watched-progress summary (e.g. "3/12"). Set only when there IS progress: this is the one
     * place a non-template facts style could otherwise lose it entirely. */
    progress?: string
    controllerUi?: boolean
  } = $props()
  const facts = $derived.by((): MediaFact[] => [
    ...(progress ? [{ key: 'progress', label: 'Watched', value: progress }] : []),
    ...mediaFacts(media),
  ])
</script>

{#snippet value(fact: MediaFact)}
  {#if fact.links}
    {#each fact.links as link, i (link.href)}{i ? ', ' : ''}<a href={link.href} data-focusable={controllerUi ? undefined : ''} tabindex={controllerUi ? -1 : undefined} class="underline-offset-2 hover:underline">{link.text}</a>{/each}
  {:else if fact.href}
    <a href={fact.href} data-focusable={controllerUi ? undefined : ''} tabindex={controllerUi ? -1 : undefined} class="underline-offset-2 hover:underline">{fact.value}</a>
  {:else}
    {fact.value}
  {/if}
{/snippet}

{#if facts.length}
  {#if variant === 'table'}
    <dl data-part="detail.facts" data-variant={variant} class="{className} grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1.5 text-sm">
      {#each facts as fact (fact.key)}
        <div data-part="fact" class="contents">
          <dt data-part="fact.label" class="font-bold text-muted-foreground">{fact.label}</dt>
          <dd data-part="fact.value" class="min-w-0 truncate text-foreground">{@render value(fact)}</dd>
        </div>
      {/each}
    </dl>
  {:else if variant === 'cards'}
    <dl data-part="detail.facts" data-variant={variant} class="-mx-4 {className} flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none] sm:mx-0 sm:px-0">
      {#each facts as fact (fact.key)}
        <div data-part="fact" class="flex min-w-[5.5rem] shrink-0 flex-col items-center rounded-xl bg-secondary/60 px-3 py-2 text-center">
          <!-- <dt> before <dd> is valid dl grouping (term before description) and gives assistive
               tech the right reading order; order-last keeps the value drawn above the label. -->
          <dt data-part="fact.label" class="order-last mt-0.5 text-[0.68rem] font-semibold uppercase tracking-wide text-muted-foreground">{fact.label}</dt>
          <dd data-part="fact.value" class="text-sm font-black text-foreground">{@render value(fact)}</dd>
        </div>
      {/each}
    </dl>
  {:else}
    <dl data-part="detail.facts" data-variant={variant} class="{className} flex flex-wrap gap-1.5 text-xs">
      {#each facts as fact (fact.key)}
        <div data-part="fact" class="inline-flex items-center gap-1 rounded-full bg-secondary/70 px-2.5 py-1">
          <dt data-part="fact.label" class="font-semibold text-muted-foreground">{fact.label}</dt>
          <dd data-part="fact.value" class="font-bold text-foreground">{@render value(fact)}</dd>
        </div>
      {/each}
    </dl>
  {/if}
{/if}
