<script lang="ts">
  // Source picker: a banner-headed modal with a filter bar, Auto pill,
  // sort + quality dropdowns, and rich grouped result cards (release group,
  // cache/trust glyph, filename, size • seeders, colored badge row). Backed by our
  // debrid reality — ⚡ cached / ⬇ will-download / ✖ dead — with the best cached
  // source pinned. Season correctness is enforced upstream (verifySeason), so the
  // list here is already free of wrong-season files.
  import { onDestroy } from 'svelte'
  import { flip } from 'svelte/animate'
  import { fade } from 'svelte/transition'
  import { pushState } from '$app/navigation'
  import { streamPicker, gameMode, bingeSource, debridCaching, connecting, bumpPlayerOverlay } from '$lib/player/session'
  import { rankInfos, pickCandidates, preferDirectStartupCandidates, describe, qualityLabel, type StreamInfo } from '$lib/stremio/addon'
  import { isDead, markDead } from '$lib/stremio/dead-sources'
  import AddonLogo from './AddonLogo.svelte'
  import AndroidConnectionStatus from './AndroidConnectionStatus.svelte'
  import SourceLoader from './SourceLoader.svelte'
  import { scoreInfo } from '$lib/stremio/score'
  import { playStream, cancelResolve, commitResolveSelection, prefetchSourceMetadata, type PlayState } from '$lib/stremio/play'
  import { showDeadSources, preferredStreamSort, preferredQuality, preferredAudioLang, autoSelectSource, autoSelectCountdown, torrentPlaybackMode, debridKey, fullStreamDescription, seadexAnnotations, sourcePriority } from '$lib/settings/ui'
  import { debridProvider } from '$lib/settings/ui'
  import { cacheCheckMode } from '$lib/stremio/debrid'
  import { getSeadexEntry, bestHashes, isWebLink, matchSeadexStreams, type SeadexEntry, type SeadexRelease } from '$lib/stremio/seadex'
  import { autoCommitPhase, autoCommitProgress } from '$lib/components/player/auto-commit'
  import { openUrl } from '@tauri-apps/plugin-opener'
  import { providerProblems } from '$lib/stremio/onlinestream'
  import { rejectLabel } from '$lib/stremio/refine'
  import { title, banner, cover } from '$lib/anilist/media'
  import { isAndroid, isMobile } from '$lib/platform'
  import Search from '@lucide/svelte/icons/search'
  import Zap from '@lucide/svelte/icons/zap'
  import ArrowDownWideNarrow from '@lucide/svelte/icons/arrow-down-wide-narrow'
  import MonitorCog from '@lucide/svelte/icons/monitor-cog'
  import Copy from '@lucide/svelte/icons/copy'
  import Check from '@lucide/svelte/icons/check'
  import Play from '@lucide/svelte/icons/play'
  import Database from '@lucide/svelte/icons/database'
  import BadgeCheck from '@lucide/svelte/icons/badge-check'
  import { copyToClipboard } from '$lib/util/clipboard'

  const pick = $derived($streamPicker)
  const directP2p = $derived($torrentPlaybackMode === 'direct' || !$debridKey)
  const cacheCheck = $derived($debridKey ? cacheCheckMode($debridProvider) : 'none')

  // Curated best-release annotation. Loaded AFTER first paint and never awaited by the list or the
  // ranking, both of which run on `seadex === null` and simply re-rank and re-badge when (if) an
  // entry lands. A failure is indistinguishable from "no entry".
  //
  // The COUNTDOWN is the one exception: it commits, and a commit cannot be re-ranked afterwards, so
  // it holds briefly for an in-flight lookup rather than auto-playing a release the curators had
  // something to say about. See auto-commit.ts.
  let seadex = $state<SeadexEntry | null>(null)
  let seadexPending = $state(false)
  // The id, NOT `pick`, is what the load below may depend on. `pick` is a new object on every
  // progressive stream update, so an effect reading it directly would re-run (and blank the
  // annotation) each time an addon landed — a flickering badge and a re-ranking list mid-resolve.
  // A primitive derived only propagates when the title actually changes.
  const seadexId = $derived($seadexAnnotations ? pick?.media.id : undefined)
  $effect(() => {
    const anilistId = seadexId
    seadex = null
    seadexPending = false
    if (!anilistId) return
    // `seadex`/`seadexPending` are written but never read in here, so the writes cannot re-trigger
    // this effect. `live` drops a response that arrives after the picker moved to another title.
    let live = true
    seadexPending = true
    void getSeadexEntry(anilistId)
      .then((entry) => { if (live) seadex = entry })
      .finally(() => { if (live) seadexPending = false })
    return () => { live = false }
  })
  const seadexHashes = $derived(bestHashes(seadex))
  // Alternates (curated, but NOT the recommendation) are annotated too — quieter, and with no
  // ranking weight. Filtered-out rows are matched as well, and deliberately: a release the curators
  // rate best that our title/season heuristics threw away is the one case where seeing both badges
  // at once tells the user something true about OUR filtering.
  const seadexReleases = $derived(
    new Map(matchSeadexStreams(
      seadex,
      [...(pick?.streams ?? []), ...(pick?.rejected ?? []).map((r) => r.stream)],
    ).map((m) => [(m.stream.infoHash ?? '').toLowerCase(), m.release])),
  )
  const curatedOf = (info: StreamInfo) =>
    info.stream.infoHash ? seadexReleases.get(info.stream.infoHash.toLowerCase()) : undefined
  // Only worth a strip when it has something to SAY: plenty of entries carry releases and no prose.
  const seadexInfo = $derived(
    seadex && (seadex.notes || seadex.theoreticalBest || seadex.incomplete || seadex.comparisons.length)
      ? seadex
      : undefined,
  )
  let seadexOpen = $state(false)

  // Ranking inputs the ordering can't derive from a stream alone: the language the user asked to
  // hear, the group the previous episode of THIS title played from, and the curated recommendation.
  const rankOpts = $derived({
    audioLang: $preferredAudioLang,
    previousGroup: $bingeSource?.mediaId === pick?.media.id ? $bingeSource?.group : undefined,
    directP2p,
    seadexHashes,
    cacheCheck,
    sourcePriority: $sourcePriority,
  })
  const all = $derived(pick ? rankInfos(pick.streams, $preferredStreamSort, rankOpts) : ([] as StreamInfo[]))
  // Only DEAD rows are hidden behind the toggle. 'unknown' must stay visible: it is the default
  // state of every source-extension torrent, so filtering it would empty the picker outright for
  // anyone sourcing from extensions alone.
  const visible = $derived($showDeadSources ? all : all.filter((i) => i.cached !== 'down'))
  const uncachedCount = $derived(all.filter((i) => i.cached === 'uncached').length)
  const unknownCount = $derived(all.filter((i) => i.cached === 'unknown').length)
  const deadCount = $derived(all.filter((i) => i.cached === 'down').length)
  // What the addon itself wrote about this source. Torrentio-style addons put the release name and
  // metadata in `title`; Comet-style ones put it in `description` and emit no title at all. Falls
  // back to the parsed filename for rows that carry neither (direct-stream extension results).
  const descriptionOf = (i: StreamInfo) =>
    i.stream.title?.trim() || i.stream.description?.trim() || i.filename || i.label

  // Did the addon already state this in its own text? Matched on the MARKER, never on the value:
  // a naive body.includes('10') for a 10-seeder torrent also matches "1080p" and would silently
  // drop the chip on most rows.
  const statedSeeders = (body: string) => /[👤👥]|\bseeders?\b/iu.test(body)
  const statedSize = (body: string, label: string) => /💾/u.test(body) || body.includes(label)

  let filter = $state('')
  const shown = $derived(
    filter.trim()
      ? visible.filter((i) => [
          i.filename ?? i.label,
          // The addon's own text is on the row now, so it has to be searchable too — otherwise
          // filtering for a tracker or language the user can plainly see returns nothing.
          descriptionOf(i),
          i.server,
          i.addon,
          ...i.badges,
        ].filter(Boolean).join(' ').toLowerCase().includes(filter.trim().toLowerCase()))
      : visible,
  )
  const keyOf = (i: StreamInfo) => i.stream.url ?? i.stream.infoHash ?? i.label

  // The auto-pick order. This MUST go through the same ranking the non-interactive paths use
  // (play.ts), or the pill labelled "Auto" ignores the Quality setting entirely and just takes the
  // first cached row in the current sort order — picking a 2160p remux for someone who asked for
  // 720p. It already filters to `cached === 'instant'`, so the cached-only constraint is preserved.
  // Season correctness is enforced upstream (verifySeason), so no `want` is needed here.
  //
  // The whole ORDER, not just the winner: an automatic pick that fails to play now advances to the
  // next candidate instead of dead-ending, so one broken release no longer drops the user back to
  // choosing by hand — and, on a binge, no longer does it once per episode.
  // "Immediately" means the user has opted out of choosing at all: no countdown, no list. The
  // resolve screen stands in for the picker, the auto-pick may commit to an uncached source (every
  // torrent-extension row is uncached by construction, so it would otherwise never be eligible),
  // and a failure walks on instead of dropping them back to a list they asked not to see.
  const autoImmediate = $derived($autoSelectSource && !$autoSelectCountdown && !pick?.manualOnly && !pick?.continuationPending)
  // A manual click may intentionally wait for a rare release. Automatic mode has alternatives in
  // hand, so a dead hash gets a much smaller budget before the chain advances. Healthy candidates
  // in field traces return metadata in roughly 2–3s; eight seconds leaves room for a cold mobile
  // DHT while preventing a misleading tracker count from pinning the chain for 15s. The native
  // command still retains its 60-second default for manual choices.
  const AUTO_DIRECT_STARTUP_TIMEOUT_MS = 8_000
  let failedKeys = $state<string[]>([])
  const hasFailed = (s: StreamInfo['stream']) => failedKeys.includes(keyOf(describe(s))) || isDead(s)
  const rankedCandidates = $derived(pickCandidates(
    visible.map((i) => i.stream), $preferredQuality, undefined, hasFailed,
    { ...rankOpts, allowUncached: autoImmediate },
  ))
  const candidates = $derived(directP2p
    ? preferDirectStartupCandidates(rankedCandidates)
    : rankedCandidates)
  // Cap the chain: each attempt is a real resolve, and walking twenty broken sources in a row is
  // indistinguishable from a hang. Higher when the user opted out of choosing — a whole page of
  // releases blocked for the same legal reason is common, and giving up after three hands them
  // back the list they asked not to see.
  const AUTO_MAX_TRIES = $derived(autoImmediate ? (directP2p ? 4 : 8) : 3)
  let autoIdx = $state(0)
  const bestStream = $derived(candidates[autoIdx])
  const best = $derived(bestStream ? visible.find((i) => i.stream === bestStream) : undefined)
  // A pick that can't explain itself is indistinguishable from a random one. Strongest signals
  // first, and only the ones that actually moved it. Curation is named first and without a number:
  // it is a promotion applied to the score within one resolution, not a term inside it, so it has
  // no delta to sort by.
  const whyBest = $derived(
    best
      ? `Picked for: ${[
          // The ranking input, not the badge: an incomplete entry still badges its rows and still
          // must not claim to have decided anything.
          ...(seadexHashes.has((best.stream.infoHash ?? '').toLowerCase()) ? ['curated best release'] : []),
          ...scoreInfo(best, rankOpts).reasons
            .slice()
            .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
            .slice(0, 3)
            .map((r) => `${r.signal} (${r.delta > 0 ? '+' : ''}${r.delta})`),
        ].join(', ') || 'nothing else came close'}`
      : '',
  )

  // Skeleton while sources resolve; cap the rendered node count (One Piece can
  // return dozens of single-ep files even after collapsing batch packs).
  const resolving = $derived(!!pick?.resolving)
  const autoReady = $derived(!!pick?.autoReady)
  const RENDER_CAP = 40
  let showAll = $state(false)
  const renderedMain = $derived(showAll ? shown : shown.slice(0, RENDER_CAP))
  const hiddenCount = $derived(shown.length - renderedMain.length)

  // Online-provider variants grouped per site: every server/quality/flavour of one site is one
  // expandable card headed by its best-ranked variant. Torrent/debrid rows stay flat.
  const originKey = (i: StreamInfo) =>
    i.stream.__stream ? (i.stream.__origin?.id ?? i.stream.__origin?.name ?? i.addon ?? '') : ''
  interface RowGroup { head: StreamInfo; rest: StreamInfo[] }
  const groupedMain = $derived.by(() => {
    const groups = new Map<string, RowGroup>()
    const out: (StreamInfo | RowGroup)[] = []
    for (const i of renderedMain) {
      const key = originKey(i)
      if (!key) { out.push(i); continue }
      const g = groups.get(key)
      if (!g) { const ng = { head: i, rest: [] as StreamInfo[] }; groups.set(key, ng); out.push(ng) }
      else g.rest.push(i) // ranked order → head is the site's best variant
    }
    return out
  })
  const isGroup = (e: StreamInfo | RowGroup): e is RowGroup => 'head' in e
  const entryKey = (e: StreamInfo | RowGroup) => (isGroup(e) ? keyOf(e.head) : keyOf(e))
  let expandedGroups = $state<Set<string>>(new Set())
  function toggleGroup(key: string) {
    // Expanding a group IS interacting with the list — the countdown must not pick over the
    // user's head while they browse variants. (onfocus alone misses pointer clicks on WebKit.)
    cancelAuto()
    const n = new Set(expandedGroups)
    if (n.has(key)) n.delete(key)
    else n.add(key)
    expandedGroups = n
  }
  // A text filter that matched variants inside a collapsed group must not hide them.
  const forceExpand = $derived(!!filter.trim())
  // Game mode moves controller focus onto [data-best-source] the moment Best appears (the effect
  // below) — on the Deck a Best variant hidden inside a collapsed card would strand the d-pad on
  // nothing and point the "Picked for…" explanation at an invisible row. Derived, not state: the
  // group holding Best simply cannot render collapsed while it holds it (a Best HEAD needs no
  // expansion); user toggles still govern every other group.
  const groupHasBest = (g: RowGroup) => !!best && g.rest.includes(best)

  // Rows the title/production/season heuristics removed. Shown on request, APPENDED rather than
  // merged: they must never reach `best`, so a release we judged to be the wrong show can't become
  // the auto-pick just because the user wanted to see what was filtered.
  const rejected = $derived(pick?.rejected ?? [])
  let showFiltered = $state(false)
  // Deduped by the SAME key the {#each} is keyed on: refine dedupes rejections by its own row key,
  // which can disagree with this one for a row that carries neither a url nor an infoHash, and a
  // duplicate key crashes the keyed each block outright.
  const filteredInfos = $derived(
    showFiltered
      ? [...new Map(rejected.map((r) => describe(r.stream)).map((i) => [keyOf(i), i])).values()]
      : [],
  )
  const reasonOf = $derived(new Map(rejected.map((r) => [describe(r.stream), rejectLabel[r.reason]])))
  // Rejected rows keep their flat presentation, appended after the grouped main section.
  const rendered = $derived<(StreamInfo | RowGroup)[]>([...groupedMain, ...filteredInfos])

  // Backdrop for the resolve screen.
  const backdrop = $derived(pick ? (banner(pick.media) || cover(pick.media)) : '')
  let chosenLabel = $state('')
  /** Cancel in automatic mode is a real dismissal, not a route back into the same auto picker. */
  function cancelChoice() {
    close()
  }
  let busy = $state(false)
  let error = $state('')
  // The stream whose debrid resolve was refused for legal/content reasons (RD 451 etc). The block
  // is the service's, not the swarm's, so the error row offers a one-off direct-P2P retry of
  // exactly this stream. Set only together with `error`, cleared wherever `error` is.
  let blockedRetry = $state<StreamInfo | null>(null)
  const playbackError = $derived(error || pick?.playbackError || '')

  // Autoplay countdown: once the resolve reports a trustworthy pick, fill the Auto button then
  // play it. Cancelled by hovering/focusing the Auto button or by interacting (picking a source,
  // typing a filter). Shorter than it was because it now STARTS far earlier — it used to wait out
  // every source first, so the 5s sat on top of a ~9-25s resolve.
  const AUTO_MS = 2500
  let autoState = $state<'idle' | 'counting' | 'off'>('idle')
  let autoProgress = $state(0) // 0..1
  let autoTimer: ReturnType<typeof setInterval> | undefined
  let autoStart = 0
  function stopAutoTimer() { if (autoTimer) { clearInterval(autoTimer); autoTimer = undefined } }
  function cancelAuto() { stopAutoTimer(); if (autoState === 'counting') autoState = 'off'; autoProgress = 0 }
  function targetSource(info: StreamInfo) {
    cancelAuto()
    if (directP2p) void prefetchSourceMetadata(info.stream, 'targeted')
  }
  function focusSource(info: StreamInfo) {
    targetSource(info)
    if ($gameMode) bumpPlayerOverlay()
  }
  onDestroy(stopAutoTimer)

  // Reset per EPISODE only — NOT on every progressive stream update (which would keep
  // wiping the filter / restarting the countdown). Keyed by media+episode.
  let lastKey = ''
  $effect(() => {
    const k = pick ? `${pick.media.id}:${pick.episode}` : ''
    if (k !== lastKey) {
      lastKey = k
      busy = false; error = ''; blockedRetry = null; filter = ''; chosenLabel = ''; showAll = false; showFiltered = false; seadexOpen = false
      expandedGroups = new Set()
      stopAutoTimer(); autoState = 'idle'; autoProgress = 0
      autoIdx = 0; failedKeys = []
    }
  })

  // Game mode: each new picker opening starts on a playable row. This must reset per OPEN, not per
  // episode: Change source reopens the same episode, and the old episode-keyed latch left focus on
  // the removed settings button. The next Down then landed on Close/Copy instead of a source.
  let pickerFocusReady = false
  let pickerTrap = $state<HTMLElement | null>(null)
  // The source picker is lazy-loaded outside PlayerOverlay. On a cold open, the player's first
  // one-shot Gamescope snapshot can therefore happen while only the pending placeholder exists.
  // Re-snapshot once the real trap mounts, after WebKit has painted its card, regardless of whether
  // source rows have arrived yet. Later focus changes keep using the existing onfocusin bump.
  $effect(() => {
    const trap = pickerTrap
    if (!$gameMode || !trap) return
    let cancelled = false
    bumpPlayerOverlay()
    requestAnimationFrame(() => requestAnimationFrame(() => {
      if (!cancelled && trap.isConnected) bumpPlayerOverlay()
    }))
    const timer = setTimeout(() => {
      if (!cancelled && trap.isConnected) bumpPlayerOverlay()
    }, 120)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  })
  $effect(() => {
    const open = !!pick && !pick.hidden
    if (!open) {
      pickerFocusReady = false
      return
    }
    const trap = pickerTrap
    if (!$gameMode || pickerFocusReady || !rendered.length || !trap) return
    pickerFocusReady = true
    // The first playable row is the predictable controller landing target. Do not prefer the
    // asynchronously-ranked "Best" row: it can move while providers are still arriving, and a
    // document-wide query can accidentally see an unrelated/stale source surface. Two paints let
    // Svelte mount the keyed/transitioned row before focus, then a short reinforcement covers the
    // WebKitGTK paint in which gamescope first exposes the dialog.
    const focusFirst = () => {
      if (!trap.isConnected) return
      const target = trap.querySelector<HTMLElement>('[data-source-row]')
      if (!target) return
      target.focus({ preventScroll: true })
      target.closest<HTMLElement>('.sp-list')?.scrollTo({ top: 0, behavior: 'auto' })
    }
    requestAnimationFrame(() => {
      requestAnimationFrame(focusFirst)
      setTimeout(focusFirst, 80)
    })
  })

  // The countdown *wait* is the user's setting; the filling bar is motion, so it alone is dropped
  // when the OS asks for reduced motion (the numeric "Auto 3s" readout still counts down, and the
  // cancel window is preserved — previously reduced motion silently skipped straight to playback).
  const prefersReduce = typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
  const animate = $derived(!prefersReduce)

  // Start the countdown once the resolve says the pick is trustworthy + auto-select on. In
  // "immediately" mode, skip the wait entirely and pick right away.
  $effect(() => {
    // Only OUR OWN exhausted-chain error disarms the countdown. A failed binge continuation
    // (which arrives on the store) used to disarm it permanently too, which is precisely the
    // dead-end this chain exists to remove: the remembered release failing says nothing about
    // whether the best candidate would play.
    if (error) {
      cancelAuto()
      autoState = 'off'
      return
    }
    if (autoState === 'idle' && autoReady && !!best && !busy && $autoSelectSource && !pick?.manualOnly && !pick?.continuationPending) {
      if (!$autoSelectCountdown) { autoState = 'off'; autoBest(); return }
      autoState = 'counting'
      autoStart = performance.now()
      autoTimer = setInterval(() => {
        const elapsed = performance.now() - autoStart
        autoProgress = autoCommitProgress(elapsed, AUTO_MS)
        // 'holding': the bar has filled but the curated lookup is still out. Waiting a moment costs
        // the user nothing and is the difference between "Mark best releases" deciding the auto-pick
        // and it being a badge that arrives after playback started. Capped inside autoCommitPhase.
        const phase = autoCommitPhase({ elapsed, autoMs: AUTO_MS, curatedPending: seadexPending })
        if (phase === 'commit') { stopAutoTimer(); autoState = 'off'; autoBest() }
      }, 50)
    }
  })

  async function choose(info: StreamInfo, fromAuto = false) {
    cancelAuto()
    // A 'down' (0-seeder) row is still selectable — debrid may already hold it cached, or find
    // peers via the magnet's trackers. We dim it as a hint but never block the click; sinking a
    // mislabeled source (see extToStream/dedupe) to unclickable was the actual complaint.
    if (busy || !pick) return
    // Picking a source supersedes the in-flight resolve: stop it folding in more sources (and, for
    // an auto-advance picker, stop its same-release auto-continue from firing over this choice).
    commitResolveSelection()
    busy = true; error = ''; blockedRetry = null
    chosenLabel = info.filename ?? info.label ?? info.group ?? info.addon ?? ''
    streamPicker.update((current) => current ? { ...current, playbackError: undefined } : current)
    // An explicit tap is manual even when "auto-select immediately" is enabled. The automatic
    // picker still calls this with `fromAuto = true`; a retry chosen by the user gets the full
    // native metadata allowance instead of inheriting the short automatic-chain budget.
    const automatic = fromAuto
    await playStream(pick.media, pick.episode, info.stream, (s: PlayState) => {
      if (s.status === 'playing') streamPicker.set(null)
      else if (s.status === 'error') {
        busy = false
        // Only the AUTOMATIC path walks on. A source the user picked by hand deserves its error
        // shown, not a silent substitution — and must never be remembered as failed on their
        // behalf, since they may well want to retry it.
        if (fromAuto && advanceAuto(info)) return
        error = s.message ?? 'Playback failed.'
        blockedRetry = s.debridBlocked ? info : null
      }
      else if (s.status === 'idle') { busy = false } // caching canceled — re-enable the list
    }, {
      autoplay: pick.autoplay,
      directStartupTimeoutMs: automatic && directP2p ? AUTO_DIRECT_STARTUP_TIMEOUT_MS : undefined,
    })
  }
  /** Retry the debrid-blocked stream over the local P2P engine — one-off, mode setting untouched. */
  async function watchP2p() {
    const info = blockedRetry
    if (!info || busy || !pick) return
    cancelAuto()
    commitResolveSelection()
    busy = true; error = ''; blockedRetry = null
    chosenLabel = info.filename ?? info.label ?? info.group ?? info.addon ?? ''
    streamPicker.update((current) => current ? { ...current, playbackError: undefined } : current)
    await playStream(pick.media, pick.episode, info.stream, (s: PlayState) => {
      if (s.status === 'playing') streamPicker.set(null)
      else if (s.status === 'error') { busy = false; error = s.message ?? 'Playback failed.' }
      else if (s.status === 'idle') { busy = false }
    }, { autoplay: pick.autoplay, forceDirect: true })
  }
  /** Remember the failure and move to the next candidate. False when the chain is exhausted. */
  function advanceAuto(info: StreamInfo): boolean {
    markDead(info.stream)
    failedKeys = [...failedKeys, keyOf(info)]
    if (autoIdx + 1 >= Math.min(candidates.length, AUTO_MAX_TRIES)) return false
    autoIdx += 1
    // Same tick as the failure that cleared it, so Svelte coalesces both into one update and the
    // screen never blinks back to the list between two attempts.
    const next = candidates[autoIdx]
    if (next && pick) {
      const info = describe(next)
      connecting.set({
        title: title(pick.media),
        detail: info.filename ?? info.label,
        art: backdrop,
        media: pick.media,
        episode: pick.episode,
        cancel: () => { connecting.set(null); cancelResolve() },
      })
    }
    autoProgress = 0
    autoState = 'idle' // re-arms the countdown effect on the new best
    return true
  }
  function autoBest() {
    if (!pick || busy) return
    if (best) choose(best, true)
    else error = 'No cached source to auto-select.'
  }
  let copiedKey = $state<string | null>(null)
  function copyLink(e: MouseEvent, info: StreamInfo) {
    e.stopPropagation()
    // Prefer the resolved URL; for an uncached torrent copy a real magnet (pasteable into a client),
    // not the bare infoHash. Uses the webview-safe helper (navigator.clipboard is absent on the Deck).
    const link = info.stream.url ?? info.stream.__magnet ?? (info.stream.infoHash ? `magnet:?xt=urn:btih:${info.stream.infoHash}` : '')
    if (!link || !copyToClipboard(link)) return
    const k = keyOf(info)
    copiedKey = k
    setTimeout(() => { if (copiedKey === k) copiedKey = null }, 1200)
  }
  // Dismissal is always authoritative, including while automatic selection is resolving. Leaving
  // the picker mounted here caused its automatic effect to start again immediately after Cancel.
  function close() {
    cancelAuto()
    cancelResolve()
    connecting.set(null)
    busy = false
    error = ''
    streamPicker.set(null)
  }

  // Android's hardware Back arrives as webView.goBack() (WryActivity installs exactly that
  // callback), i.e. plain SPA history. With the picker open that paged the route UNDERNEATH
  // backwards while the picker stayed on screen — and on a launch with no history to go back to it
  // quit the app outright. Shallow routing gives Back an entry of ours to pop, so on this screen it
  // means "close this", like every other Android sheet.
  //
  // The guard is a primitive on purpose: `pick` is a new object on every progressive stream update
  // (see the seadex note above), so an effect depending on it would push one history entry per
  // addon that lands.
  const backTrapOpen = $derived($isMobile && !!pick && !pick.hidden)
  $effect(() => {
    if (!backTrapOpen) return
    let pushed = true
    pushState('', { sourcePicker: true })
    const onPop = () => { pushed = false; close() }
    window.addEventListener('popstate', onPop)
    return () => {
      window.removeEventListener('popstate', onPop)
      // Dismissed some other way (✕, a chosen source, Escape): drop our entry too, or the next
      // Back gets swallowed by a modal that is no longer there.
      if (pushed) history.back()
    }
  })

  const badgeClass = (b: string) =>
    /^(?:4K|1440p|1080p|720p|480p|360p|240p|SD)$/.test(b) ? 'bg-lime-500/15 text-lime-300'
    : /^(?:HEVC|AV1|H264|XviD|10bit|8bit)$/.test(b) ? 'bg-sky-500/15 text-sky-300'
    : /^(?:DV|HDR|HDR10\+)$/.test(b) ? 'bg-fuchsia-500/15 text-fuchsia-300'
    : /Audio|Multi/.test(b) ? 'bg-amber-500/15 text-amber-300'
    : b === 'Batch' ? 'bg-indigo-500/15 text-indigo-300'
    : /^(?:BluRay|WEB|WEB-DL|WEBRip|HDTV|DVD)$/.test(b) ? 'bg-rose-500/15 text-rose-300'
    : /^(?:HLS|MP4|CC \d+|HARDSUB)$/.test(b) ? 'bg-teal-500/15 text-teal-300'
    : b === 'DUB' ? 'bg-orange-500/15 text-orange-300'
    : b === 'SUB' ? 'bg-slate-500/20 text-slate-300'
    : 'bg-secondary text-muted-foreground'
  const seedClass = (n?: number) =>
    n == null ? 'text-muted-foreground' : n >= 20 ? 'text-green-400' : n < 5 ? 'text-red-400' : 'text-yellow-400'
  // Four honest states. A LIBRARY hit gets its own glyph and wording on purpose: it only proves
  // the torrent is already in THIS user's debrid account, not that the provider is holding it
  // cached for everyone — calling that "Cached" would overstate what we actually know.
  //
  // `w`/`pill` exist because the glyph column explains itself through a `title` tooltip, and a
  // touch screen has no hover: on mobile the single most important fact about a row was readable
  // only to someone who already knew what ✖ meant. Mobile drops the glyph column and states it.
  const cacheGlyph = (info: StreamInfo) =>
    info.cached === 'instant'
      ? (info.cacheSource === 'library'
          ? { i: '📁', w: 'In your library', cls: 'text-green-400', pill: 'bg-green-500/15 text-green-300', t: 'Already in your debrid library — instant play' }
          : { i: '⚡', w: 'Cached', cls: 'text-green-400', pill: 'bg-green-500/15 text-green-300', t: 'Cached — instant play' })
    : info.cached === 'unknown'
      ? { i: '?', w: 'Cache unknown', cls: 'text-muted-foreground', pill: 'bg-secondary text-muted-foreground', t: directP2p ? 'Cache state unknown — streams from peers' : "Cache state unknown — this provider can't be checked" }
    : info.cached === 'uncached'
      ? { i: '⬇', w: directP2p ? 'Direct P2P' : 'Will download', cls: 'text-amber-400', pill: 'bg-amber-500/15 text-amber-300', t: directP2p ? 'Direct P2P — streams from peers' : 'Not cached — will download to debrid' }
    : { i: '✖', w: directP2p ? 'No seeders' : 'Dead', cls: 'text-red-400', pill: 'bg-red-500/15 text-red-300', t: directP2p ? 'No reported seeders — direct playback may stall' : 'Dead — no seeders on debrid' }

  // Mobile control strip. The desktop bar is `flex-wrap` over seven controls of four different
  // heights — on a phone it wrapped into a four-row block of 13px checkboxes above the list it was
  // meant to filter. Mobile gets one uniform pill height in a single scrolling row instead, and the
  // three checkboxes become pressed-state toggles with a real touch target.
  const CHIP = 'flex h-9 shrink-0 items-center gap-1.5 rounded-full px-3.5 text-xs font-bold transition-colors'
  const CHIP_ON = 'bg-theme/20 text-theme'
  const CHIP_OFF = 'bg-secondary text-muted-foreground'
