<script lang="ts">
  import { getContextClient } from '@urql/svelte'
  import { MEDIA_TAG_COLLECTION } from '$lib/anilist/detail-queries'
  import { cycleTag, tagState, groupTags, type MediaTag } from '$lib/anilist/tags'
  import { showAdult } from '$lib/settings/ui'
  import Search from 'lucide-svelte/icons/search'

  let {
    include = [],
    exclude = [],
    onchange,
  }: {
    include: string[]
    exclude: string[]
    onchange: (include: string[], exclude: string[]) => void
  } = $props()

  let tags = $state<MediaTag[]>([])
  let search = $state('')
  let showSpoilers = $state(false)
  let listEl = $state<HTMLElement>()

  const client = getContextClient()
  // Fetch the full tag collection once (urql-cached thereafter), mirroring the genre fetch.
  client.query(MEDIA_TAG_COLLECTION, {}).toPromise().then((r) => {
    const t = (r.data as { MediaTagCollection?: MediaTag[] } | undefined)?.MediaTagCollection
    if (Array.isArray(t) && t.length) tags = t
  }).catch(() => {})

  const groups = $derived(groupTags(tags, {
    search, showSpoilers, showAdult: $showAdult, selected: [...include, ...exclude],
  }))

  function cycle(name: string) {
    const r = cycleTag(name, include, exclude)
    onchange(r.include, r.exclude)
  }
  // Desktop nicety: right-click jumps a tag straight to excluded (or clears if already there).
  function toExclude(e: Event, name: string) {
    e.preventDefault()
    if (exclude.includes(name)) onchange(include, exclude.filter((n) => n !== name))
    else onchange(include.filter((n) => n !== name), [...exclude, name])
  }
  function jump(cat: string) {
    listEl?.querySelector(`[data-cat="${cat}"]`)?.scrollIntoView({ block: 'start', behavior: 'smooth' })
  }

  const chipClass = (s: 'include' | 'exclude' | 'neutral') =>
    s === 'include' ? 'bg-green-600/80 text-white ring-1 ring-green-400'
    : s === 'exclude' ? 'bg-red-600/80 text-white ring-1 ring-red-400'
    : 'bg-secondary text-muted-foreground hover:bg-accent hover:text-foreground'
</script>

<div class="flex h-full min-h-0 flex-col gap-2 overflow-hidden">
  <div class="grid shrink-0 gap-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
    <label class="flex flex-1 items-center gap-2 rounded-md bg-secondary px-3 py-1.5">
      <Search size={15} class="shrink-0 text-muted-foreground" />
      <input bind:value={search} data-focusable placeholder="Filter tags…"
             class="w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground" />
    </label>
    <label class="flex shrink-0 items-center gap-1.5 text-xs font-semibold text-muted-foreground">
      <input type="checkbox" data-focusable bind:checked={showSpoilers} class="accent-theme" />
      Spoilers
    </label>
  </div>

  <!-- Category quick-jump: scrolls the list to a section (fast nav without the OSK on Deck). -->
  {#if groups.length > 1}
    <div class="flex shrink-0 gap-1 overflow-x-auto pb-1">
      {#each groups as g (g.category)}
        <button data-focusable onclick={() => jump(g.category)}
                class="whitespace-nowrap rounded-full bg-secondary px-2.5 py-0.5 text-[0.7rem] font-bold text-muted-foreground hover:bg-accent hover:text-foreground">
          {g.category}
        </button>
      {/each}
    </div>
  {/if}

  <div bind:this={listEl} class="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain pr-1 [scrollbar-gutter:stable]">
    {#if !tags.length}
      <p class="py-6 text-center text-sm text-muted-foreground">Loading tags…</p>
    {:else if !groups.length}
      <p class="py-6 text-center text-sm text-muted-foreground">No tags match “{search}”.</p>
    {:else}
      {#each groups as g (g.category)}
        <div data-cat={g.category}>
          <div class="mb-1.5 text-xs font-black uppercase tracking-wide text-muted-foreground">{g.category}</div>
          <div class="flex flex-wrap gap-1.5">
            {#each g.tags as t (t.name)}
              {@const s = tagState(t.name, include, exclude)}
              <button data-focusable onclick={() => cycle(t.name)} oncontextmenu={(e) => toExclude(e, t.name)}
                      title={s === 'include' ? 'Included — click to exclude' : s === 'exclude' ? 'Excluded — click to clear' : 'Click to include (right-click to exclude)'}
                      class="rounded-full px-2.5 py-1 text-xs font-semibold transition-colors {chipClass(s)}">
                {t.name}
              </button>
            {/each}
          </div>
        </div>
      {/each}
    {/if}
  </div>
</div>
