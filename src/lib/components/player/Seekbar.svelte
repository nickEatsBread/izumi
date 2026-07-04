<script lang="ts">
  import { invoke } from '@tauri-apps/api/core'
  import { get } from 'svelte/store'
  import { onDestroy } from 'svelte'
  import { spriteKey } from '$lib/player/session'
  import type { Segment } from '$lib/stremio/aniskip'

  // Seekbar for the libmpv player. Renders stacked layers (buffered,
  // OP/ED segment tints, hover-scrub, played) plus chapter ticks and a hover
  // tooltip. The scrub preview is ON-DEMAND trickplay: Rust grabs the tile UNDER THE
  // CURSOR with a single input-seek ffmpeg (cached by infoHash+index), so any bar
  // position is equally fast; the seekbar shows a loading shimmer for the brief grab.
  // Dragging previews the position and commits ONE seek on release.
  let {
    pos,
    dur,
    buffer,
    segments,
    chapters,
    onseek,
  }: {
    pos: number
    dur: number
    buffer: number
    segments: Segment[]
    chapters: { time: number; title: string }[]
    onseek: (t: number) => void
  } = $props()

  let el = $state<HTMLDivElement>()
  let hovering = $state(false)
  let seeking = $state(false)
  let hoverT = $state(0)

  // --- Scrub-preview thumbnails (on-demand) -----------------------------------
  // Rust produces the tile UNDER THE CURSOR on demand (one input-seek ffmpeg per
  // position, cached by index), so any point on the bar is equally fast — hovering
  // the end loads as quickly as the start (a linear pass left later positions blank
  // for ages). A position whose frame isn't ready yet shows a loading shimmer (never
  // blank), flipping to the frame the instant the grab returns.
  let interval = $state(0) // seconds between tile grid positions (from player_thumb_info)
  let thumbSrc = $state('') // current hovered tile dataUrl ('' → shimmer)
  const tileCache = new Map<number, string>() // tile index → dataUrl

  let activeKey: string | null = null
  let infoPoll: ReturnType<typeof setInterval> | undefined
  let reqTimer: ReturnType<typeof setTimeout> | undefined
  let started = false
  let reqSeq = 0
  function stopThumbs() {
    if (infoPoll) { clearInterval(infoPoll); infoPoll = undefined }
    if (reqTimer) { clearTimeout(reqTimer); reqTimer = undefined }
  }

  $effect(() => {
    const key = $spriteKey
    const d = dur
    if (key !== activeKey) {
      // New stream → reset.
      stopThumbs()
      tileCache.clear()
      thumbSrc = ''
      interval = 0
      started = false
      activeKey = key
    }
    if (!key || d <= 1 || started) return
    started = true

    // Register the job (instant — no background pass; tiles are produced on hover),
    // then learn the time↔index `interval` once.
    invoke('player_sprite_start', { key, duration: d }).catch(() => {})
    const poll = async () => {
      try {
        const r = await invoke<{ status: string; interval: number }>('player_thumb_info', { key })
        if (get(spriteKey) !== key) { stopThumbs(); return }
        if (r.interval > 0) { interval = r.interval; if (infoPoll) { clearInterval(infoPoll); infoPoll = undefined } }
      }
      catch { /* keep polling until the job registers */ }
    }
    infoPoll = setInterval(poll, 1000)
    poll()
  })
  onDestroy(stopThumbs)

  // Fetch the tile under the cursor (debounced + superseded on cursor move). The grab
  // itself runs in Rust (~a keyframe seek), so the tooltip shows a shimmer for that
  // brief moment then flips to the frame. `pending` (grab capped) → re-poll this spot.
  function requestTile(t: number) {
    const my = ++reqSeq
    const i = interval > 0 ? Math.round(t / interval) : -1
    if (i >= 0 && tileCache.has(i)) { thumbSrc = tileCache.get(i)!; return }
    thumbSrc = ''
    const run = async () => {
      if (my !== reqSeq) return
      const key = get(spriteKey)
      if (!key) return
      try {
        const r = await invoke<{ status: string; dataUrl?: string; index: number }>('player_thumb_tile', { key, time: t })
        if (my !== reqSeq) return
        if (r.status === 'ready' && r.dataUrl) { tileCache.set(r.index, r.dataUrl); thumbSrc = r.dataUrl }
        else if (r.status === 'pending') { reqTimer = setTimeout(run, 400) } // grab capped/in-flight — retry this spot
        // failed / none → leave the shimmer
      }
      catch { if (my === reqSeq) reqTimer = setTimeout(run, 800) }
    }
    if (reqTimer) clearTimeout(reqTimer)
    reqTimer = setTimeout(run, 180) // only grab once the cursor SETTLES — an active skim fires nothing
  }

  const pct = (t: number) => (dur > 0 ? Math.min(100, Math.max(0, (t / dur) * 100)) : 0)
  const fmt = (s: number) => {
    if (!Number.isFinite(s) || s < 0) s = 0
    const h = Math.floor(s / 3600)
    const m = Math.floor((s % 3600) / 60)
    const sec = Math.floor(s % 60)
    const mm = h ? String(m).padStart(2, '0') : `${m}`
    return `${h ? `${h}:` : ''}${mm}:${String(sec).padStart(2, '0')}`
  }
  // Tint per skip type. OP=sky, ED=amber, recap=neutral.
  const segClass: Record<string, string> = {
    op: 'bg-sky-400/50',
    ed: 'bg-amber-400/50',
    recap: 'bg-white/20',
  }
  // Label at a time: OP/ED/recap segment wins, else the enclosing mkv chapter.
  function labelAt(t: number): string {
    const seg = segments.find((s) => t >= s.start && t <= s.end)
    if (seg) return seg.label
    const ch = [...chapters].reverse().find((c) => c.time <= t)
    return ch?.title ?? ''
  }
  // Chapter ranges (start→next chapter, last→duration).
  const chapterRanges = $derived.by(() => {
    if (!chapters.length || dur <= 0) return [] as { start: number; end: number; title: string }[]
    const cs = [...chapters].sort((a, b) => a.time - b.time)
    return cs.map((c, i) => ({ start: c.time, end: i + 1 < cs.length ? cs[i + 1].time : dur, title: c.title }))
  })

  // Segmented seekbar: the bar is a flex row of per-chapter pieces (each
  // its % of the duration, with a small gap). Inside each piece, full-width fill bars
  // are translated left by `skewclamp(scale·(value−offset)) − 100`% inside an
  // overflow-clip container, so each shows only its portion of that chapter. On hover
  // the hovered chapter's bars grow (h-0.5 → h-1) — the popout. `scale = 100/size`
  // maps a global percent into 0–100% within the chapter; `skewclamp` hides a 0-fill
  // fully (−5 not 0) so no sliver shows.
  const skewclamp = (v: number) => { const c = Math.min(Math.max(v, 0), 100); return c === 0 ? -5 : c }
  const progressPct = $derived(pct(pos))
  const bufferPct = $derived(pct(buffer))
  const hoverPct = $derived(pct(hoverT))
  const seekActive = $derived(hovering || seeking)
  const barSegments = $derived.by(() => {
    const src = chapterRanges.length ? chapterRanges : [{ start: 0, end: dur || 1, title: '' }]
    const out: { size: number; offset: number; scale: number; title: string }[] = []
    let offset = 0
    for (const c of src) {
      const d = c.end - c.start
      if (d > 0 && dur > 0) { const size = (d / dur) * 100; out.push({ size, offset, scale: 100 / size, title: c.title }); offset += size }
    }
    if (!out.length) out.push({ size: 100, offset: 0, scale: 1, title: '' })
    return out
  })

  function timeAt(clientX: number): number {
    if (!el || dur <= 0) return 0
    const r = el.getBoundingClientRect()
    return Math.min(dur, Math.max(0, ((clientX - r.left) / r.width) * dur))
  }
  function onmove(e: PointerEvent) {
    hovering = true
    hoverT = timeAt(e.clientX)
    requestTile(hoverT)
  }
  function ondown(e: PointerEvent) {
    seeking = true
    hoverT = timeAt(e.clientX)
    requestTile(hoverT)
    el?.setPointerCapture(e.pointerId)
  }
  function onup(e: PointerEvent) {
    if (!seeking) return
    seeking = false
    el?.releasePointerCapture(e.pointerId)
    onseek(hoverT)
  }
