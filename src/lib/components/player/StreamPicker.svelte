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
  import { streamPicker, gameMode } from '$lib/player/session'
  import { rankInfos, pickBest, describe, qualityLabel, type StreamInfo } from '$lib/stremio/addon'
  import { playStream, type PlayState } from '$lib/stremio/play'
  import { showDeadSources, preferredStreamSort, preferredQuality, autoSelectSource } from '$lib/settings/ui'
  import { title, banner, cover } from '$lib/anilist/media'
  import Search from 'lucide-svelte/icons/search'
  import Zap from 'lucide-svelte/icons/zap'
  import ArrowDownWideNarrow from 'lucide-svelte/icons/arrow-down-wide-narrow'
  import MonitorCog from 'lucide-svelte/icons/monitor-cog'
  import Copy from 'lucide-svelte/icons/copy'
  import Check from 'lucide-svelte/icons/check'
  import Play from 'lucide-svelte/icons/play'
  import Database from 'lucide-svelte/icons/database'
  import { copyToClipboard } from '$lib/util/clipboard'

  const pick = $derived($streamPicker)
  const all = $derived(pick ? rankInfos(pick.streams, $preferredStreamSort) : ([] as StreamInfo[]))
  const visible = $derived($showDeadSources ? all : all.filter((i) => i.cached !== 'down'))
  const uncachedCount = $derived(all.filter((i) => i.cached === 'uncached').length)
  const deadCount = $derived(all.filter((i) => i.cached === 'down').length)

  let filter = $state('')
  const shown = $derived(
    filter.trim()
      ? visible.filter((i) => (i.filename ?? i.label).toLowerCase().includes(filter.trim().toLowerCase()))
      : visible,
  )
  // The best cached source == the auto pick; pin + ring it.
  const best = $derived(visible.find((i) => i.cached === 'instant'))
  const keyOf = (i: StreamInfo) => i.stream.url ?? i.stream.infoHash ?? i.label

  // Skeleton while sources resolve; cap the rendered node count (One Piece can
  // return dozens of single-ep files even after collapsing batch packs).
  const resolving = $derived(!!pick?.resolving)
  const RENDER_CAP = 40
  let showAll = $state(false)
  const rendered = $derived(showAll ? shown : shown.slice(0, RENDER_CAP))
  const hiddenCount = $derived(shown.length - rendered.length)
  // Addon logo (URL) or extension icon (base64/url/data:) — one dual-scheme rule.
  const logoSrc = (l: string) =>
    l.startsWith('http') || l.startsWith('data:image') ? l : `data:image/png;base64,${l}`

  let busy = $state(false)
  let error = $state('')

  // Autoplay countdown: once sources settle with a best cached pick,
  // fill the Auto button over 5s then play it. Cancelled by hovering/focusing the
  // Auto button or by interacting (picking a source, typing a filter).
  const AUTO_MS = 5000
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
      busy = false; error = ''; filter = ''; showAll = false
      stopAutoTimer(); autoState = 'idle'; autoProgress = 0
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

  // Start the countdown once resolving finishes with a best cached pick + auto-select on.
  $effect(() => {
    if (autoState === 'idle' && !resolving && !!best && !busy && $autoSelectSource) {
      autoState = 'counting'
      autoStart = performance.now()
      autoTimer = setInterval(() => {
        autoProgress = Math.min(1, (performance.now() - autoStart) / AUTO_MS)
        if (autoProgress >= 1) { stopAutoTimer(); autoState = 'off'; autoBest() }
      }, 50)
    }
  })

  async function choose(info: StreamInfo) {
    cancelAuto()
    if (busy || !pick || info.cached === 'down') return
    busy = true; error = ''
    await playStream(pick.media, pick.episode, info.stream, (s: PlayState) => {
      if (s.status === 'playing') streamPicker.set(null)
      else if (s.status === 'error') { error = s.message ?? 'Playback failed.'; busy = false }
    })
  }
  function autoBest() {
    if (!pick || busy) return
    if (best) choose(best)
    else error = 'No cached source to auto-select.'
  }
  let copiedKey = $state<string | null>(null)
  function copyLink(e: MouseEvent, info: StreamInfo) {
    e.stopPropagation()
    // Prefer the resolved URL; for an uncached torrent copy a real magnet (pasteable into a client),
    // not the bare infoHash. Uses the webview-safe helper (navigator.clipboard is absent on the Deck).
    const link = info.stream.url ?? (info.stream.infoHash ? `magnet:?xt=urn:btih:${info.stream.infoHash}` : '')
    if (!link || !copyToClipboard(link)) return
    const k = keyOf(info)
    copiedKey = k
    setTimeout(() => { if (copiedKey === k) copiedKey = null }, 1200)
  }
  function close() { if (!busy) streamPicker.set(null) }

  const badgeClass = (b: string) =>
    /^(?:4K|1440p|1080p|720p|480p|360p|240p|SD)$/.test(b) ? 'bg-lime-500/15 text-lime-300'
    : /^(?:HEVC|AV1|H264|XviD|10bit|8bit)$/.test(b) ? 'bg-sky-500/15 text-sky-300'
    : /^(?:DV|HDR|HDR10\+)$/.test(b) ? 'bg-fuchsia-500/15 text-fuchsia-300'
    : /Audio|Multi/.test(b) ? 'bg-amber-500/15 text-amber-300'
    : b === 'Batch' ? 'bg-indigo-500/15 text-indigo-300'
    : /^(?:BluRay|WEB|WEB-DL|WEBRip|HDTV|DVD)$/.test(b) ? 'bg-rose-500/15 text-rose-300'
    : 'bg-secondary text-muted-foreground'
  const seedClass = (n?: number) =>
    n == null ? 'text-muted-foreground' : n >= 20 ? 'text-green-400' : n < 5 ? 'text-red-400' : 'text-yellow-400'
  const cacheGlyph = (c: StreamInfo['cached']) =>
    c === 'instant' ? { i: '⚡', cls: 'text-green-400', t: 'Cached — instant play' }
    : c === 'uncached' ? { i: '⬇', cls: 'text-amber-400', t: 'Not cached — will download to debrid' }
    : { i: '✖', cls: 'text-red-400', t: 'Dead — no seeders on debrid' }
