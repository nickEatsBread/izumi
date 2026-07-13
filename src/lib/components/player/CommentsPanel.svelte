<script lang="ts">
  // In-player discussion panel: a right-side sheet of the playing episode's discussion threads, keyed
  // on nowPlayingMedia.{media,episode}. Aggregates AniList forum threads (per-series, link-out) + the
  // r/anime episode thread found by search (inline comment bodies) + an optional configured mapper.
  // Read-only for now — posting (AniList free, Reddit OAuth) is a later phase.
  import { fly } from 'svelte/transition'
  import { openUrl } from '@tauri-apps/plugin-opener'
  import MessageSquare from 'lucide-svelte/icons/message-square'
  import X from 'lucide-svelte/icons/x'
  import ExternalLink from 'lucide-svelte/icons/external-link'
  import ArrowBigUp from 'lucide-svelte/icons/arrow-big-up'
  import { nowPlayingMedia, commentsOpen } from '$lib/player/session'
  import { fetchDiscussion, defaultDiscussionPlatform, type DiscussionThread, type DiscussionComment } from '$lib/comments'

  let threads = $state<DiscussionThread[]>([])
  let loading = $state(false)
  let filter = $state('All')
  // Dedup guard — NON-reactive on purpose. If this were `$state`, the effect below (which reads AND
  // writes it) would re-trigger itself, cancel its own in-flight fetch, and leave `loading` stuck true.
  let loadedKey = ''

  // (Re)fetch when the panel opens or the episode changes; cached by media+episode.
  $effect(() => {
    if (!$commentsOpen) return
    const np = $nowPlayingMedia
    if (!np) return
    const key = `${np.media.id}:${np.episode ?? ''}`
    if (key === loadedKey) return
    loadedKey = key
    loading = true
    filter = 'All'
    let cancelled = false
    fetchDiscussion(np.media, np.episode).then((t) => {
      if (cancelled) return
      threads = t
      loading = false
      // Open on the preferred source if it's present (else the aggregated 'All' list).
      const want = $defaultDiscussionPlatform
      const lbl = want !== 'auto' ? platLabel(want) : 'All'
      filter = lbl !== 'All' && t.some((x) => x.source === lbl) ? lbl : 'All'
    })
    return () => { cancelled = true }
  })

  // SDK platform slug → the badge/filter label (mirrors comments/index.ts).
  const platLabel = (p: string) => p === 'anilist' ? 'AniList' : p === 'mal' ? 'MAL' : p === 'youtube' ? 'YouTube' : p.charAt(0).toUpperCase() + p.slice(1)

  const sources = $derived([...new Set(threads.map((t) => t.source))])
  const shown = $derived(filter === 'All' ? threads : threads.filter((t) => t.source === filter))
  // When a single source is selected and its thread is embeddable (Disqus/forum), render the embed
  // inline instead of the comment list / link-out.
  const embedThread = $derived(filter !== 'All' ? shown.find((t) => t.embedUrl) : undefined)
  const embedUrl = $derived(embedThread?.embedUrl)
  const ep = $derived($nowPlayingMedia?.episode)

  const ago = (ms?: number) => {
    if (!ms) return ''
    const s = Math.floor((Date.now() - ms) / 1000)
    if (s < 3600) return `${Math.max(1, Math.floor(s / 60))}m`
    if (s < 86400) return `${Math.floor(s / 3600)}h`
    if (s < 2592000) return `${Math.floor(s / 86400)}d`
    return `${Math.floor(s / 2592000)}mo`
  }

  // Swallow pointer events so clicks/taps inside the panel never reach the player underneath (which
  // would toggle play/pause or seek). An action keeps it off the markup — no a11y handlers on a div.
  function stopBubble(node: HTMLElement) {
    const stop = (e: Event) => e.stopPropagation()
    for (const ev of ['pointerdown', 'click', 'dblclick']) node.addEventListener(ev, stop)
    return { destroy() { for (const ev of ['pointerdown', 'click', 'dblclick']) node.removeEventListener(ev, stop) } }
  }
</script>