</script>

<!-- The row's qualifier badges. A snippet because they live on DIFFERENT LINES per platform: the
     heading row has ~300px on a phone once the logo, the 48px copy rail and the padding are taken
     out, and four uppercase chips on it truncated the release name — the one thing you are reading
     the row for — down to a few characters. Mobile lets them wrap in the meta row instead. -->
{#snippet qualifiers(curated: SeadexRelease | undefined, filteredAs: string | undefined, knownBad: boolean, batch: boolean)}
  {@const size = $isMobile ? 'text-[0.68rem]' : 'text-[0.6rem]'}
  {#if curated}
    <span
      class="shrink-0 rounded px-1.5 font-black uppercase {size} {curated.isBest ? 'bg-emerald-400/20 text-emerald-300' : 'bg-emerald-400/10 text-emerald-300/70'}"
      title="{curated.isBest ? 'Rated the best available release' : 'A curated alternative, not the top pick'} by releases.moe{curated.releaseGroup ? ` — ${curated.releaseGroup}` : ''}{curated.tracker ? ` on ${curated.tracker}` : ''}{curated.dualAudio ? ' · dual audio' : ''}"
    >{curated.isBest ? 'Best release' : 'Curated alt'}</span>
  {/if}
  {#if filteredAs}
    <span class="shrink-0 rounded bg-amber-400/20 px-1.5 font-black uppercase text-amber-300 {size}" title="Filtered out: {filteredAs}">{filteredAs}</span>
  {/if}
  {#if knownBad}
    <span class="shrink-0 rounded bg-red-400/20 px-1.5 font-black uppercase text-red-300 {size}" title="This source failed to play recently. Still selectable — it may have been a temporary failure.">Failed</span>
  {/if}
  {#if batch}<Database size={13} class="shrink-0 text-indigo-300" />{/if}
{/snippet}

<!-- One source row, used identically in every render position — flat rows, a group's head, its
     expanded variants, and the shown-on-request filtered rows. `inset` nudges a grouped sub-row
     right so it reads as belonging to the card above it. The flip animation is NOT in here: it
     must live on the immediate child of the outer keyed each. -->
{#snippet sourceRow(info: StreamInfo, inset: boolean)}
  {@const g = cacheGlyph(info)}
  {@const isBest = info === best}
  {@const disabled = busy}
  {@const filteredAs = reasonOf.get(info)}
  {@const knownBad = hasFailed(info.stream)}
  {@const body = descriptionOf(info)}
  {@const curated = curatedOf(info)}
  <!-- The row body and the copy action are SIBLINGS, not nested: a <button> inside a
       role="button" is ambiguous to a screen reader, and on a phone the 14px copy icon sat
       inline in the heading row — directly under the thumb aiming at the row, so a mis-tap
       copied a magnet instead of playing. Mobile moves it to a separated 48px rail. -->
  <div
    class="group flex items-stretch overflow-hidden rounded-xl border border-transparent bg-secondary/40 transition-colors {inset ? 'ml-4' : 'w-full'}"
    class:opacity-40={info.cached === 'down' || !!filteredAs || knownBad}
    class:!border-theme={isBest}
    class:!border-red-400={isBest && autoState === 'counting' && autoProgress > 0.4}
    class:animate-pulse={isBest && autoState === 'counting' && autoProgress > 0.4 && animate}
  >
  <div
    data-focusable
    data-source-row
    data-best-source={isBest ? '' : undefined}
    role="button"
    tabindex="0"
    aria-disabled={disabled}
    onclick={() => choose(info)}
    onpointerenter={() => targetSource(info)}
    onfocus={() => focusSource(info)}
    onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); choose(info) } }}
    class="flex min-w-0 flex-1 items-start gap-3 px-3 text-left transition-colors hover:bg-accent active:bg-accent focus-visible:bg-accent focus-visible:outline-none focus-visible:shadow-[inset_0_0_0_2px_white] {$isMobile ? 'py-3' : 'py-2.5'} {disabled ? 'cursor-not-allowed' : 'cursor-pointer'}"
  >
    <!-- Mobile has no hover, so this tooltip-only glyph told a touch user nothing. It states
         itself as a worded pill in the meta row down there instead, and the reclaimed ~30px
         goes to the release name — the scarcest thing on a 375px screen. -->
    {#if !$isMobile}
      <span class="mt-0.5 shrink-0 text-lg leading-none {g.cls}" title={g.t} aria-hidden="true">{g.i}</span>
    {/if}

    <span class="min-w-0 flex-1">
      <!-- heading row -->
      <span class="flex items-center gap-2">
        <AddonLogo logo={info.logo} name={info.addon ?? info.provider} id={info.stream.__origin?.id} size={20} />
        <span class="truncate text-base font-bold">{info.server ?? info.group ?? info.addon ?? info.provider ?? 'Source'}</span>
        {#if isBest}
          <span class="shrink-0 rounded bg-theme px-1.5 text-[0.6rem] font-black uppercase text-white" title={whyBest}>Best</span>
          {#if autoState === 'counting'}<span class="shrink-0 font-black tabular-nums text-theme" class:text-red-400={autoProgress > 0.4}>[{Math.ceil((1 - autoProgress) * AUTO_MS / 1000)}]</span>{/if}
        {/if}
        {#if !$isMobile}
          {@render qualifiers(curated, filteredAs, knownBad, !!info.batch)}
          <span class="ml-auto flex shrink-0 items-center gap-2">
            <!-- Unconditional. Suppressing the name whenever a logo EXISTED meant a logo that
                 failed to load left the row with a broken box and no name — no provenance at all. -->
            {#if info.addon}<span class="text-[0.65rem] font-semibold text-muted-foreground">{info.addon}</span>{/if}
            {#if !$gameMode}
              <button type="button" data-focusable onclick={(e) => copyLink(e, info)} title={copiedKey === keyOf(info) ? 'Copied!' : 'Copy link'} aria-label="Copy link" class="opacity-100 transition sm:opacity-0 sm:group-hover:opacity-100 {copiedKey === keyOf(info) ? '!opacity-100 text-green-400' : 'text-muted-foreground hover:text-foreground'}">{#if copiedKey === keyOf(info)}<Check size={14} />{:else}<Copy size={14} />{/if}</button>
              <Play size={14} class="text-muted-foreground opacity-100 transition sm:opacity-0 sm:group-hover:opacity-100" />
            {/if}
          </span>
        {/if}
      </span>

      <!-- Why the Best row won, on the row itself. Desktop hides this behind the badge's
           `title`; on touch that reasoning was simply unreachable. One row carries it. -->
      {#if isBest && $isMobile && whyBest}
        <span class="mt-1 block text-[0.75rem] font-semibold leading-snug text-theme">{whyBest}</span>
      {/if}

      <!-- The addon's OWN text, verbatim. It writes real detail in here — tracker, languages,
           per-file notes, its own formatting — and the row used to show a single parsed
           filename instead, discarding everything we hadn't explicitly extracted. -->
      <span
        class="mt-0.5 block whitespace-pre-line leading-snug text-muted-foreground {$isMobile ? 'text-[0.8rem]' : 'text-[0.72rem]'} {$fullStreamDescription ? '' : ($isMobile ? 'line-clamp-2' : 'line-clamp-3')}"
        title={body}
      >{body}</span>

      <!-- meta + badges. Seeders/size are suppressed when the addon already wrote them into
           the text above, so the row states each fact once. -->
      <span class="mt-1.5 flex flex-wrap items-center gap-x-2.5 gap-y-1 {$isMobile ? 'text-[0.75rem]' : 'text-[0.7rem]'}">
        {#if $isMobile}
          <span class="rounded px-1.5 py-0.5 font-bold {g.pill}">{g.i} {g.w}</span>
          {@render qualifiers(curated, filteredAs, knownBad, !!info.batch)}
        {/if}
        {#if info.provider}<span class="font-bold text-theme">{info.provider}</span>{/if}
        {#if info.cached === 'uncached' && !$isMobile}<span class="text-amber-400">{directP2p ? 'direct P2P' : 'will download'}</span>{/if}
        {#if info.seeders != null && !statedSeeders(body)}<span class={seedClass(info.seeders)}>👤 {info.seeders}</span>{/if}
        {#if info.sizeLabel && !statedSize(body, info.sizeLabel)}<span class="text-muted-foreground">💾 {info.sizeLabel}</span>{/if}
        {#each info.badges as b}
          <span
            class="rounded px-1.5 py-0.5 font-medium {badgeClass(b)}"
            title={/^(?:CC \d+|HARDSUB)$/.test(b) ? info.subtitleLabel : undefined}
          >{b}</span>
        {/each}
        <!-- Provenance, demoted to the end of the wrapping row: on desktop it sits in the
             heading's right gutter, which a phone doesn't have to spare. -->
        {#if $isMobile && info.addon}<span class="font-semibold text-muted-foreground/70">{info.addon}</span>{/if}
      </span>
    </span>
  </div>
  {#if $isMobile}
    <button type="button" data-focusable onclick={(e) => copyLink(e, info)} aria-label="Copy link"
            class="grid w-12 shrink-0 place-items-center border-l border-border/60 transition-colors active:bg-accent {copiedKey === keyOf(info) ? 'text-green-400' : 'text-muted-foreground'}">
      {#if copiedKey === keyOf(info)}<Check size={17} />{:else}<Copy size={17} />{/if}
    </button>
  {/if}
  </div>
{/snippet}

<!-- `hidden` renders nothing while the entry stays live: with a single configured source there is
     nothing to choose, but the resolve flow still needs the picker to exist to recognise its own
     request. Errors clear the flag, so a failure is never silent. -->
{#if pick && !pick.hidden}
  {#if $isAndroid && autoImmediate && !playbackError}
    <!-- The persistent Android watch page is mounted once by the app layout. An instant automatic
         selection is not a choice screen, so this local picker surface remains intentionally empty. -->
  {:else}
  <!-- No backdrop-blur in Game mode: this is a full-viewport filtered stacking context on the
       Deck's iGPU, and the spinner + the 50ms progress-width write INSIDE it re-dirty the region
       instead of letting WebKit cache one snapshot — at the exact moment the app is busiest
       resolving sources. Same call DebridCaching.svelte:22 already documents. -->
  <!-- Mobile is a full-screen dialog, not a centred card. A phone has no room for a floating
       3xl-wide panel with 1rem of backdrop showing on every side, and `85vh` ignores both the
       Android system bars and the IME. It also opens OVER the Android player (AndroidPlayer hides
       its whole shell while `streamPicker` is set), so it has to survive a ~360px-tall landscape
       viewport — hence the short-viewport rules in the style block. -->
  <div
    class="fixed inset-0 z-40 grid bg-black/70 {$isMobile ? '' : 'place-items-center p-4'}"
    class:backdrop-blur-sm={!$gameMode && !$isMobile}
    onclick={close}
    onkeydown={(e) => e.key === 'Escape' && close()}
    role="presentation"
  >
    <div bind:this={pickerTrap} data-nav-trap class="flex flex-col overflow-hidden bg-card shadow-2xl {$isMobile ? 'sp-mobile h-full w-full' : 'max-h-[85vh] w-full max-w-3xl rounded-2xl border border-border'}" onclick={(e) => e.stopPropagation()} onfocusin={() => $gameMode && bumpPlayerOverlay()} role="presentation">
      <!-- Banner-headed title (shrink-0 so a tall list never squeezes it) -->
      <div class="relative shrink-0 overflow-hidden border-b border-border">
        {#if banner(pick.media)}
          <img src={banner(pick.media)} alt="" class="absolute inset-0 h-full w-full object-cover opacity-30" />
          <div class="absolute inset-0 bg-gradient-to-t from-card via-card/70 to-card/30"></div>
        {/if}
        <div class="sp-head relative flex gap-3 {$isMobile ? 'items-center px-4 pb-3 pt-4' : 'min-h-[4.5rem] items-start px-5 pb-4 pt-5'}">
          {#if cover(pick.media)}
            <img src={cover(pick.media)} alt="" class="sp-cover shrink-0 rounded-md object-cover shadow-lg {$isMobile ? 'h-12 w-8' : 'h-16 w-11'}" />
          {/if}
          <div class="min-w-0 flex-1">
            <h2 class="sp-title font-black leading-tight drop-shadow {$isMobile ? 'line-clamp-1 text-base' : 'line-clamp-2 text-xl'}">{title(pick.media)}</h2>
            <p class="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
              {#if resolving}<span class="size-3 shrink-0 animate-spin rounded-full border-2 border-muted-foreground/30 border-t-muted-foreground"></span>Finding sources…{:else}{pick.cachedCount} cached{uncachedCount ? ` · ${uncachedCount} uncached` : ''}{unknownCount ? ` · ${unknownCount} unknown` : ''}{deadCount && $showDeadSources ? ` · ${deadCount} dead` : ''}{/if}
            </p>
          </div>
          <button data-focusable onclick={close} class="grid shrink-0 place-items-center bg-black/40 text-white/80 transition-colors hover:bg-black/60 hover:text-white {$isMobile ? 'size-11 rounded-full text-lg' : 'size-10 rounded-lg sm:size-8'}" aria-label="Close">✕</button>
        </div>
      </div>

      <!-- Controls — mobile: a full-width search + Auto row, then one scrolling strip of uniform
           pills. Deliberately NOT flex-wrap: every control being the same height is what stops the
           bar reading as debris, and a single horizontal strip costs one row instead of three. -->
      {#if $isMobile}
        <div class="sp-controls shrink-0 border-b border-border">
          <div class="sp-inset flex items-center gap-2 pt-2.5">
            <label class="flex h-11 min-w-0 flex-1 items-center gap-2 rounded-xl bg-secondary px-3">
              <Search size={16} class="shrink-0 text-muted-foreground" />
              <input bind:value={filter} oninput={cancelAuto} data-focusable placeholder="Filter sources…" class="w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground" />
            </label>
            <button data-focusable onclick={autoBest} disabled={busy || !best} onfocus={cancelAuto}
                    class="relative flex h-11 shrink-0 items-center overflow-hidden rounded-xl bg-theme/20 px-4 text-sm font-bold text-theme transition-colors disabled:opacity-40 {autoState === 'counting' ? 'ring-1 ring-theme' : ''}">
              {#if autoState === 'counting' && animate}
                <span class="absolute inset-y-0 left-0 bg-theme/40" style="width:{autoProgress * 100}%"></span>
              {/if}
              <span class="relative z-10 flex items-center gap-1.5">
                <Zap size={15} fill="currentColor" />
                {autoState === 'counting' ? `${Math.ceil((1 - autoProgress) * AUTO_MS / 1000)}s` : 'Auto'}
              </span>
            </button>
          </div>
          <!-- Scrollbars are hidden app-wide, so the strip signals itself by clipping the last pill
               at the edge rather than by a bar. Sort/Quality lead because they are the two that
               change what you see; the three toggles are occasional. -->
          <div class="sp-inset sp-chips flex items-center gap-2 overflow-x-auto overscroll-x-contain py-2.5">
            <label class="{CHIP} {CHIP_OFF}">
              <ArrowDownWideNarrow size={13} class="shrink-0" />
              <select data-focusable bind:value={$preferredStreamSort} aria-label="Sort within cache tier" class="bg-transparent font-bold text-foreground outline-none">
                <option value="quality">Quality</option>
                <option value="seeders">Seeders</option>
                <option value="size">Size</option>
              </select>
            </label>
            <label class="{CHIP} {CHIP_OFF}">
              <MonitorCog size={13} class="shrink-0" />
              <select data-focusable bind:value={$preferredQuality} aria-label="Quality the Auto pick targets" class="bg-transparent font-bold text-foreground outline-none">
                <option value="2160">4K</option>
                <option value="1080">1080p</option>
                <option value="720">720p</option>
                <option value="480">480p</option>
                <option value="any">Any</option>
              </select>
            </label>
            <button data-focusable aria-pressed={$showDeadSources} onclick={() => ($showDeadSources = !$showDeadSources)}
                    class="{CHIP} {$showDeadSources ? CHIP_ON : CHIP_OFF}">Dead{deadCount ? ` (${deadCount})` : ''}</button>
            <button data-focusable aria-pressed={$fullStreamDescription} onclick={() => ($fullStreamDescription = !$fullStreamDescription)}
                    class="{CHIP} {$fullStreamDescription ? CHIP_ON : CHIP_OFF}">Full text</button>
            {#if rejected.length}
              <button data-focusable aria-pressed={showFiltered} onclick={() => (showFiltered = !showFiltered)}
                      class="{CHIP} {showFiltered ? CHIP_ON : CHIP_OFF}">Filtered ({rejected.length})</button>
            {/if}
          </div>
        </div>
      {:else}
      <div class="flex shrink-0 flex-wrap items-center gap-2 border-b border-border px-4 py-2.5">
        <label class="flex min-w-48 flex-1 items-center gap-2 rounded-lg bg-secondary px-3 py-1.5">
          <Search size={15} class="shrink-0 text-muted-foreground" />
          <input bind:value={filter} oninput={cancelAuto} data-focusable placeholder="Filter sources…" class="w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground" />
        </label>
        <button data-focusable onclick={autoBest} disabled={busy || !best}
                onmouseenter={cancelAuto} onfocus={cancelAuto}
                class="relative flex items-center gap-1 overflow-hidden rounded-lg bg-theme/20 px-3 py-1.5 text-xs font-bold text-theme transition-colors hover:bg-theme/30 disabled:opacity-40 {autoState === 'counting' ? 'ring-1 ring-theme' : ''}">
          {#if autoState === 'counting' && animate}
            <span class="absolute inset-y-0 left-0 bg-theme/40" style="width:{autoProgress * 100}%"></span>
          {/if}
          <span class="relative z-10 flex items-center gap-1">
            <Zap size={14} fill="currentColor" />
            {autoState === 'counting' ? `Auto ${Math.ceil((1 - autoProgress) * AUTO_MS / 1000)}s` : 'Auto'}
          </span>
        </button>
        <label class="flex items-center gap-1 rounded-lg bg-secondary px-2 py-1.5 text-xs" title="Sort within cache tier">
          <ArrowDownWideNarrow size={14} class="text-muted-foreground" />
          <select data-focusable bind:value={$preferredStreamSort} class="bg-transparent outline-none">
            <option value="quality">Quality</option>
            <option value="seeders">Seeders</option>
            <option value="size">Size</option>
          </select>
        </label>
        <label class="flex items-center gap-1 rounded-lg bg-secondary px-2 py-1.5 text-xs" title="Quality Auto targets">
          <MonitorCog size={14} class="text-muted-foreground" />
          <select data-focusable bind:value={$preferredQuality} class="bg-transparent outline-none">
            <option value="2160">4K</option>
            <option value="1080">1080p</option>
            <option value="720">720p</option>
            <option value="480">480p</option>
            <option value="any">Any</option>
          </select>
        </label>
        <label class="flex cursor-pointer items-center gap-1 text-xs text-muted-foreground" title="Show dead sources">
          <input type="checkbox" bind:checked={$showDeadSources} data-focusable class="accent-theme" /> Dead
        </label>
        <label class="flex cursor-pointer items-center gap-1 text-xs text-muted-foreground" title="Show each addon's full description instead of the first few lines">
          <input type="checkbox" bind:checked={$fullStreamDescription} data-focusable class="accent-theme" /> Full text
        </label>
        {#if rejected.length}
          <label class="flex cursor-pointer items-center gap-1 text-xs text-muted-foreground" title="Show sources removed as the wrong title, production, season or an extra">
            <input type="checkbox" bind:checked={showFiltered} data-focusable class="accent-theme" /> Filtered ({rejected.length})
          </label>
        {/if}
      </div>
      {/if}

      <!-- What the curators actually said. Collapsed by default and scroll-capped when open: these
           notes run to paragraphs on well-documented titles, and the source list is what the modal
           is for. Rendered whether or not any listed release turned up in the list — "the best one
           is on a private tracker" is still the most useful thing we can say about a title. -->
      {#if seadexInfo}
        <div class="sp-inset shrink-0 border-b border-border bg-emerald-500/[0.06] px-4 py-2 text-xs">
          <button data-focusable onclick={() => (seadexOpen = !seadexOpen)} aria-expanded={seadexOpen}
                  class="flex w-full items-center gap-2 text-left {$isMobile ? 'min-h-10' : ''}">
            <BadgeCheck size={13} class="shrink-0 text-emerald-300" />
            <span class="shrink-0 font-bold text-emerald-300">Best-release notes</span>
            {#if seadexInfo.incomplete}
              <span class="shrink-0 rounded bg-amber-400/20 px-1.5 text-[0.6rem] font-black uppercase text-amber-300" title="The recommended release is missing episodes.">Incomplete</span>
            {/if}
            {#if !seadexOpen && seadexInfo.notes}
              <span class="min-w-0 flex-1 truncate text-muted-foreground">{seadexInfo.notes}</span>
            {/if}
            <span class="ml-auto shrink-0 text-muted-foreground">{seadexOpen ? '▴' : '▾'}</span>
          </button>
          {#if seadexOpen}
            <!-- Normalization already drops anything that is not an http(s) link; entries cached
                 before it did are re-checked here, because clicking one of these hands a string
                 from a third-party record to the OS opener. -->
            {@const comparisons = seadexInfo.comparisons.filter(isWebLink)}
            <div class="mt-1.5 max-h-40 overflow-y-auto pr-1">
              {#if seadexInfo.notes}
                <p class="whitespace-pre-line leading-snug text-muted-foreground">{seadexInfo.notes}</p>
              {/if}
              {#if seadexInfo.theoreticalBest}
                <p class="mt-1.5 text-muted-foreground"><span class="font-bold text-foreground">Theoretical best:</span> {seadexInfo.theoreticalBest} <span class="opacity-70">(does not exist yet)</span></p>
              {/if}
              {#if comparisons.length}
                <p class="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span class="font-bold text-foreground">Comparisons:</span>
                  {#each comparisons as url, i}
                    <button data-focusable onclick={() => openUrl(url)} class="font-bold text-theme underline-offset-2 hover:underline {$isMobile ? 'min-h-9 min-w-9 rounded-lg bg-secondary px-2' : ''}" title={url}>#{i + 1}</button>
                  {/each}
                </p>
              {/if}
            </div>
          {/if}
        </div>
      {/if}

      {#if playbackError}
        <p class="sp-inset shrink-0 border-b border-border bg-destructive/10 px-4 py-2 text-sm text-destructive">
          {playbackError}
          {#if blockedRetry}
            <!-- The one recovery from a debrid block. As an inline underline it was a ~14px-tall
                 target inside a wrapping paragraph; on mobile it gets its own row. -->
            <button data-focusable onclick={watchP2p}
                    class="{$isMobile ? 'mt-2 flex h-10 w-full items-center justify-center rounded-lg bg-destructive/20 font-bold active:bg-destructive/30' : 'ml-1 font-semibold underline underline-offset-2 transition-opacity hover:opacity-75'}">Watch this P2P?</button>
          {/if}
        </p>
      {/if}

      <!-- Results — reveal sources the instant each addon/extension lands;
           skeletons only until the FIRST results arrive. -->
      <div class="sp-list min-h-0 flex-1 space-y-1.5 overflow-y-auto overscroll-contain p-2.5">
        {#if resolving && rendered.length === 0}
          {#each Array(6) as _}
            <div class="flex items-start gap-3 rounded-xl bg-secondary/40 px-3 {$isMobile ? 'py-3' : 'py-2.5'}">
              <!-- Matches the real row: mobile has no glyph column, so a skeleton with one would
                   shift every line sideways the moment the first source lands. -->
              {#if !$isMobile}<div class="skeloader mt-0.5 size-5 shrink-0 rounded-full"></div>{/if}
              <div class="min-w-0 flex-1 space-y-2">
                <div class="skeloader h-4 w-1/3 rounded"></div>
                <div class="skeloader h-3 w-2/3 rounded"></div>
                <div class="skeloader h-3 w-1/2 rounded"></div>
              </div>
            </div>
          {/each}
        {:else}
        {#each rendered as entry (entryKey(entry))}
          <!-- The animated element: one per list entry, whether that entry is a flat row or a whole
               group. Its key is stable across the flat-row → group transition (a group is keyed by
               its head), so flip never sees a remove+insert for the same source. -->
          {@const grouped = isGroup(entry) && entry.rest.length > 0 ? entry : null}
          <div animate:flip={{ duration: resolving ? 0 : 220 }} in:fade={{ duration: 150 }}>
            {#if grouped}
              {@const gk = originKey(grouped.head)}
              {@const open = forceExpand || expandedGroups.has(gk) || groupHasBest(grouped)}
              <div class="space-y-1 rounded-xl border border-border/60 bg-secondary/20 p-1">
                {@render sourceRow(grouped.head, false)}
                <button data-focusable aria-expanded={open} onclick={() => toggleGroup(gk)} onfocus={cancelAuto}
                        class="flex w-full items-center justify-center gap-1.5 rounded-lg text-center font-semibold text-muted-foreground transition-colors hover:bg-accent hover:text-foreground active:bg-accent {$isMobile ? 'min-h-10 py-2 text-sm' : 'py-1.5 text-xs'}">
                  {grouped.rest.length} more from {grouped.head.addon ?? grouped.head.provider ?? 'this site'}
                  <span aria-hidden="true">{open ? '▴' : '▾'}</span>
                </button>
                {#if open}
                  {#each grouped.rest as sub (keyOf(sub))}
                    {@render sourceRow(sub, true)}
                  {/each}
                {/if}
              </div>
            {:else}
              {@render sourceRow(isGroup(entry) ? entry.head : entry, false)}
            {/if}
          </div>
        {/each}
        {#if resolving}
          <div class="flex items-center justify-center gap-2 py-2 text-xs text-muted-foreground">
            <span class="size-3 animate-spin rounded-full border-2 border-muted-foreground/30 border-t-muted-foreground"></span>
            Finding more sources…
          </div>
        {/if}
        {#if hiddenCount > 0}
          <button data-focusable onclick={() => (showAll = true)}
                  class="w-full rounded-xl border border-dashed border-border text-center font-semibold text-muted-foreground transition-colors hover:bg-accent hover:text-foreground active:bg-accent {$isMobile ? 'py-3.5 text-base' : 'py-2.5 text-sm'}">
            Show {hiddenCount} more source{hiddenCount === 1 ? '' : 's'}
          </button>
        {/if}
        {#if !shown.length}
          <p class="px-3 pb-3 pt-8 text-center text-sm text-muted-foreground">
            {filter.trim() ? 'No sources match your filter.' : deadCount && !$showDeadSources ? 'No sources — enable “Dead” to see uncached/dead torrents.' : 'No sources to show.'}
          </p>
        {/if}
        <!-- A provider that failed for a REASON says so, whether or not other providers found rows:
             a login-gated source is actionable, and an empty list alone reads as izumi being broken. -->
        {#if !resolving && $providerProblems.length}
          <div class="mx-3 mb-3 rounded-xl border border-border/70 bg-secondary/30 px-3 py-2.5 text-left">
            {#each $providerProblems as problem (problem.provider)}
              <p class="py-0.5 text-xs text-muted-foreground"><span class="font-bold text-amber-400">{problem.provider}</span> · {problem.message}</p>
            {/each}
          </div>
        {/if}
        {/if}
      </div>
    </div>
  </div>
  {/if}

  <!-- The gap between "you picked" and "video plays". It used to be dead air: the rows greyed out
       and nothing else happened until either the player or, after a grace period, the debrid
       caching screen appeared. On a slow resolve that read as a freeze. -->
  <!-- Hidden once the debrid screen takes over: that screen is opaque, so leaving the animation
       running behind it would burn a Lottie render loop nobody can see. -->
  <!-- Only the source-LIST phase: once a stream is chosen, playStream owns the connecting screen
       app-wide (SourceConnecting), so rendering it here too would stack two of them. -->
  {#if autoImmediate && resolving && !busy && !$connecting && !$debridCaching && !playbackError}
    {#if $isAndroid}
      <div transition:fade={{ duration: 100 }}>
        <AndroidConnectionStatus
          headline={directP2p ? 'Preparing playback' : 'Finding the best source'}
          detail={chosenLabel || `${title(pick.media)}${pick.episode != null ? ` · Episode ${pick.episode}` : ''}`}
          oncancel={cancelChoice}
        />
      </div>
    {:else}
    <div
      class="fixed inset-0 z-[55] grid place-items-center overflow-hidden bg-black"
      onclick={close}
      onkeydown={(e) => e.key === 'Escape' && close()}
      role="presentation"
      transition:fade={{ duration: $gameMode ? 0 : 160 }}
    >
      {#if backdrop}
        <!-- Desktop blurs this static image; Game mode removes the filter via loading-backdrop so
             the loader cannot trigger a full-screen filtered repaint on every frame. -->
        <img src={backdrop} alt="" class="loading-backdrop pointer-events-none absolute inset-0 h-full w-full scale-110 object-cover opacity-25 blur-2xl" />
      {/if}
      <button data-focusable onclick={(e) => { e.stopPropagation(); close() }} class="absolute z-10 grid place-items-center rounded-full bg-black/40 text-white/80 transition-colors hover:bg-black/60 hover:text-white {$isMobile ? 'right-[max(1rem,env(safe-area-inset-right))] top-[max(1rem,env(safe-area-inset-top))] size-11' : 'right-4 top-4 size-10'}" aria-label="Close">✕</button>
      <div class="relative" onclick={(e) => e.stopPropagation()} role="presentation">
        <SourceLoader
          title={pick ? title(pick.media) : ''}
          caption={directP2p ? 'Preparing download' : 'Connecting'}
          detail={chosenLabel}
          onCancel={cancelChoice}
        />
      </div>
    </div>
    {/if}
  {/if}
{/if}

<style>
  /* Mobile-only geometry, in CSS rather than Tailwind because two of its three inputs have no
     utility: the Android display cutout (`env()` inside `max()`, on four sides) and a SHORT
     viewport. Short means the picker was opened from the player's "Change source" — the phone is
     in landscape with ~360px of height, and the chrome has to give the list back what it can. */
  :global(.sp-mobile .sp-inset) {
    padding-left: max(1rem, env(safe-area-inset-left));
    padding-right: max(1rem, env(safe-area-inset-right));
  }
  /* Once the phone is rotated the cutout sits on a LONG edge — i.e. straight down the side of
     this list, not above it. Portrait resolves these to the plain fallback. */
  :global(.sp-mobile .sp-head) {
    padding-top: max(1rem, env(safe-area-inset-top));
    padding-left: max(1rem, env(safe-area-inset-left));
    padding-right: max(1rem, env(safe-area-inset-right));
  }
  :global(.sp-mobile .sp-list) {
    padding-left: max(0.625rem, env(safe-area-inset-left));
    padding-right: max(0.625rem, env(safe-area-inset-right));
    padding-bottom: max(0.75rem, env(safe-area-inset-bottom));
    touch-action: pan-y;
  }
  :global(.sp-mobile .sp-chips) { scrollbar-width: none; }
  @media (max-height: 560px) {
    :global(.sp-mobile .sp-cover) { display: none; }
    :global(.sp-mobile .sp-head) { padding-top: max(0.5rem, env(safe-area-inset-top)); padding-bottom: 0.5rem; }
    :global(.sp-mobile .sp-title) { font-size: 0.95rem; }
    :global(.sp-mobile .sp-controls .sp-inset) { padding-top: 0.4rem; padding-bottom: 0.4rem; }
  }
</style>
