<script lang="ts">
  import { onMount } from 'svelte'
  import { invoke } from '@tauri-apps/api/core'
  import { openUrl } from '@tauri-apps/plugin-opener'
  import type { Media } from '$lib/anilist/types'
  import type { DiscussionComment, DiscussionThread } from '$lib/comments'
  import type { EpMeta } from '$lib/anizip/types'
  import { airedCount, banner, cover, title as mediaTitle, totalEpisodes } from '$lib/anilist/media'
  import { getEpisodeMeta } from '$lib/anizip'
  import { episodeLabels } from '$lib/anilist/episode-labels'
  import { fetchMediaById } from '$lib/anilist/fetch-media'
  import { fetchDiscussion } from '$lib/comments'
  import { decideEmbedGestureOwner, embedResizeHeight, embedTouchScroll, preferredMobileDiscussion, type EmbedGestureOwner, type EmbedTouchScroll } from '$lib/comments/mobile'
  import { isDiscussAnimeEmbed, loadDiscussAnimeEmbedTheme } from '$lib/comments/embed-theme'
  import { hideSpoilers } from '$lib/settings/ui'
  import { localHistory, sessionProgress } from '$lib/player/history'
  import { getExternalTrackerProgress } from '$lib/trackers'
  import { playEpisodeFromWatchPage, type PlayState } from '$lib/stremio/play'
  import MessageSquare from '@lucide/svelte/icons/message-square'
  import ListVideo from '@lucide/svelte/icons/list-video'
  import PanelsTopLeft from '@lucide/svelte/icons/panels-top-left'
  import SkipBack from '@lucide/svelte/icons/skip-back'
  import SkipForward from '@lucide/svelte/icons/skip-forward'
  import ArrowBigUp from '@lucide/svelte/icons/arrow-big-up'

  type Tab = 'comments' | 'episodes' | 'related'

  let {
    media,
    episode,
    total,
    hasPrev,
    hasNext,
    onPrev,
    onNext,
    onRelated,
  }: {
    media: Media
    episode: number | null
    total: number | null
    hasPrev: boolean
    hasNext: boolean
    onPrev: () => void
    onNext: () => void
    // Takes the whole node, not its id: a relation can be a manga or light novel, and only the
    // node carries the type/format that decides which detail route it belongs on.
    onRelated: (media: Media) => void | Promise<void>
  } = $props()

  let episodeMeta = $state<Record<number, EpMeta>>({})
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
  // Latches are plain `let`, never `$state`: a latch that is read AND written inside its own effect
  // re-triggers that effect, and the teardown then cancels the request the pass just started.
  // For the same reason nothing here cancels via a teardown flag — in-flight results are gated by
  // comparing the key they were requested for.
  //
  // The props these effects read (`media`, `episode`) are lazy getters over `nowPlayingMedia` /
  // `nowPlaying`, which `playStream` REPLACES on every source change. A user cycling nine dead
  // releases therefore re-ran all four effects nine times for one unchanged episode: the whole
  // discussion aggregation, an AniList relations query, a MAL progress read and an AniZip lookup
  // each time. Keyed on the identity that actually matters, those re-runs are now no-ops.
  //
  // The preparation page is useful before playback starts, so these independent lookups begin as
  // soon as the target episode is known. Their caches are shared with the mounted player page;
  // results therefore carry across instead of restarting after the first frame.

  let discussionKey = ''
  $effect(() => {
    const ep = episode
    const key = `${media.id}:${ep ?? ''}`
    if (key === discussionKey) return
    // Another episode of the same title is the same page with new content, not a new page: the
    // tab the user chose stays chosen, and the previous discussion stays on screen (dimmed, with
    // the loading bar) until the new one arrives and the frame swaps its source in place. Tearing
    // it down at once used to collapse a page that was several screens tall, which is the scroll
    // jump at every episode change. A different title resets everything.
    const sameTitle = discussionKey.startsWith(`${media.id}:`)
    discussionKey = key
    if (!sameTitle) {
      tabTouched = false
      threads = []
      active = 'comments'
    } else {
      disqusScroller()?.scrollTo({ top: 0 })
    }
    commentsLoading = true
    const applyThreads = (value: DiscussionThread[]) => {
      if (key !== discussionKey) return
      threads = value
      commentsLoading = false
      if (!tabTouched) active = preferredMobileDiscussion(value) ? 'comments' : 'episodes'
    }
    fetchDiscussion(media, ep, applyThreads).then(applyThreads)
  })
  const discussion = $derived(preferredMobileDiscussion(threads))
  // The string, not the object: `preferredMobileDiscussion` builds a fresh object from every
  // threads update, and the discussion is applied twice per episode (fast result, then the full
  // one). Keyed on the object, the height reset below fired on the second pass — after the loader
  // had already reported its real height — and the frame stayed clipped at the bootstrap height.
  const disqusSrc = $derived(discussion?.kind === 'disqus' ? discussion.embedSrc : null)
  $effect(() => {
    if (discussion?.kind === 'disqus' && isDiscussAnimeEmbed(discussion.embedSrc)) {
      void loadDiscussAnimeEmbedTheme()
    }
  })
  const tabs = $derived<Tab[]>(
    commentsLoading || discussion ? ['comments', 'episodes', 'related'] : ['episodes', 'comments', 'related'],
  )
  let tabsEl = $state<HTMLElement>()
  let watchPage = $state<HTMLElement>()
  let disqusFrame = $state<HTMLIFrameElement>()
  let disqusHeight = $state(480)
  let disqusTouchDelta = 0
  let disqusTouchVelocity = 0
  let disqusTouchFrame = 0
  let disqusMomentumFrame = 0
  // A drag that starts on the comments is the browser's to scroll: the frame chain is set up so
  // it chains straight to the watch-page scroller, which gives native speed, fling and edge glow.
  // The relayed touches are only watched to find out whether that actually happened; the page
  // drives the scroller itself solely for a gesture the browser demonstrably left alone.
  let disqusGesture: { owner: EmbedGestureOwner; pending: number; armed: boolean } = { owner: 'native', pending: 0, armed: false }
  let disqusGestureStartTop = 0

  const disqusScroller = () => watchPage?.closest<HTMLElement>('.preparing-details, .watch-details') ?? null
  function stopDisqusMomentum() {
    if (disqusMomentumFrame) cancelAnimationFrame(disqusMomentumFrame)
    disqusMomentumFrame = 0
  }
  function flushDisqusTouchScroll() {
    disqusTouchFrame = 0
    const scroller = disqusScroller()
    if (!scroller || !disqusTouchDelta) return
    scroller.scrollTop += disqusTouchDelta
    disqusTouchDelta = 0
  }
  function resetDisqusTouchScroll() {
    stopDisqusMomentum()
    if (disqusTouchFrame) cancelAnimationFrame(disqusTouchFrame)
    disqusTouchFrame = 0
    disqusTouchDelta = 0
    disqusTouchVelocity = 0
    disqusGesture = { owner: 'native', pending: 0, armed: false }
  }
  // Only for a page-driven gesture. Decays like a native fling rather than being cut off after
  // 420ms, so a flick carries the reader through a long thread instead of stopping short.
  function startDisqusMomentum() {
    stopDisqusMomentum()
    if (Math.abs(disqusTouchVelocity) < 0.1) return
    let last = performance.now()
    const step = (now: number) => {
      const scroller = disqusScroller()
      if (!scroller) { disqusMomentumFrame = 0; return }
      const dt = Math.min(32, Math.max(1, now - last))
      const before = scroller.scrollTop
      last = now
      disqusTouchVelocity *= Math.pow(0.955, dt / 16.67)
      if (Math.abs(disqusTouchVelocity) < 0.04) { disqusMomentumFrame = 0; return }
      scroller.scrollTop += disqusTouchVelocity * dt
      if (scroller.scrollTop === before) { disqusMomentumFrame = 0; return }
      disqusMomentumFrame = requestAnimationFrame(step)
    }
    disqusMomentumFrame = requestAnimationFrame(step)
  }
  function applyDisqusTouchScroll(message: EmbedTouchScroll) {
    const scroller = disqusScroller()
    if (message.phase === 'start') {
      resetDisqusTouchScroll()
      disqusGesture = { owner: 'undecided', pending: 0, armed: false }
      disqusGestureStartTop = scroller?.scrollTop ?? 0
      return
    }
    if (message.phase === 'end') {
      if (disqusGesture.owner === 'page') { flushDisqusTouchScroll(); startDisqusMomentum() }
      disqusGesture = { owner: 'native', pending: 0, armed: false }
      return
    }
    if (!scroller || disqusGesture.owner === 'native') return
    if (disqusGesture.owner === 'undecided') {
      disqusGesture = decideEmbedGestureOwner(disqusGesture, message, {
        scrollTop: scroller.scrollTop,
        startTop: disqusGestureStartTop,
        scrollHeight: scroller.scrollHeight,
        clientHeight: scroller.clientHeight,
      })
      if (disqusGesture.owner !== 'page') return
      // The travel spent deciding belongs to the drag too.
      disqusTouchDelta += disqusGesture.pending
    } else {
      disqusTouchDelta += message.dy
    }
    const nextVelocity = Math.max(-4, Math.min(4, message.dy / message.dt))
    disqusTouchVelocity = disqusTouchVelocity && nextVelocity && Math.sign(disqusTouchVelocity) !== Math.sign(nextVelocity)
      ? nextVelocity
      : disqusTouchVelocity * 0.6 + nextVelocity * 0.4
    if (!disqusTouchFrame) disqusTouchFrame = requestAnimationFrame(flushDisqusTouchScroll)
  }

  const postToFrame = (msg: unknown) => disqusFrame?.contentWindow?.postMessage(msg, window.location.origin)
  const postReactionResult = (ok: boolean) => postToFrame({ type: 'izumi-react-result', ok })

  const REACTION_KEYS = ['upvote', 'funny', 'love', 'surprised', 'angry', 'sad']
  // The reaction backend is discussanime; only carry the native da_session cookie / POST there.
  function reactionBase(base: unknown): string | null {
    if (typeof base !== 'string') return null
    try {
      const u = new URL(base)
      const ok = u.protocol === 'https:' && (u.hostname === 'discussanime.moe' || u.hostname.endsWith('.discussanime.moe'))
      return ok ? u.origin : null
    } catch { return null }
  }

  // Reactions on Android: the same-origin loader can only read PUBLIC counts (its cross-site fetch can't
  // carry discussanime's session cookie). It asks us to do the authenticated work natively — read the
  // signed-in reaction state, and post a react (signing in via the in-app overlay first when needed,
  // then replaying the pending react). The overlay stays in-app, so the panel + iframe survive.
  async function loadReactionState(rawBase: unknown, identifier: unknown) {
    const base = reactionBase(rawBase)
    if (!base || typeof identifier !== 'string') return
    try {
      const res = await invoke<{ body: string }>('plugin:extplayer|da_reaction_state', { payload: { base, identifier } })
      const data = JSON.parse(res.body)
      postToFrame({ type: 'izumi-reaction-state-result', counts: data.counts, reaction: data.selectedKey ?? null })
    } catch { /* leave the loader's public counts as-is */ }
  }

  async function sendReaction(rawBase: unknown, identifier: unknown, key: unknown) {
    const base = reactionBase(rawBase)
    // key is a known reaction, or null to clear the current one; reject anything else.
    const react = key == null ? null : (typeof key === 'string' && REACTION_KEYS.includes(key) ? key : undefined)
    if (!base || typeof identifier !== 'string' || react === undefined) { postReactionResult(false); return }
    try {
      let res = await invoke<{ ok: boolean; needsLogin: boolean; body?: string }>(
        'plugin:extplayer|da_react', { payload: { base, identifier, key: react } })
      if (res.needsLogin) {
        const login = await invoke<{ ok: boolean }>('plugin:extplayer|da_login', { payload: { base } })
        if (!login.ok) { postReactionResult(false); return }
        res = await invoke('plugin:extplayer|da_react', { payload: { base, identifier, key: react } })
      }
      if (res.ok) {
        const counts = res.body ? JSON.parse(res.body).counts : undefined
        postToFrame({ type: 'izumi-react-result', ok: true, counts, reaction: react })
      } else {
        postReactionResult(false)
      }
    } catch { postReactionResult(false) }
  }

  onMount(() => {
    const onMessage = (event: MessageEvent) => {
      // Rewritten Disqus profile links (DISQUS_PROFILE_SCRIPT, lib.rs) arrive from the INNER
      // disqus.com frame — not the loader — so this must precede the source gate below. Origin +
      // fixed URL prefix bound what can be opened.
      if (event.origin === 'https://disqus.com' && event.data?.type === 'izumi-open-external') {
        const url: unknown = event.data.url
        if (typeof url === 'string' && url.startsWith('https://discussanime.moe/api/profile-redirect/')) void openUrl(url)
        return
      }
      if (event.source !== disqusFrame?.contentWindow) return
      // Height reports come from two origins: the same-origin Disqus loader and the cross-origin
      // archive (which hides its own overflow — unsized, it clips to 480px and cannot scroll).
      const height = embedResizeHeight(event.origin, event.data, window.location.origin)
      if (height != null) { disqusHeight = height; return }
      const touchScroll = embedTouchScroll(event.origin, event.data, window.location.origin)
      if (touchScroll) { applyDisqusTouchScroll(touchScroll); return }
      if (event.origin !== window.location.origin) return
      if (event.data?.type === 'izumi-react') {
        void sendReaction(event.data.base, event.data.identifier, event.data.key)
      } else if (event.data?.type === 'izumi-reaction-state') {
        void loadReactionState(event.data.base, event.data.identifier)
      }
    }
    window.addEventListener('message', onMessage)
    return () => {
      window.removeEventListener('message', onMessage)
      resetDisqusTouchScroll()
    }
  })

  $effect(() => {
    void disqusSrc
    resetDisqusTouchScroll()
    disqusHeight = 480
    // A frame that is being reused for a new source has to be asked: the loader only reports a
    // height that differs from its last one, and this reset is invisible to it.
    postToFrame({ type: 'izumi-disqus-request-height' })
  })

  function chooseTab(tab: Tab, scroll = false) {
    tabTouched = true
    active = tab
    if (scroll) requestAnimationFrame(() => tabsEl?.scrollIntoView({ behavior: 'smooth', block: 'start' }))
  }

  let trackerProgress = $state(0)
  let trackerKey = ''
  $effect(() => {
    const idMal = media.idMal
    const key = `${media.id}:${idMal ?? ''}`
    if (key === trackerKey) return
    trackerKey = key
    trackerProgress = 0
    getExternalTrackerProgress(media.id, idMal ?? undefined).then((entry) => {
      if (key === trackerKey) trackerProgress = entry?.progress ?? 0
    }).catch(() => {})
  })
  const watchedThrough = $derived(Math.max(
    media.mediaListEntry?.progress ?? 0,
    $localHistory[media.id]?.progress ?? 0,
    $sessionProgress[media.id] ?? 0,
    trackerProgress,
  ))
  let metaKey = ''
  $effect(() => {
    const id = media.id
    const watched = watchedThrough
    const key = `${id}:${watched}`
    if (key === metaKey) return
    metaKey = key
    const applyMeta = (value: Record<number, EpMeta>) => {
      if (key === metaKey) episodeMeta = value
    }
    getEpisodeMeta(id, watched, applyMeta).then(applyMeta)
  })
  const knownTotal = $derived((total ?? totalEpisodes(media)) || 0)
  const aired = $derived.by(() => {
    const value = airedCount(media)
    return Math.min(knownTotal, Number.isFinite(value) ? value : 0)
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
    if (ep <= aired && playState.status !== 'resolving') void playEpisodeFromWatchPage(media, ep, (state) => (playState = state))
  }

  let relatedMedia = $state<Media | null>(null)
  let relationsKey = ''
  $effect(() => {
    const key = String(media.id)
    if (key === relationsKey) return
    relationsKey = key
    relatedMedia = media
    if (media.relations?.edges?.length) return
    fetchMediaById(media.id, true).then((value) => { if (key === relationsKey) relatedMedia = value }).catch(() => {})
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

<section bind:this={watchPage} class="watch-page px-4 pb-[calc(env(safe-area-inset-bottom)+1.5rem)] pt-5">
  <h1 class="text-xl font-extrabold leading-tight">{heading}</h1>
  {#if subheading}<p class="mt-1 text-sm text-white/60">{subheading}</p>{/if}
  <div class="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-white/45">
    {#if media.averageScore}<span>{media.averageScore}% score</span>{/if}
    {#if episodeAge}<span>{episodeAge}</span>{/if}
    {#if media.trending}<span>#{media.trending} trending</span>{/if}
    {#if media.popularity}<span>{compact.format(media.popularity)} popularity</span>{/if}
  </div>

  <div class="mt-5 grid grid-cols-2 gap-2 border-y border-white/10 py-3">
    <button onclick={onPrev} disabled={!hasPrev} class="watch-action disabled:opacity-30" aria-label="Previous episode"><SkipBack size={22} /><span>Previous</span></button>
    <button onclick={onNext} disabled={!hasNext} class="watch-action disabled:opacity-30" aria-label="Next episode"><SkipForward size={22} /><span>Next</span></button>
  </div>

  <div bind:this={tabsEl} class="scroll-mt-3 pt-2">
    <!-- Opaque on purpose: a backdrop blur over a screen-tall iframe re-composites on every
         scrolled frame, which is the one place this page must stay cheap. -->
    <div class="sticky top-0 z-20 -mx-4 bg-[#0a0a0b] px-4 py-3">
      <div class="flex gap-2 overflow-x-auto">
        {#each tabs as tab (tab)}
          <button onclick={() => chooseTab(tab)} class="inline-flex shrink-0 items-center gap-2 rounded-full px-4 py-2 text-sm font-bold transition-colors
            {active === tab ? 'bg-white text-black' : 'bg-white/10 text-white/85'}">
            {#if tab === 'comments'}<MessageSquare size={17} />{:else if tab === 'episodes'}<ListVideo size={17} />{:else}<PanelsTopLeft size={17} />{/if}
            {tabLabel(tab)}
          </button>
        {/each}
      </div>
    </div>

    <div class="pt-1">
      <!-- The comments block stays mounted while another tab is showing: rebooting the Disqus
           frame on every tab switch cost a full reload and a page that grew back from its
           bootstrap height each time. -->
      <div class:hidden={active !== 'comments'}>
        {#if commentsLoading && !discussion}
          <div class="space-y-2">{#each Array.from({ length: 4 }) as _}<div class="h-20 animate-pulse rounded-xl bg-white/[0.06]"></div>{/each}</div>
        {:else if discussion?.kind === 'disqus'}
          {#if commentsLoading}
            <div class="mb-2 h-1 overflow-hidden rounded-full bg-white/[0.08]"><div class="bar-loader h-full w-full"></div></div>
          {/if}
          <!-- Grow the embed to its reported content height so Android has one continuous page
               scroller. A viewport-capped, independently scrolling frame makes the gesture change
               owners at the comments boundary and feels like the page is fighting the finger. -->
          <iframe bind:this={disqusFrame} title="Episode comments" src={disqusSrc} scrolling="no"
            style:height={`${disqusHeight}px`}
            class="min-h-[30rem] w-full border-0 bg-[#0e0e0e] transition-opacity duration-200 {commentsLoading ? 'opacity-40' : ''}"
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
      </div>
      {#if active === 'episodes'}
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
          <div class="grid grid-cols-2 gap-3 min-[480px]:grid-cols-3">
            {#each relations as relation (relation.node.id)}
              <button onclick={() => onRelated(relation.node)} class="min-w-0 text-left active:scale-[0.98]">
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
