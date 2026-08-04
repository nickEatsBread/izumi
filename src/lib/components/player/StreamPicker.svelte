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
  import { streamPicker, gameMode, bingeSource, debridCaching, connecting } from '$lib/player/session'
  import { rankInfos, pickCandidates, describe, qualityLabel, type StreamInfo } from '$lib/stremio/addon'
  import { isDead, markDead } from '$lib/stremio/dead-sources'
  import AddonLogo from './AddonLogo.svelte'
  import SourceLoader from './SourceLoader.svelte'
  import { scoreInfo } from '$lib/stremio/score'
  import { playStream, cancelResolve, type PlayState } from '$lib/stremio/play'
  import { showDeadSources, preferredStreamSort, preferredQuality, preferredAudioLang, autoSelectSource, autoSelectCountdown, torrentPlaybackMode, debridKey, fullStreamDescription, seadexAnnotations } from '$lib/settings/ui'
  import { debridProvider } from '$lib/settings/ui'
  import { cacheCheckMode } from '$lib/stremio/debrid'
  import { getSeadexEntry, bestHashes, isWebLink, matchSeadexStreams, type SeadexEntry } from '$lib/stremio/seadex'
  import { openUrl } from '@tauri-apps/plugin-opener'
  import { providerProblems } from '$lib/stremio/onlinestream'
  import { rejectLabel } from '$lib/stremio/refine'
  import { title, banner, cover } from '$lib/anilist/media'
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

  // Curated best-release annotation. Loaded AFTER first paint and never awaited by anything: the
  // list, the ranking and the countdown all run on `seadex === null`, and a matched entry simply
  // re-ranks and re-badges when (if) it lands. A failure is indistinguishable from "no entry".
  let seadex = $state<SeadexEntry | null>(null)
  // The id, NOT `pick`, is what the load below may depend on. `pick` is a new object on every
  // progressive stream update, so an effect reading it directly would re-run (and blank the
  // annotation) each time an addon landed — a flickering badge and a re-ranking list mid-resolve.
  // A primitive derived only propagates when the title actually changes.
  const seadexId = $derived($seadexAnnotations ? pick?.media.id : undefined)
  $effect(() => {
    const anilistId = seadexId
    seadex = null
    if (!anilistId) return
    // `seadex` is written but never read in here, so the write cannot re-trigger this effect.
    // `live` drops a response that arrives after the picker moved to another title.
    let live = true
    void getSeadexEntry(anilistId).then((entry) => { if (live) seadex = entry })
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
  const autoImmediate = $derived($autoSelectSource && !$autoSelectCountdown && !pick?.manualOnly)
  let failedKeys = $state<string[]>([])
  const hasFailed = (s: StreamInfo['stream']) => failedKeys.includes(keyOf(describe(s))) || isDead(s)
  const candidates = $derived(pickCandidates(
    visible.map((i) => i.stream), $preferredQuality, undefined, hasFailed,
    { ...rankOpts, allowUncached: autoImmediate },
  ))
  // Cap the chain: each attempt is a real resolve, and walking twenty broken sources in a row is
  // indistinguishable from a hang. Higher when the user opted out of choosing — a whole page of
  // releases blocked for the same legal reason is common, and giving up after three hands them
  // back the list they asked not to see.
  const AUTO_MAX_TRIES = $derived(autoImmediate ? 8 : 3)
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
  const rendered = $derived([...renderedMain, ...filteredInfos])

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
  onDestroy(stopAutoTimer)

  // Reset per EPISODE only — NOT on every progressive stream update (which would keep
  // wiping the filter / restarting the countdown). Keyed by media+episode.
  let lastKey = ''
  let focusedBest = false
  $effect(() => {
    const k = pick ? `${pick.media.id}:${pick.episode}` : ''
    if (k !== lastKey) {
      lastKey = k
      busy = false; error = ''; blockedRetry = null; filter = ''; chosenLabel = ''; showAll = false; showFiltered = false; seadexOpen = false
      stopAutoTimer(); autoState = 'idle'; autoProgress = 0
      autoIdx = 0; failedKeys = []
      focusedBest = false
    }
  })

  // Game mode: once the recommended (Best) source appears, move controller focus onto it so the
  // d-pad starts on the source you'll most likely pick and A selects it. Only once per open.
  $effect(() => {
    if (best && $gameMode && !focusedBest) {
      focusedBest = true
      requestAnimationFrame(() => document.querySelector<HTMLElement>('[data-best-source]')?.focus({ preventScroll: true }))
    }
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
    if (autoState === 'idle' && autoReady && !!best && !busy && $autoSelectSource && !pick?.manualOnly) {
      if (!$autoSelectCountdown) { autoState = 'off'; autoBest(); return }
      autoState = 'counting'
      autoStart = performance.now()
      autoTimer = setInterval(() => {
        autoProgress = Math.min(1, (performance.now() - autoStart) / AUTO_MS)
        if (autoProgress >= 1) { stopAutoTimer(); autoState = 'off'; autoBest() }
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
    cancelResolve()
    busy = true; error = ''; blockedRetry = null
    chosenLabel = info.filename ?? info.label ?? info.group ?? info.addon ?? ''
    streamPicker.update((current) => current ? { ...current, playbackError: undefined } : current)
    await playStream(pick.media, pick.episode, info.stream, (s: PlayState) => {
      if (s.status === 'playing') streamPicker.set(null)
      else if (s.status === 'error') {
        busy = false
        // Only the AUTOMATIC path walks on. A source the user picked by hand deserves its error
        // shown, not a silent substitution — and must never be remembered as failed on their
        // behalf, since they may well want to retry it.
        if ((fromAuto || autoImmediate) && advanceAuto(info)) return
        error = s.message ?? 'Playback failed.'
        blockedRetry = s.debridBlocked ? info : null
      }
      else if (s.status === 'idle') { busy = false } // caching canceled — re-enable the list
    }, { autoplay: pick.autoplay })
  }
  /** Retry the debrid-blocked stream over the local P2P engine — one-off, mode setting untouched. */
  async function watchP2p() {
    const info = blockedRetry
    if (!info || busy || !pick) return
    cancelAuto()
    cancelResolve()
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
  const cacheGlyph = (info: StreamInfo) =>
    info.cached === 'instant'
      ? (info.cacheSource === 'library'
          ? { i: '📁', cls: 'text-green-400', t: 'Already in your debrid library — instant play' }
          : { i: '⚡', cls: 'text-green-400', t: 'Cached — instant play' })
    : info.cached === 'unknown'
      ? { i: '?', cls: 'text-muted-foreground', t: directP2p ? 'Cache state unknown — streams from peers' : "Cache state unknown — this provider can't be checked" }
    : info.cached === 'uncached'
      ? { i: '⬇', cls: 'text-amber-400', t: directP2p ? 'Direct P2P — streams from peers' : 'Not cached — will download to debrid' }
    : { i: '✖', cls: 'text-red-400', t: directP2p ? 'No reported seeders — direct playback may stall' : 'Dead — no seeders on debrid' }
</script>

<!-- `hidden` renders nothing while the entry stays live: with a single configured source there is
     nothing to choose, but the resolve flow still needs the picker to exist to recognise its own
     request. Errors clear the flag, so a failure is never silent. -->
{#if pick && !pick.hidden}
  <!-- No backdrop-blur in Game mode: this is a full-viewport filtered stacking context on the
       Deck's iGPU, and the spinner + the 50ms progress-width write INSIDE it re-dirty the region
       instead of letting WebKit cache one snapshot — at the exact moment the app is busiest
       resolving sources. Same call DebridCaching.svelte:22 already documents. -->
  <div
    class="fixed inset-0 z-40 grid place-items-center bg-black/70 p-4"
    class:backdrop-blur-sm={!$gameMode}
    onclick={close}
    onkeydown={(e) => e.key === 'Escape' && close()}
    role="presentation"
  >
    <div data-nav-trap class="flex max-h-[85vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-2xl" onclick={(e) => e.stopPropagation()} role="presentation">
      <!-- Banner-headed title (shrink-0 so a tall list never squeezes it) -->
      <div class="relative shrink-0 overflow-hidden border-b border-border">
        {#if banner(pick.media)}
          <img src={banner(pick.media)} alt="" class="absolute inset-0 h-full w-full object-cover opacity-30" />
          <div class="absolute inset-0 bg-gradient-to-t from-card via-card/70 to-card/30"></div>
        {/if}
        <div class="relative flex min-h-[4.5rem] items-start gap-3 px-5 pb-4 pt-5">
          {#if cover(pick.media)}
            <img src={cover(pick.media)} alt="" class="h-16 w-11 shrink-0 rounded-md object-cover shadow-lg" />
          {/if}
          <div class="min-w-0 flex-1">
            <h2 class="line-clamp-2 text-xl font-black leading-tight drop-shadow">{title(pick.media)}</h2>
            <p class="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
              {#if resolving}<span class="size-3 shrink-0 animate-spin rounded-full border-2 border-muted-foreground/30 border-t-muted-foreground"></span>Finding sources…{:else}{pick.cachedCount} cached{uncachedCount ? ` · ${uncachedCount} uncached` : ''}{unknownCount ? ` · ${unknownCount} unknown` : ''}{deadCount && $showDeadSources ? ` · ${deadCount} dead` : ''}{/if}
            </p>
          </div>
          <button data-focusable onclick={close} class="grid size-10 shrink-0 place-items-center rounded-lg bg-black/40 text-white/80 transition-colors hover:bg-black/60 hover:text-white sm:size-8" aria-label="Close">✕</button>
        </div>
      </div>

      <!-- Controls -->
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

      <!-- What the curators actually said. Collapsed by default and scroll-capped when open: these
           notes run to paragraphs on well-documented titles, and the source list is what the modal
           is for. Rendered whether or not any listed release turned up in the list — "the best one
           is on a private tracker" is still the most useful thing we can say about a title. -->
      {#if seadexInfo}
        <div class="shrink-0 border-b border-border bg-emerald-500/[0.06] px-4 py-2 text-xs">
          <button data-focusable onclick={() => (seadexOpen = !seadexOpen)} aria-expanded={seadexOpen}
                  class="flex w-full items-center gap-2 text-left">
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
                    <button data-focusable onclick={() => openUrl(url)} class="text-theme underline-offset-2 hover:underline" title={url}>#{i + 1}</button>
                  {/each}
                </p>
              {/if}
            </div>
          {/if}
        </div>
      {/if}

      {#if playbackError}
        <p class="border-b border-border bg-destructive/10 px-4 py-2 text-sm text-destructive">
          {playbackError}
          {#if blockedRetry}
            <button data-focusable onclick={watchP2p}
                    class="ml-1 font-semibold underline underline-offset-2 transition-opacity hover:opacity-75">Watch this P2P?</button>
          {/if}
        </p>
      {/if}

      <!-- Results — reveal sources the instant each addon/extension lands;
           skeletons only until the FIRST results arrive. -->
      <div class="min-h-0 flex-1 space-y-1.5 overflow-y-auto p-2.5">
        {#if resolving && rendered.length === 0}
          {#each Array(6) as _}
            <div class="flex items-start gap-3 rounded-xl bg-secondary/40 px-3 py-2.5">
              <div class="skeloader mt-0.5 size-5 shrink-0 rounded-full"></div>
              <div class="min-w-0 flex-1 space-y-2">
                <div class="skeloader h-4 w-1/3 rounded"></div>
                <div class="skeloader h-3 w-2/3 rounded"></div>
                <div class="skeloader h-3 w-1/2 rounded"></div>
              </div>
            </div>
          {/each}
        {:else}
        {#each rendered as info (keyOf(info))}
          {@const g = cacheGlyph(info)}
          {@const isBest = info === best}
          {@const disabled = busy}
          {@const filteredAs = reasonOf.get(info)}
          {@const knownBad = hasFailed(info.stream)}
          {@const body = descriptionOf(info)}
          {@const curated = curatedOf(info)}
          <div
            data-focusable
            data-best-source={isBest ? '' : undefined}
            role="button"
            tabindex="0"
            aria-disabled={disabled}
            onclick={() => choose(info)}
            onpointerenter={cancelAuto}
            onfocus={cancelAuto}
            onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); choose(info) } }}
            class="group flex w-full items-start gap-3 rounded-xl border border-transparent bg-secondary/40 px-3 py-2.5 text-left transition-colors hover:bg-accent {disabled ? 'cursor-not-allowed' : 'cursor-pointer'}"
            class:opacity-40={info.cached === 'down' || !!filteredAs || knownBad}
            class:!border-theme={isBest}
            class:!border-red-400={isBest && autoState === 'counting' && autoProgress > 0.4}
            class:animate-pulse={isBest && autoState === 'counting' && autoProgress > 0.4 && animate}
            animate:flip={{ duration: resolving ? 0 : 220 }}
            in:fade={{ duration: 150 }}
          >
            <span class="mt-0.5 shrink-0 text-lg leading-none {g.cls}" title={g.t} aria-hidden="true">{g.i}</span>

            <span class="min-w-0 flex-1">
              <!-- heading row -->
              <span class="flex items-center gap-2">
                <AddonLogo logo={info.logo} name={info.addon ?? info.provider} id={info.stream.__origin?.id} size={20} />
                <span class="truncate text-base font-bold">{info.server ?? info.group ?? info.addon ?? info.provider ?? 'Source'}</span>
                {#if isBest}
                  <span class="shrink-0 rounded bg-theme px-1.5 text-[0.6rem] font-black uppercase text-white" title={whyBest}>Best</span>
                  {#if autoState === 'counting'}<span class="shrink-0 font-black tabular-nums text-theme" class:text-red-400={autoProgress > 0.4}>[{Math.ceil((1 - autoProgress) * AUTO_MS / 1000)}]</span>{/if}
                {/if}
                {#if curated}
                  <span
                    class="shrink-0 rounded px-1.5 text-[0.6rem] font-black uppercase {curated.isBest ? 'bg-emerald-400/20 text-emerald-300' : 'bg-emerald-400/10 text-emerald-300/70'}"
                    title="{curated.isBest ? 'Rated the best available release' : 'A curated alternative, not the top pick'} by releases.moe{curated.releaseGroup ? ` — ${curated.releaseGroup}` : ''}{curated.tracker ? ` on ${curated.tracker}` : ''}{curated.dualAudio ? ' · dual audio' : ''}"
                  >{curated.isBest ? 'Best release' : 'Curated alt'}</span>
                {/if}
                {#if filteredAs}
                  <span class="shrink-0 rounded bg-amber-400/20 px-1.5 text-[0.6rem] font-black uppercase text-amber-300" title="Filtered out: {filteredAs}">{filteredAs}</span>
                {/if}
                {#if knownBad}
                  <span class="shrink-0 rounded bg-red-400/20 px-1.5 text-[0.6rem] font-black uppercase text-red-300" title="This source failed to play recently. Still selectable — it may have been a temporary failure.">Failed</span>
                {/if}
                {#if info.batch}<Database size={13} class="shrink-0 text-indigo-300" />{/if}
                <span class="ml-auto flex shrink-0 items-center gap-2">
                  <!-- Unconditional. Suppressing the name whenever a logo EXISTED meant a logo that
                       failed to load left the row with a broken box and no name — no provenance at all. -->
                  {#if info.addon}<span class="text-[0.65rem] font-semibold text-muted-foreground">{info.addon}</span>{/if}
                  <button type="button" data-focusable onclick={(e) => copyLink(e, info)} title={copiedKey === keyOf(info) ? 'Copied!' : 'Copy link'} aria-label="Copy link" class="opacity-100 transition sm:opacity-0 sm:group-hover:opacity-100 {copiedKey === keyOf(info) ? '!opacity-100 text-green-400' : 'text-muted-foreground hover:text-foreground'}">{#if copiedKey === keyOf(info)}<Check size={14} />{:else}<Copy size={14} />{/if}</button>
                  <Play size={14} class="text-muted-foreground opacity-100 transition sm:opacity-0 sm:group-hover:opacity-100" />
                </span>
              </span>

              <!-- The addon's OWN text, verbatim. It writes real detail in here — tracker, languages,
                   per-file notes, its own formatting — and the row used to show a single parsed
                   filename instead, discarding everything we hadn't explicitly extracted. -->
              <span
                class="mt-0.5 block whitespace-pre-line text-[0.72rem] leading-snug text-muted-foreground {$fullStreamDescription ? '' : 'line-clamp-3'}"
                title={body}
              >{body}</span>

              <!-- meta + badges. Seeders/size are suppressed when the addon already wrote them into
                   the text above, so the row states each fact once. -->
              <span class="mt-1.5 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[0.7rem]">
                {#if info.provider}<span class="font-bold text-theme">{info.provider}</span>{/if}
                {#if info.cached === 'uncached'}<span class="text-amber-400">{directP2p ? 'direct P2P' : 'will download'}</span>{/if}
                {#if info.seeders != null && !statedSeeders(body)}<span class={seedClass(info.seeders)}>👤 {info.seeders}</span>{/if}
                {#if info.sizeLabel && !statedSize(body, info.sizeLabel)}<span class="text-muted-foreground">💾 {info.sizeLabel}</span>{/if}
                {#each info.badges as b}
                  <span
                    class="rounded px-1.5 py-0.5 font-medium {badgeClass(b)}"
                    title={/^(?:CC \d+|HARDSUB)$/.test(b) ? info.subtitleLabel : undefined}
                  >{b}</span>
                {/each}
              </span>
            </span>
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
                  class="w-full rounded-xl border border-dashed border-border py-2.5 text-center text-sm font-semibold text-muted-foreground transition-colors hover:bg-accent hover:text-foreground">
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

  <!-- The gap between "you picked" and "video plays". It used to be dead air: the rows greyed out
       and nothing else happened until either the player or, after a grace period, the debrid
       caching screen appeared. On a slow resolve that read as a freeze. -->
  <!-- Hidden once the debrid screen takes over: that screen is opaque, so leaving the animation
       running behind it would burn a Lottie render loop nobody can see. -->
  <!-- Only the source-LIST phase: once a stream is chosen, playStream owns the connecting screen
       app-wide (SourceConnecting), so rendering it here too would stack two of them. -->
  {#if autoImmediate && resolving && !busy && !$connecting && !$debridCaching && !playbackError}
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
      <button data-focusable onclick={(e) => { e.stopPropagation(); close() }} class="absolute right-4 top-4 z-10 grid size-10 place-items-center rounded-full bg-black/40 text-white/80 transition-colors hover:bg-black/60 hover:text-white" aria-label="Close">✕</button>
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
