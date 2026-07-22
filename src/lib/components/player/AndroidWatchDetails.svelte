<script lang="ts">
  import { invoke } from '@tauri-apps/api/core'
  import type { Media } from '$lib/anilist/types'
  import type { DiscussionComment, DiscussionThread } from '$lib/comments'
  import type { EpMeta } from '$lib/anizip/types'
  import { airedCount, banner, cover, title as mediaTitle, totalEpisodes } from '$lib/anilist/media'
  import { getEpisodeMeta } from '$lib/anizip'
  import { episodeLabels } from '$lib/anilist/episode-labels'
  import { fetchMediaById } from '$lib/anilist/fetch-media'
  import { commentsEnabled, fetchDiscussion } from '$lib/comments'
  import { disqusLoginUrl, preferredMobileDiscussion, reloadedEmbedSrc } from '$lib/comments/mobile'
  import { hideSpoilers } from '$lib/settings/ui'
  import { localHistory, sessionProgress } from '$lib/player/history'
  import { playEpisode, type PlayState } from '$lib/stremio/play'
  import MessageSquare from 'lucide-svelte/icons/message-square'
  import ListVideo from 'lucide-svelte/icons/list-video'
  import PanelsTopLeft from 'lucide-svelte/icons/panels-top-left'
  import PictureInPicture from 'lucide-svelte/icons/picture-in-picture-2'
  import SkipBack from 'lucide-svelte/icons/skip-back'
  import SkipForward from 'lucide-svelte/icons/skip-forward'
  import ArrowBigUp from 'lucide-svelte/icons/arrow-big-up'
  import LogIn from 'lucide-svelte/icons/log-in'

  type Tab = 'comments' | 'episodes' | 'related'

  let {
    media,
    episode,
    total,
    hasPrev,
    hasNext,
    onPrev,
    onNext,
    onPip,
    onRelated,
  }: {
    media: Media
    episode: number | null
    total: number | null
    hasPrev: boolean
    hasNext: boolean
    onPrev: () => void
    onNext: () => void
    onPip: () => void
    onRelated: (id: number) => void | Promise<void>
  } = $props()

  let episodeMeta = $state<Record<number, EpMeta>>({})
  $effect(() => {
    const id = media.id
    const wanted = episode ?? undefined
    let cancelled = false
    getEpisodeMeta(id, wanted).then((value) => {
      if (!cancelled) episodeMeta = value
    })
    return () => { cancelled = true }
  })

  const currentMeta = $derived(episode != null ? episodeMeta[episode] : undefined)
  const showEpisodeTitle = $derived(!$hideSpoilers && !!currentMeta?.title)
  const plannedTotal = $derived((total ?? totalEpisodes(media)) || null)
  const seriesName = $derived(mediaTitle(media))
  const heading = $derived(showEpisodeTitle ? currentMeta?.title ?? seriesName : seriesName)
  const subheading = $derived(
    showEpisodeTitle
      ? `${seriesName}${episode != null ? ` · Episode ${episode}${plannedTotal ? ` of ${plannedTotal}` : ''}` : ''}`
      : episode != null ? `Episode ${episode}${plannedTotal ? ` of ${plannedTotal}` : ''}` : '',
  )

  function airTimestamp(ep: number | null): number | undefined {
    if (ep == null) return undefined
    const fromMeta = episodeMeta[ep]?.airDate
    if (fromMeta) {
      const parsed = Date.parse(fromMeta)
      if (Number.isFinite(parsed)) return parsed
    }
    const scheduled = media.airingSchedule?.nodes?.find((node) => node.episode === ep)?.airingAt
    return scheduled ? scheduled * 1000 : undefined
  }

  const relativeFormatter = new Intl.RelativeTimeFormat(undefined, { numeric: 'always' })
  function relativeAge(timestamp?: number): string {
    if (!timestamp) return ''
    const seconds = (timestamp - Date.now()) / 1000
    const units: [Intl.RelativeTimeFormatUnit, number][] = [
      ['year', 31557600], ['month', 2629800], ['day', 86400], ['hour', 3600], ['minute', 60],
    ]
    for (const [unit, size] of units) {
      if (Math.abs(seconds) >= size || unit === 'minute') return relativeFormatter.format(Math.round(seconds / size), unit)
    }
    return ''
  }
  const episodeAge = $derived(relativeAge(airTimestamp(episode)))
  const compact = new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 })

  let active = $state<Tab>('comments')
  let tabTouched = false
  let commentsLoading = $state(true)
  let threads = $state<DiscussionThread[]>([])
  $effect(() => {
    const ep = episode
    const enabled = $commentsEnabled
    tabTouched = false
    threads = []
    if (!enabled) { commentsLoading = false; active = 'episodes'; return }
    commentsLoading = true
    active = 'comments'
    let cancelled = false
    fetchDiscussion(media, ep).then((value) => {
      if (cancelled) return
      threads = value
      commentsLoading = false
      if (!preferredMobileDiscussion(value) && !tabTouched) active = 'episodes'
    })
    return () => { cancelled = true }
  })
  const discussion = $derived(preferredMobileDiscussion(threads))
  let disqusReload = $state(0)
  let disqusSigningIn = $state(false)
  let disqusLoginError = $state('')
  const disqusFrameSrc = $derived(
    discussion?.kind === 'disqus' ? reloadedEmbedSrc(discussion.embedSrc, disqusReload) : '',
  )
  async function signInToDisqus() {
    if (discussion?.kind !== 'disqus' || disqusSigningIn) return
    const authUrl = disqusLoginUrl(discussion.embedSrc)
    if (!authUrl) { disqusLoginError = 'Disqus sign-in is unavailable for this thread.'; return }
    disqusSigningIn = true
    disqusLoginError = ''
    try {
      await invoke<string>('oauth_capture', {
        authUrl,
        redirectPrefix: 'https://disqus.com/next/login-success/',
      })
      disqusReload += 1
    } catch (error) {
      const message = String(error)
      if (!message.toLowerCase().includes('cancel')) disqusLoginError = 'Disqus sign-in did not complete.'
    } finally {
      disqusSigningIn = false
    }
  }
  const tabs = $derived<Tab[]>(
    commentsLoading || discussion ? ['comments', 'episodes', 'related'] : ['episodes', 'comments', 'related'],
  )
  let tabsEl = $state<HTMLElement>()
  function chooseTab(tab: Tab, scroll = false) {
    tabTouched = true
    active = tab
    if (scroll) requestAnimationFrame(() => tabsEl?.scrollIntoView({ behavior: 'smooth', block: 'start' }))
  }

  const watchedThrough = $derived(Math.max(
    media.mediaListEntry?.progress ?? 0,
    $localHistory[media.id]?.progress ?? 0,
    $sessionProgress[media.id] ?? 0,
  ))
  const knownTotal = $derived((total ?? totalEpisodes(media)) || 0)
  const aired = $derived.by(() => {
    const value = airedCount(media)
    return Math.min(knownTotal, Number.isFinite(value) ? value : knownTotal)
  })
  const EPISODES_PER_PAGE = 24
  let episodePage = $state(0)
  $effect(() => { episodePage = Math.floor((Math.max(1, episode ?? 1) - 1) / EPISODES_PER_PAGE) })
  const episodePages = $derived(Math.max(1, Math.ceil(knownTotal / EPISODES_PER_PAGE)))
  const episodeRows = $derived(Array.from(
    { length: Math.max(0, Math.min(EPISODES_PER_PAGE, knownTotal - episodePage * EPISODES_PER_PAGE)) },
    (_, index) => episodePage * EPISODES_PER_PAGE + index + 1,
  ))
  let playState = $state<PlayState>({ status: 'idle' })
  function play(ep: number) {
    if (ep <= aired && playState.status !== 'resolving') playEpisode(media, ep, (state) => (playState = state))
  }

  let relatedMedia = $state<Media | null>(null)
  $effect(() => {
    relatedMedia = media
    if (media.relations?.edges?.length) return
    let cancelled = false
    fetchMediaById(media.id, true).then((value) => { if (!cancelled) relatedMedia = value }).catch(() => {})
    return () => { cancelled = true }
  })
  const relations = $derived.by(() => {
    const seen = new Set<number>()
    return ((relatedMedia ?? media).relations?.edges ?? []).filter(({ node }) => {
      if (node.id === media.id || seen.has(node.id)) return false
      seen.add(node.id)
      return true
    })
  })

  const tabLabel = (tab: Tab) => tab === 'comments' ? 'Comments' : tab === 'episodes' ? 'Episodes' : 'Related'
  const ago = (ms?: number) => relativeAge(ms)