</script>

<div
  bind:this={el}
  class="group/seekbar relative flex w-full cursor-pointer select-none touch-none focus:outline-none focus-visible:shadow-none"
  role="slider"
  tabindex="0"
  aria-label="Seek"
  aria-valuenow={Math.round(pos)}
  aria-valuemax={Math.round(dur)}
  onpointermove={onmove}
  onpointerdown={ondown}
  onpointerup={onup}
  onpointerleave={() => (hovering = false)}
  onpointercancel={onup}
>
  <!-- Per-chapter segments. Each is its % of the duration with a small gap;
       the hovered chapter's fill bars grow (h-0.5 → h-1) — the popout. Fills are
       full-width bars translated left inside an overflow-clip so each shows only its
       slice of the chapter. -->
  {#each barSegments as chap, i (i)}
    {@const active = seekActive && hoverPct > chap.offset && hoverPct < chap.offset + chap.size}
    <div class="flex shrink-0 items-center justify-center py-3" style="width:{chap.size}%">
      <div class="relative h-1 w-full overflow-hidden rounded-[2px] {i ? 'ml-0.5' : ''}">
        <!-- empty track -->
        <div class="absolute left-0 top-1/2 h-0.5 w-full -translate-y-1/2 bg-white/25 transition-[height] duration-75" class:h-1={active}></div>
        <!-- buffered -->
        <div class="absolute left-0 top-1/2 h-0.5 w-full bg-white/40 transition-[height] duration-75" class:h-1={active}
             style="transform:translate({skewclamp(chap.scale * (bufferPct - chap.offset)) - 100}%, -50%)"></div>
        <!-- hover preview -->
        {#if seekActive}
          <div class="absolute left-0 top-1/2 h-0.5 w-full bg-white/60 transition-[height] duration-75" class:h-1={active}
               style="transform:translate({skewclamp(chap.scale * (hoverPct - chap.offset)) - 100}%, -50%)"></div>
        {/if}
        <!-- played -->
        <div class="absolute left-0 top-1/2 h-0.5 w-full bg-white transition-[height] duration-75" class:h-1={active}
             style="transform:translate({skewclamp(chap.scale * (progressPct - chap.offset)) - 100}%, -50%)"></div>
      </div>
    </div>
  {/each}

  <!-- OP/ED/recap tints (AniSkip) overlaid on the segmented track. -->
  {#each segments as s}
    <div class="pointer-events-none absolute top-1/2 z-10 h-0.5 -translate-y-1/2 {segClass[s.type] ?? 'bg-white/20'}" style="left:{pct(s.start)}%;width:{pct(s.end) - pct(s.start)}%"></div>
  {/each}

  <!-- Hover tooltip: the frame at the cursor with chapter title (top) +
       timestamp (bottom) overlaid; a loading shimmer for positions whose tile isn't
       generated yet (never blank/white). -->
  {#if (hovering || seeking) && dur > 0}
    <div class="pointer-events-none absolute bottom-9 flex" style="left:clamp(100px, {pct(hoverT)}%, calc(100% - 100px))">
      <div class="-translate-x-1/2 overflow-hidden rounded-lg border border-white bg-neutral-200 shadow-lg">
        <div class="relative">
          {#if thumbSrc}
            <img src={thumbSrc} alt="" class="block w-48" />
          {:else}
            <!-- Tile not ready yet: loading shimmer (never an episode still). -->
            <div class="relative overflow-hidden bg-neutral-300" style="width:192px;height:108px">
              <div class="absolute inset-0 animate-pulse bg-gradient-to-r from-neutral-300 via-neutral-100 to-neutral-300"></div>
            </div>
          {/if}
          {#if labelAt(hoverT)}
            <div class="absolute left-1/2 top-0 max-w-40 -translate-x-1/2 truncate rounded-b-lg bg-white/90 px-2 py-1 text-xs text-zinc-900">{labelAt(hoverT)}</div>
          {/if}
          <div class="absolute bottom-0 left-1/2 -translate-x-1/2 rounded-t-lg bg-white/90 px-2 py-1 font-mono text-sm leading-none tabular-nums text-zinc-900">{fmt(hoverT)}</div>
        </div>
      </div>
    </div>
  {/if}
</div>