{#snippet commentTree(c: DiscussionComment, depth: number)}
  <div class="py-1.5 {depth ? 'ml-2 border-l border-white/10 pl-2' : ''}">
    <div class="flex items-center gap-1.5 text-[0.65rem] text-muted-foreground">
      <span class="font-bold text-foreground/80">{c.author ?? 'anon'}</span>
      {#if c.score != null}<span class="inline-flex items-center gap-0.5"><ArrowBigUp size={11} />{c.score}</span>{/if}
      {#if c.createdAt}<span>· {ago(c.createdAt)}</span>{/if}
    </div>
    <p class="mt-0.5 whitespace-pre-wrap break-words text-xs text-foreground/90">{c.body}</p>
    {#if c.replies?.length}
      {#each c.replies as r (r.id)}{@render commentTree(r, depth + 1)}{/each}
    {/if}
  </div>
{/snippet}

{#if $commentsOpen}
  <div use:stopBubble class="absolute inset-y-0 right-0 z-40 flex w-full max-w-md flex-col border-l border-white/10 bg-background/95 text-foreground shadow-2xl backdrop-blur-sm"
       transition:fly={{ x: 320, duration: 200 }}>
    <header class="flex items-center gap-2 border-b border-white/10 px-4 py-3">
      <MessageSquare size={18} class="text-theme" />
      <h2 class="flex items-baseline gap-1.5 text-sm font-black"><span>Discussion</span>{#if ep}<span class="font-semibold text-muted-foreground">· Ep {ep}</span>{/if}</h2>
      <button data-focusable onclick={() => commentsOpen.set(false)} aria-label="Close discussion"
              class="ml-auto grid h-8 w-8 place-items-center rounded-md hover:bg-accent"><X size={18} /></button>
    </header>

    {#if !loading && sources.length > 1}
      <div class="flex flex-wrap gap-1.5 border-b border-white/10 px-3 py-2">
        {#each ['All', ...sources] as s (s)}
          <button data-focusable onclick={() => (filter = s)}
                  class="rounded-full px-2.5 py-0.5 text-xs font-bold transition-colors
                    {filter === s ? 'bg-primary text-primary-foreground' : 'bg-secondary text-muted-foreground hover:text-foreground'}">{s}</button>
        {/each}
      </div>
    {/if}

    {#if !loading && embedUrl}
      <!-- Embeddable source (Disqus/forum): render its embed inline instead of a link-out. -->
      <iframe title="Discussion" src={embedUrl} class="block w-full flex-1 border-0"
              sandbox="allow-scripts allow-same-origin allow-popups allow-forms allow-popups-to-escape-sandbox"></iframe>
    {:else}
    <div class="flex-1 overflow-y-auto px-3 py-3">
      {#if loading}
        {#each Array.from({ length: 5 }) as _}<div class="mb-2 h-20 animate-pulse rounded-lg bg-muted"></div>{/each}
      {:else if !shown.length}
        <div class="grid h-full place-items-center px-6 text-center">
          <div>
            <p class="text-sm font-bold">No discussions found</p>
            <p class="mt-1 text-xs text-muted-foreground">No threads for this episode yet. A discussion mapper can be set in Settings for more sources.</p>
          </div>
        </div>
      {:else}
        {#each shown as t (t.id)}
          <article class="mb-2 rounded-lg bg-secondary/60 p-3">
            <div class="mb-1 flex items-center gap-2 text-[0.65rem] font-bold uppercase tracking-wide text-muted-foreground">
              <span class="rounded bg-theme/15 px-1.5 py-0.5 text-theme">{t.source}</span>
              {#if t.author}<span class="normal-case tracking-normal">{t.author}</span>{/if}
              {#if t.createdAt}<span>· {ago(t.createdAt)}</span>{/if}
              {#if t.replyCount != null}<span class="ml-auto normal-case tracking-normal">{t.replyCount} {t.replyCount === 1 ? 'reply' : 'replies'}</span>{/if}
            </div>
            <h3 class="text-sm font-bold leading-snug">{t.title}</h3>

            {#if t.comments?.length}
              <div class="mt-2 divide-y divide-white/5">
                {#each t.comments as c (c.id)}{@render commentTree(c, 0)}{/each}
              </div>
            {:else if t.body}
              <p class="mt-1 line-clamp-3 text-xs text-muted-foreground">{t.body}</p>
            {/if}

            {#if t.url}
              <button data-focusable onclick={() => openUrl(t.url!)}
                      class="mt-2 inline-flex items-center gap-1 rounded-md bg-secondary px-2.5 py-1 text-xs font-bold hover:bg-accent">
                Open thread<ExternalLink size={12} />
              </button>
            {/if}
          </article>
        {/each}
      {/if}
    </div>
    {/if}
  </div>
{/if}