</script>

{#snippet commentTree(comment: DiscussionComment, depth: number)}
  <div class="py-2 {depth ? 'ml-3 border-l border-white/10 pl-3' : ''}">
    <div class="flex items-center gap-1.5 text-[0.68rem] text-white/45">
      <span class="font-bold text-white/75">{comment.author ?? 'anon'}</span>
      {#if comment.score != null}<span class="inline-flex items-center gap-0.5"><ArrowBigUp size={11} />{comment.score}</span>{/if}
      {#if comment.createdAt}<span>· {ago(comment.createdAt)}</span>{/if}
    </div>
    <p class="mt-1 whitespace-pre-wrap break-words text-sm leading-relaxed text-white/85">{comment.body}</p>
    {#if comment.replies?.length}
      {#each comment.replies as reply (reply.id)}{@render commentTree(reply, depth + 1)}{/each}
    {/if}
  </div>
{/snippet}

<section class="watch-page px-4 pb-[calc(env(safe-area-inset-bottom)+1.5rem)] pt-5">
  <h1 class="text-xl font-extrabold leading-tight">{heading}</h1>
  {#if subheading}<p class="mt-1 text-sm text-white/60">{subheading}</p>{/if}
  <div class="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-white/45">
    {#if media.averageScore}<span>{media.averageScore}% score</span>{/if}
    {#if episodeAge}<span>{episodeAge}</span>{/if}
    {#if media.trending}<span>#{media.trending} trending</span>{/if}
    {#if media.popularity}<span>{compact.format(media.popularity)} popularity</span>{/if}
  </div>

  <div class="mt-5 grid grid-cols-4 gap-2 border-y border-white/10 py-3">
    <button onclick={onPrev} disabled={!hasPrev} class="watch-action disabled:opacity-30" aria-label="Previous episode"><SkipBack size={22} /><span>Previous</span></button>
    <button onclick={() => chooseTab('comments', true)} class="watch-action" aria-label="Comments"><MessageSquare size={22} /><span>Comments</span></button>
    <button onclick={onPip} class="watch-action" aria-label="Picture in picture"><PictureInPicture size={22} /><span>Miniplayer</span></button>
    <button onclick={onNext} disabled={!hasNext} class="watch-action disabled:opacity-30" aria-label="Next episode"><SkipForward size={22} /><span>Next</span></button>
  </div>

  <div bind:this={tabsEl} class="scroll-mt-3 pt-5">
    <div class="flex gap-2 overflow-x-auto pb-1">
      {#each tabs as tab (tab)}
        <button onclick={() => chooseTab(tab)} class="inline-flex shrink-0 items-center gap-2 rounded-full px-4 py-2 text-sm font-bold transition-colors
          {active === tab ? 'bg-white text-black' : 'bg-white/10 text-white/85'}">
          {#if tab === 'comments'}<MessageSquare size={17} />{:else if tab === 'episodes'}<ListVideo size={17} />{:else}<PanelsTopLeft size={17} />{/if}
          {tabLabel(tab)}
        </button>
      {/each}
    </div>

    <div class="pt-4">
      {#if active === 'comments'}
        {#if commentsLoading}
          <div class="space-y-2">{#each Array.from({ length: 4 }) as _}<div class="h-20 animate-pulse rounded-xl bg-white/[0.06]"></div>{/each}</div>
        {:else if discussion?.kind === 'disqus'}
          <div class="mb-2 flex items-center justify-between gap-3 rounded-xl bg-white/[0.06] px-3 py-2.5">
            <p class="text-xs text-white/55">Sign in inside Izumi to post and reply.</p>
            <button onclick={signInToDisqus} disabled={disqusSigningIn}
              class="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-white px-3 py-1.5 text-xs font-bold text-black disabled:opacity-50">
              <LogIn size={15} /> {disqusSigningIn ? 'Signing in…' : 'Sign in'}
            </button>
          </div>
          {#if disqusLoginError}<p class="mb-2 text-xs text-red-400">{disqusLoginError}</p>{/if}
          <iframe title="Episode comments" src={disqusFrameSrc} class="h-[65vh] min-h-[30rem] w-full rounded-xl border-0 bg-white"
            sandbox="allow-scripts allow-same-origin allow-popups allow-forms allow-popups-to-escape-sandbox"></iframe>
        {:else if discussion?.kind === 'reddit'}
          <article class="rounded-xl bg-white/[0.05] px-3 py-2">
            <h2 class="py-2 text-base font-bold">{discussion.thread.title}</h2>
            {#if discussion.thread.comments?.length}
              <div class="divide-y divide-white/[0.06]">
                {#each discussion.thread.comments as comment (comment.id)}{@render commentTree(comment, 0)}{/each}
              </div>
            {:else if discussion.thread.body}<p class="py-2 text-sm text-white/75">{discussion.thread.body}</p>{/if}
          </article>
        {:else}
          <div class="rounded-xl border border-dashed border-white/15 px-5 py-10 text-center">
            <p class="font-bold">No comments for this episode</p>
            <p class="mt-1 text-sm text-white/45">No Disqus or Reddit discussion was found.</p>
          </div>
        {/if}
      {:else if active === 'episodes'}
        {#if playState.status === 'error'}<p class="mb-3 text-sm text-red-400">{playState.message}</p>{/if}
        {#if episodePages > 1}
          <div class="mb-3 flex items-center justify-between text-sm">
            <button disabled={episodePage === 0} onclick={() => (episodePage -= 1)} class="rounded-lg bg-white/10 px-3 py-1.5 font-bold disabled:opacity-30">Previous</button>
            <span class="text-white/45">{episodePage + 1} / {episodePages}</span>
            <button disabled={episodePage >= episodePages - 1} onclick={() => (episodePage += 1)} class="rounded-lg bg-white/10 px-3 py-1.5 font-bold disabled:opacity-30">Next</button>
          </div>
        {/if}
        <div class="space-y-3">
          {#each episodeRows as ep (ep)}
            {@const released = ep <= aired}
            {@const labels = episodeLabels(ep, episodeMeta[ep]?.title, $hideSpoilers && ep > watchedThrough)}
            {@const image = episodeMeta[ep]?.image || banner(media) || cover(media)}
            {@const age = relativeAge(airTimestamp(ep))}
            <button disabled={!released || playState.status === 'resolving'} onclick={() => play(ep)}
              class="flex w-full overflow-hidden rounded-xl bg-white/[0.06] text-left transition-transform active:scale-[0.99] disabled:opacity-45 {episode === ep ? 'ring-2 ring-theme' : ''}">
              <div class="relative aspect-video w-36 shrink-0 bg-white/[0.04]">
                {#if image}<img src={image} alt="" loading="lazy" class="h-full w-full object-cover" />{/if}
                <span class="absolute bottom-2 right-2 rounded-full bg-black/75 px-2 py-0.5 text-xs font-black">EP {ep}</span>
              </div>
              <span class="min-w-0 flex-1 self-center px-4 py-3">
                <strong class="line-clamp-2 text-sm leading-snug">{labels.primary}</strong>
                {#if !$hideSpoilers && labels.secondary && labels.secondary !== labels.primary}<span class="mt-1 block truncate text-xs text-white/45">{labels.secondary}</span>{/if}
                {#if age}<span class="mt-1 block text-xs text-white/45">{age}</span>{/if}
              </span>
            </button>
          {/each}
          {#if !episodeRows.length}<p class="py-8 text-center text-sm text-white/45">No episode list is available.</p>{/if}
        </div>
      {:else}
        {#if relations.length}
          <div class="grid grid-cols-3 gap-3">
            {#each relations as relation (relation.node.id)}
              <button onclick={() => onRelated(relation.node.id)} class="min-w-0 text-left active:scale-[0.98]">
                <img src={cover(relation.node)} alt="" loading="lazy" class="aspect-[2/3] w-full rounded-lg bg-white/[0.05] object-cover" />
                <span class="mt-1 block line-clamp-2 text-xs font-bold leading-tight">{mediaTitle(relation.node)}</span>
                <span class="mt-0.5 block truncate text-[0.65rem] capitalize text-white/40">{relation.relationType.replaceAll('_', ' ').toLowerCase()}</span>
              </button>
            {/each}
          </div>
        {:else}
          <p class="rounded-xl border border-dashed border-white/15 px-5 py-10 text-center text-sm text-white/45">No related titles.</p>
        {/if}
      {/if}
    </div>
  </div>
</section>

<style>
  .watch-action { display: flex; min-width: 0; flex-direction: column; align-items: center; gap: 0.35rem; font-size: 0.7rem; font-weight: 600; color: rgb(255 255 255 / 0.82); }
</style>
