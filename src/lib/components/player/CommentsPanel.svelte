<script lang="ts">
  // In-player discussion panel: a right-side sheet of the playing episode's discussion threads, keyed
  // on nowPlayingMedia.{media,episode}. Aggregates AniList forum threads (per-series, link-out) + the
  // r/anime episode thread found by search (inline comment bodies) + an optional configured mapper.
  // Read-only for now — posting (AniList free, Reddit OAuth) is a later phase.
  import { fade } from 'svelte/transition'
  import { invoke } from '@tauri-apps/api/core'
  import { openUrl } from '@tauri-apps/plugin-opener'
  import MessageSquare from 'lucide-svelte/icons/message-square'
  import X from 'lucide-svelte/icons/x'
  import Maximize2 from 'lucide-svelte/icons/maximize-2'
  import Minimize2 from 'lucide-svelte/icons/minimize-2'
  import ExternalLink from 'lucide-svelte/icons/external-link'
  import ArrowBigUp from 'lucide-svelte/icons/arrow-big-up'
  import { nowPlayingMedia, commentsOpen, gameMode } from '$lib/player/session'
  import { fetchDiscussion, defaultDiscussionPlatform, discussionExpanded, type DiscussionThread, type DiscussionComment, type ScriptEmbed } from '$lib/comments'
  import { warnBeforeThirdPartyLogin } from '$lib/deck/keyboard-warning'

  let threads = $state<DiscussionThread[]>([])
  let loading = $state(false)
  let filter = $state('All')
  let tacReload = $state(0)
  let tacReady = $state(false)
  let tacVerifying = $state(false)
  let tacTimedOut = $state(false)
  let tacPopup: Window | null = null
  let tacPopupPoll: number | undefined
  // Once the embed's source tab has been selected for this episode, its iframe stays mounted (hidden
  // via CSS) across tab switches, expand/dock toggles and panel close — remounting an iframe reboots
  // the whole third-party embed (script re-exec + every no-store API call again), which is seconds.
  let embedEverShown = $state(false)
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
    embedEverShown = false
    let cancelled = false
    let completed = false
    fetchDiscussion(np.media, np.episode).then((t) => {
      if (cancelled) return
      completed = true
      threads = t
      loading = false
      // Open on the preferred source if it's present (else the aggregated 'All' list).
      const want = $defaultDiscussionPlatform
      const lbl = want !== 'auto' ? platLabel(want) : 'All'
      filter = lbl !== 'All' && t.some((x) => x.source === lbl) ? lbl : 'All'
    })
    return () => {
      cancelled = true
      // If the panel closes before the initial request resolves, its result is intentionally ignored.
      // Let the same episode fetch again on reopen instead of treating that cancelled request as cached.
      if (!completed && loadedKey === key) loadedKey = ''
    }
  })

  // SDK platform slug → the badge/filter label (mirrors comments/index.ts).
  const platLabel = (p: string) => p === 'anilist' ? 'AniList' : p === 'mal' ? 'MAL' : p === 'youtube' ? 'YouTube' : p === 'animecommunity' ? 'Anime Community' : p === 'forum' ? 'Disqus' : p.charAt(0).toUpperCase() + p.slice(1)

  const sources = $derived([...new Set(threads.map((t) => t.source))])
  const sourceTabs = $derived(['All', ...sources])
  const shown = $derived(filter === 'All' ? threads : threads.filter((t) => t.source === filter))
  // The episode's embeddable thread (Disqus/forum/TAC), independent of the selected tab — the iframe
  // mounts once and is only *shown* when its source tab is selected (see embedActive below).
  const embedThread = $derived(threads.find((t) => t.embedUrl || t.scriptEmbed))
  const embedUrl = $derived(embedThread?.embedUrl)
  const ep = $derived($nowPlayingMedia?.episode)
  const TAC_ORIGIN = 'https://theanimecommunity.com'
  const TAC_WIDGET = `${TAC_ORIGIN}/embed-widget`
  const directTacEmbed = $derived(Boolean($gameMode && embedThread?.scriptEmbed))
  const tacWidgetSrc = $derived(`${TAC_WIDGET}?izumi_retry=${tacReload}`)
  // The provider requires at least one of these exact keys. Keep the SDK descriptor intact, but
  // source the IDs from the playing media as an authoritative fallback so a stale/partial SDK
  // thread can never boot TAC without its anime identity.
  const tacConfig = $derived.by(() => {
    const config: Record<string, string | number> = { ...(embedThread?.scriptEmbed?.config ?? {}) }
    const media = $nowPlayingMedia?.media
    if (!config.AniList_ID && media?.id) config.AniList_ID = media.id
    if (!config.MAL_ID && media?.idMal) config.MAL_ID = media.idMal
    return config
  })

  // A bare `https://disqus.com/embed/comments/?…` URL is the INNER iframe that Disqus' embed.js
  // creates — iframing it directly (no embed.js parent + our untrusted origin) renders blank. Instead
  // we point the iframe at our own same-origin loader page (static/disqus-embed.html), which runs
  // embed.js in a REAL document with no-referrer so Disqus mounts the comments. A real `forum`
  // embed_url is already a normal page → embed its URL directly. See static/disqus-embed.html.
  const isDisqusInner = (u?: string) => {
    if (!u) return false
    try { const x = new URL(u); return x.hostname === 'disqus.com' && x.pathname.startsWith('/embed/comments') }
    catch { return false }
  }
  const isDiscussAnimeEmbed = (u?: string) => {
    if (!u) return false
    try { const x = new URL(u); return x.hostname === 'discussanime.moe' && x.pathname.startsWith('/embed/') }
    catch { return false }
  }
  function disqusEmbedSrc(embed: string): string {
    const q = new URL(embed).searchParams
    const out = new URLSearchParams()
    for (const k of ['f', 't_i', 't_u', 't_t']) { const v = q.get(k); if (v != null) out.set(k, v) }
    return `/disqus-embed.html?${out.toString()}`
  }
  function withDark(url: string): string {
    // First-paint hint: the archive server-seeds .dq-archive[data-theme] from ?theme, so this darkens
    // the SSR HTML before JS runs. The live/authoritative signal is the postMessage below.
    try { const u = new URL(url); u.searchParams.set('theme', 'dark'); return u.toString() }
    catch { return url }
  }
  // A script embed (TAC) has no iframe URL — the SDK hands a scriptEmbed descriptor. Point the iframe
  // at our generic loader page (static/script-embed.html), which sets the config global + mounts the
  // provider's embed.js into its container. See static/script-embed.html.
  function scriptEmbedSrc(se: ScriptEmbed): string {
    const p = new URLSearchParams({
      src: se.scriptSrc, sid: se.scriptId, cid: se.containerId, cv: se.configVar, cfg: JSON.stringify(se.config),
    })
    return `/script-embed.html?${p.toString()}`
  }
  const embedSrc = $derived(
    embedThread?.scriptEmbed ? (directTacEmbed ? tacWidgetSrc : scriptEmbedSrc(embedThread.scriptEmbed))
      : !embedUrl ? undefined
        : isDisqusInner(embedUrl) ? disqusEmbedSrc(embedUrl)
          : withDark(embedUrl),
  )
  const archiveEmbed = $derived(isDiscussAnimeEmbed(embedUrl))
  // Visible only while its source tab is selected; mounted from the moment the thread list arrives so
  // URL embeds pre-boot in the background and the tab is warm on first click. Script embeds (TAC) wait
  // for first selection instead — loading TAC can kick off interactive Cloudflare verification.
  const embedActive = $derived(!loading && !!embedSrc && filter !== 'All' && embedThread?.source === filter)
  const embedMounted = $derived(!!embedSrc && (!embedThread?.scriptEmbed || embedEverShown))
  $effect(() => { if (embedActive) embedEverShown = true })
  // Note on the archive embed's dark mode: `.dq-archive` is dark-by-default and forced LIGHT only by
  // `@media (prefers-color-scheme: light)`. So the cross-origin lever is the WEBVIEW's color scheme —
  // forced dark in Rust (set_webview_dark → WebView2 SetPreferredColorScheme). The archive's own
  // postMessage theme channel is same-origin-only (rejects our origin), and ?theme (above) only helps
  // the SSR first paint, so neither is sufficient alone.

  // Reaction bridge: the Disqus loader page (same-origin) can't post reactions itself (CORS blocks
  // POST + it has no forum session), so it postMessages a request here. We post it through the native
  // `da_react` command — which reads the httpOnly `da_session` cookie from WebView2 + bypasses CORS —
  // and hand the authoritative counts back. `needsLogin` → run `da_login` (a discussanime OAuth window)
  // once, then retry. Non-Windows / no-session just returns needsLogin and nothing changes.
  let embedIframe = $state<HTMLIFrameElement>()
  let archiveScroller = $state<HTMLElement>()
  let listScroller = $state<HTMLElement>()
  let archiveHeight = $state<number | null>(null)
  function finishTacVerification() {
    if (tacPopupPoll != null) window.clearInterval(tacPopupPoll)
    tacPopupPoll = undefined
    tacVerifying = false
    tacTimedOut = false
    tacReady = false
    tacReload += 1
  }
  async function startTacVerification() {
    if (!$gameMode || tacVerifying) return
    if (!tacConfig.MAL_ID && !tacConfig.AniList_ID) {
      tacTimedOut = true
      return
    }
    tacVerifying = true
    tacTimedOut = false
    try {
      // Cloudflare navigates the first-party popup while verifying the browser. Store the exact
      // config natively before opening it so those navigations cannot discard the IDs.
      await invoke('set_tac_verification_config', { config: tacConfig })
    } catch (error) {
      console.warn('[izumi comments] could not prepare TAC verification:', error)
      tacVerifying = false
      tacTimedOut = true
      return
    }
    tacPopup = window.open(TAC_WIDGET, '_blank', 'popup,width=1200,height=760')
    if (!tacPopup) {
      tacVerifying = false
      tacTimedOut = true
      return
    }
    // The popup normally notifies us when TAC's real widget boots. Polling covers a user closing
    // it after manually completing the challenge, or a compositor which drops opener messaging.
    tacPopupPoll = window.setInterval(() => {
      if (!tacPopup?.closed) return
      finishTacVerification()
      tacPopup = null
    }, 250)
  }
  function selectSource(source: string) {
    filter = source
    if (source === 'Anime Community' && $gameMode && !tacReady) void startTacVerification()
  }
  const postTacConfig = () => {
    if (!directTacEmbed || !embedThread?.scriptEmbed) return
    embedIframe?.contentWindow?.postMessage({
      type: 'anime-community:init', config: tacConfig,
    }, TAC_ORIGIN)
  }
  // A new archive starts at the viewport height until it reports its actual content height.
  $effect(() => { void embedSrc; archiveHeight = null })
  $effect(() => {
    function onMsg(e: MessageEvent) {
      const m = e.data as { type?: string; base?: string; identifier?: string; key?: string | null; height?: number } | null
      if (e.origin === TAC_ORIGIN && m?.type === 'izumi-tac-verified') {
        if (tacPopupPoll != null) window.clearInterval(tacPopupPoll)
        tacPopupPoll = undefined
        tacPopup = null
        finishTacVerification()
        return
      }
      // On Deck, host TAC's official widget as the panel iframe itself instead of wrapping its
      // embed.js-created iframe. Complete the provider's documented ready/init handshake directly.
      if (directTacEmbed && e.origin === TAC_ORIGIN && e.source === embedIframe?.contentWindow
          && m?.type === 'anime-community:ready') {
        tacReady = true
        tacTimedOut = false
        tacVerifying = false
        postTacConfig()
        return
      }
      // The cross-origin discussanime archive deliberately hides its own overflow and sends its
      // content height to its host. Size that iframe to the content; the padded wrapper below scrolls.
      if (archiveEmbed && e.origin === 'https://discussanime.moe' && e.source === embedIframe?.contentWindow
          && m?.type === 'discussanime-archive-embed:resize') {
        const height = Number(m.height)
        if (Number.isFinite(height) && height > 0) archiveHeight = Math.min(height, 100_000)
        return
      }
      if (e.origin !== location.origin) return
      if (!m || !m.base || !m.identifier) return
      if (m.type === 'izumi-reaction-state') void handleReactionState(m.base, m.identifier)
      else if (m.type === 'izumi-react') void handleReact(m.base, m.identifier, m.key ?? null)
    }
    window.addEventListener('message', onMsg)
    return () => window.removeEventListener('message', onMsg)
  })
  // A Cloudflare interstitial never emits TAC's `ready` message. Replace the otherwise permanent
  // black frame with a recovery action that opens the first-party verification view.
  $effect(() => {
    void tacReload
    // Not mounted yet (TAC mounts on first tab selection) → no widget to time out on.
    if (!directTacEmbed || !embedMounted) { tacTimedOut = false; return }
    tacReady = false
    tacTimedOut = false
    const timer = window.setTimeout(() => { if (!tacReady) tacTimedOut = true }, 5_000)
    return () => window.clearTimeout(timer)
  })
  $effect(() => {
    if ($commentsOpen) return
    if (tacPopup && !tacPopup.closed) tacPopup.close()
    if (tacPopupPoll != null) window.clearInterval(tacPopupPoll)
    tacPopup = null
    tacPopupPoll = undefined
    tacVerifying = false
  })
  // Deck controller navigation: left/right switches the source pills immediately; up/down scrolls
  // whichever surface is visible. Same-origin loader frames scroll internally, while the cross-origin
  // discussanime archive scrolls in its sized parent wrapper.
  $effect(() => {
    if (!$commentsOpen) return
    function onNav(event: Event) {
      const dir = (event as CustomEvent<'up' | 'down' | 'left' | 'right'>).detail
      if (dir === 'left' || dir === 'right') {
        if (sourceTabs.length < 2) return
        const current = Math.max(0, sourceTabs.indexOf(filter))
        selectSource(sourceTabs[(current + (dir === 'right' ? 1 : -1) + sourceTabs.length) % sourceTabs.length])
        return
      }
      const amount = dir === 'down' ? 180 : -180
      // The embed's scroller stays bound while hidden on another tab — pick by what's visible.
      if (!embedActive) { listScroller?.scrollBy(0, amount); return }
      if (archiveScroller) { archiveScroller.scrollBy(0, amount); return }
      try { embedIframe?.contentWindow?.scrollBy(0, amount) } catch { /* Cross-origin uses archiveScroller. */ }
    }
    window.addEventListener('comments-nav', onNav)
    return () => window.removeEventListener('comments-nav', onNav)
  })
  async function handleReactionState(base: string, identifier: string) {
    try {
      const state = await invoke<{ counts?: unknown; selectedKey?: string | null }>('da_reaction_state', { base, identifier })
      embedIframe?.contentWindow?.postMessage({
        type: 'izumi-reaction-state-result', counts: state.counts, reaction: state.selectedKey ?? null,
      }, location.origin)
    }
    catch { /* Public counts still render; only authenticated highlighting is unavailable. */ }
  }
  async function handleReact(base: string, identifier: string, key: string | null) {
    const back = (ok: boolean, counts?: unknown) =>
      embedIframe?.contentWindow?.postMessage({ type: 'izumi-react-result', ok, counts, reaction: ok ? key : null }, location.origin)
    try {
      let res = await invoke<{ ok: boolean; needsLogin: boolean; counts: unknown }>('da_react', { base, identifier, key })
      if (res.needsLogin) {
        if (!(await warnBeforeThirdPartyLogin('DiscussAnime'))) { back(false); return }
        const signedIn = await invoke<boolean>('da_login', { base }).catch(() => false)
        if (!signedIn) { back(false); return }
        res = await invoke('da_react', { base, identifier, key })
      }
      back(res.ok, res.counts)
    }
    catch { back(false) }
  }

  // Tell the Disqus loader page which layout to use so its reactions strip switches between the compact
  // chips (side) and the big Hayami-style tiles (expanded). Posted on mode change + on iframe load.
  const postMode = () => embedIframe?.contentWindow?.postMessage({
    type: 'izumi-mode', expanded: $discussionExpanded, gameMode: $gameMode,
  }, location.origin)
  const postIframeState = () => { postMode(); postTacConfig() }
  $effect(() => { void $discussionExpanded; void $gameMode; void embedIframe; void embedThread; postIframeState() })

  const ago = (ms?: number) => {
    if (!ms) return ''
    const s = Math.floor((Date.now() - ms) / 1000)
    if (s < 3600) return `${Math.max(1, Math.floor(s / 60))}m`
    if (s < 86400) return `${Math.floor(s / 3600)}h`
    if (s < 2592000) return `${Math.floor(s / 86400)}d`
    return `${Math.floor(s / 2592000)}mo`
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

{#snippet panelBody()}
  <header class="flex items-center gap-2 border-b border-white/10 px-4 py-3">
    <MessageSquare size={18} class="text-theme" />
    <h2 class="flex items-baseline gap-1.5 text-sm font-black"><span>Discussion</span>{#if ep}<span class="font-semibold text-muted-foreground">· Ep {ep}</span>{/if}</h2>
    <div class="ml-auto flex items-center gap-1">
      <button data-focusable onclick={() => discussionExpanded.set(!$discussionExpanded)}
              aria-label={$discussionExpanded ? 'Dock to side' : 'Expand'}
              class="grid h-8 w-8 place-items-center rounded-md hover:bg-accent">
        {#if $discussionExpanded}<Minimize2 size={16} />{:else}<Maximize2 size={16} />{/if}
      </button>
      <button data-focusable onclick={() => commentsOpen.set(false)} aria-label="Close discussion"
              class="grid h-8 w-8 place-items-center rounded-md hover:bg-accent"><X size={18} /></button>
    </div>
  </header>

  {#if !loading && sources.length > 1}
    <div class="flex flex-wrap gap-1.5 border-b border-white/10 px-3 py-2">
      {#each sourceTabs as s (s)}
        <button data-focusable onclick={() => selectSource(s)}
                class="rounded-full px-2.5 py-0.5 text-xs font-bold transition-colors
                  {filter === s ? 'bg-primary text-primary-foreground' : 'bg-secondary text-muted-foreground hover:text-foreground'}">{s}</button>
      {/each}
    </div>
  {/if}

  {#if embedMounted}
    <!-- Embeddable source: our same-origin Disqus loader page (which renders its own reactions strip
         above the comments), or a forum's own embed page. onload posts the current mode so the loader
         styles its reactions compact (side) vs Hayami-tiles (expanded). Kept mounted (display:none)
         while other tabs are selected or the panel is closed — detaching an iframe reboots the embed
         from scratch, so it boots once per episode instead of on every tab switch/expand/reopen. -->
    {#if archiveEmbed}
      <div bind:this={archiveScroller} class={embedActive ? 'discussion-scrollbar min-h-0 flex-1 touch-pan-y overflow-y-auto overscroll-contain p-2.5' : 'hidden'}>
        <iframe title="Discussion" src={embedSrc} bind:this={embedIframe} scrolling="no"
                style:height={archiveHeight ? `${archiveHeight}px` : '100%'}
                class="block min-h-full w-full border-0"
                sandbox="allow-scripts allow-same-origin allow-popups allow-forms allow-popups-to-escape-sandbox"></iframe>
      </div>
    {:else}
      {#if directTacEmbed}
        <div class={embedActive ? 'relative min-h-0 flex-1' : 'hidden'}>
          <iframe title="Discussion" src={embedSrc} bind:this={embedIframe} onload={postIframeState} class="block h-full w-full border-0"
                  sandbox="allow-scripts allow-same-origin allow-popups allow-forms allow-popups-to-escape-sandbox"></iframe>
          {#if tacTimedOut && !tacReady}
            <div class="absolute inset-0 grid place-items-center bg-background px-6 text-center">
              <div>
                <p class="text-sm font-bold">Anime Community needs browser verification</p>
                <p class="mt-1 text-xs text-muted-foreground">Complete the short check, then you'll return to the official comments.</p>
                <button data-focusable disabled={tacVerifying} onclick={startTacVerification}
                        class="mt-3 rounded-md bg-primary px-3 py-1.5 text-xs font-bold text-primary-foreground disabled:opacity-50">
                  {tacVerifying ? 'Verifying…' : 'Verify and load'}
                </button>
              </div>
            </div>
          {/if}
        </div>
      {:else}
        <iframe title="Discussion" src={embedSrc} bind:this={embedIframe} onload={postIframeState}
                class="{embedActive ? 'block' : 'hidden'} min-h-0 w-full flex-1 border-0"
                sandbox="allow-scripts allow-same-origin allow-popups allow-forms allow-popups-to-escape-sandbox"></iframe>
      {/if}
    {/if}
  {/if}
  {#if !embedActive}
    <div bind:this={listScroller} class="flex-1 touch-pan-y overflow-y-auto overscroll-contain px-3 py-3">
      {#if loading}
        {#each Array.from({ length: 5 }) as _}<div class="mb-2 h-20 animate-pulse rounded-lg bg-muted"></div>{/each}
      {:else if !shown.length}
        <div class="grid h-full place-items-center px-6 text-center">
          <div>
            <p class="text-sm font-bold">No discussions found</p>
            <p class="mt-1 text-xs text-muted-foreground">No threads for this episode yet.</p>
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
{/snippet}

<!-- data-comments-panel: the player's overlay-tap handler ignores clicks originating in the panel (and
     the backdrop) so taps on pills/links/backdrop don't toggle play/pause. The window titlebar hides
     itself while the discussion is open — see Titlebar.svelte. -->
{#if $commentsOpen && $discussionExpanded}
  <!-- Expanded: clicking the backdrop closes the discussion; the panel is a separate, higher-level
       pointer target, so interaction inside it never reaches this handler. -->
  <!-- No backdrop-filter: the video behind is a separate native surface the webview compositor
       can't sample, so the blur only ever blurred transparent pixels — while forcing an expensive
       render surface that janked scrolling in the embed. The dim alone reads identically. -->
  <button type="button" data-comments-panel aria-label="Close discussion" transition:fade={{ duration: 150 }}
          onclick={() => commentsOpen.set(false)}
          class="absolute inset-0 z-40 bg-black/60"></button>
{/if}
<!-- Always mounted: open/close and docked/expanded are pure CSS state so the embed iframe inside is
     never reparented or destroyed (either reboots the third-party embed). Closed = visibility:hidden
     after the exit animation — no paint cost, and Deck nav's checkVisibility filter skips it. -->
<!-- OPAQUE bg + NO backdrop-blur: `backdrop-filter` on an ancestor of the embed iframe forces the
     whole panel subtree (incl. the cross-origin Disqus surface) through an intermediate texture +
     blur every scroll frame, off the direct compositing fast path — the main Windows scroll-jank
     source. And the blur bought nothing: behind the panel is the transparent video hole (mpv is a
     sibling native window the compositor can't sample). Opaque also restores blend-skipping.
     While the embed tab is showing in expanded mode, the rounded clip is dropped too — a rounded
     overflow clip intersecting the iframe surface forces another render surface (kRoundedCorner);
     the iframe's square bottom corners on the near-identical dark panel are imperceptible. -->
<div data-comments-panel inert={!$commentsOpen}
     class="dq-panel absolute z-40 flex flex-col border-white/10 bg-background text-foreground shadow-2xl
       {$discussionExpanded
         ? `inset-0 m-auto h-[85vh] w-[94vw] max-w-[920px] rounded-2xl border ${embedActive ? '' : 'overflow-hidden'}`
         : 'inset-y-0 right-0 w-full max-w-md border-l'}
       {$commentsOpen ? '' : $discussionExpanded ? 'dq-closed-pop' : 'dq-closed-slide'}">
  {@render panelBody()}
</div>

<style>
  /* The app hides scrollbars globally. The archive has to scroll in this parent because its
     cross-origin document auto-sizes with overflow hidden, so explicitly restore the Disqus look. */
  .discussion-scrollbar { scrollbar-width: thin; scrollbar-color: rgba(255, 255, 255, 0.16) transparent; }
  .discussion-scrollbar::-webkit-scrollbar { display: block; width: 8px; height: 8px; }
  .discussion-scrollbar::-webkit-scrollbar-track { background: transparent; }
  .discussion-scrollbar::-webkit-scrollbar-thumb { background: rgba(255, 255, 255, 0.16); border-radius: 8px; }
  .discussion-scrollbar::-webkit-scrollbar-thumb:hover { background: rgba(255, 255, 255, 0.28); }
  /* Open/close animates via classes (not {#if} transitions) so the panel — and the embed iframe in
     it — stays in the DOM. Visibility flips only after the exit transform/fade finishes. */
  .dq-panel { transition: transform 200ms ease, opacity 160ms ease, visibility 0s 0s; }
  .dq-closed-slide { visibility: hidden; transform: translateX(105%); transition: transform 200ms ease, opacity 160ms ease, visibility 0s 200ms; }
  .dq-closed-pop { visibility: hidden; opacity: 0; transform: scale(0.96); transition: transform 160ms ease, opacity 160ms ease, visibility 0s 160ms; }
</style>