</script>

{#if pick}
  <div
    class="fixed inset-0 z-40 grid place-items-center bg-black/70 p-4 backdrop-blur-sm"
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
            <p class="mt-1 text-xs text-muted-foreground">
              {#if resolving}Finding sources…{:else}{pick.cachedCount} cached{uncachedCount ? ` · ${uncachedCount} uncached` : ''}{deadCount && $showDeadSources ? ` · ${deadCount} dead` : ''}{/if}
            </p>
          </div>
          <button data-focusable onclick={close} disabled={busy} class="grid size-8 shrink-0 place-items-center rounded-lg bg-black/40 text-white/80 transition-colors hover:bg-black/60 hover:text-white disabled:opacity-40" aria-label="Close">✕</button>
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
          {#if autoState === 'counting'}
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
      </div>

      {#if error}
        <p class="border-b border-border bg-destructive/10 px-4 py-2 text-sm text-destructive">{error}</p>
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
          {@const g = cacheGlyph(info.cached)}
          {@const isBest = info === best}
          {@const disabled = busy || info.cached === 'down'}
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
            class:opacity-40={info.cached === 'down'}
            class:!border-theme={isBest}
            class:!border-red-400={isBest && autoState === 'counting' && autoProgress > 0.4}
            class:animate-pulse={isBest && autoState === 'counting' && autoProgress > 0.4}
            animate:flip={{ duration: 220 }}
            in:fade={{ duration: 150 }}
          >
            <span class="mt-0.5 shrink-0 text-lg leading-none {g.cls}" title={g.t} aria-hidden="true">{g.i}</span>

            <span class="min-w-0 flex-1">
              <!-- heading row -->
              <span class="flex items-center gap-2">
                {#if info.logo}
                  <img src={logoSrc(info.logo)} alt={info.addon ?? ''} title={info.addon ?? ''} class="size-5 shrink-0 rounded object-contain" loading="lazy" decoding="async" />
                {/if}
                <span class="truncate text-base font-bold">{info.group ?? info.addon ?? info.provider ?? 'Source'}</span>
                {#if isBest}
                  <span class="shrink-0 rounded bg-theme px-1.5 text-[0.6rem] font-black uppercase text-white">Best</span>
                  {#if autoState === 'counting'}<span class="shrink-0 font-black tabular-nums text-theme" class:text-red-400={autoProgress > 0.4}>[{Math.ceil((1 - autoProgress) * AUTO_MS / 1000)}]</span>{/if}
                {/if}
                {#if info.batch}<Database size={13} class="shrink-0 text-indigo-300" />{/if}
                <span class="ml-auto flex shrink-0 items-center gap-2">
                  {#if info.addon && !info.logo}<span class="text-[0.65rem] font-semibold text-muted-foreground">{info.addon}</span>{/if}
                  <button type="button" data-focusable onclick={(e) => copyLink(e, info)} title={copiedKey === keyOf(info) ? 'Copied!' : 'Copy link'} aria-label="Copy link" class="opacity-0 transition group-hover:opacity-100 {copiedKey === keyOf(info) ? '!opacity-100 text-green-400' : 'text-muted-foreground hover:text-foreground'}">{#if copiedKey === keyOf(info)}<Check size={14} />{:else}<Copy size={14} />{/if}</button>
                  <Play size={14} class="text-muted-foreground opacity-0 transition group-hover:opacity-100" />
                </span>
              </span>

              <!-- filename -->
              <span class="mt-0.5 block truncate text-[0.72rem] text-muted-foreground" title={info.filename ?? info.label}>{info.filename ?? info.label}</span>

              <!-- meta + badges -->
              <span class="mt-1.5 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[0.7rem]">
                {#if info.provider}<span class="font-bold text-theme">{info.provider}</span>{/if}
                {#if info.cached === 'uncached'}<span class="text-amber-400">will download</span>{/if}
                {#if info.seeders != null}<span class={seedClass(info.seeders)}>👤 {info.seeders}</span>{/if}
                {#if info.sizeLabel}<span class="text-muted-foreground">💾 {info.sizeLabel}</span>{/if}
                {#each info.badges as b}
                  <span class="rounded px-1.5 py-0.5 font-medium {badgeClass(b)}">{b}</span>
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
          <p class="px-3 py-8 text-center text-sm text-muted-foreground">
            {filter.trim() ? 'No sources match your filter.' : deadCount && !$showDeadSources ? 'No sources — enable “Dead” to see uncached/dead torrents.' : 'No sources to show.'}
          </p>
        {/if}
        {/if}
      </div>
    </div>
  </div>
{/if}
