<script lang="ts">
  import type { Segment } from '$lib/stremio/aniskip'

  // izumi-style seekbar for the libmpv player. Renders stacked layers (buffered,
  // OP/ED segment tints, hover-scrub, played) plus chapter ticks and a hover
  // tooltip (time + chapter/segment label — no thumbnail, per design). Dragging
  // previews the position and commits ONE seek on release (avoids the rapid
  // per-move seeks that made mpv loop backward over the cached region).
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
  // Chapter + segment-boundary tick marks (skip 0 and the very end).
  const ticks = $derived(
    [...chapters.map((c) => c.time), ...segments.flatMap((s) => [s.start, s.end])].filter(
      (t) => t > 1 && t < dur - 1,
    ),
  )

  function timeAt(clientX: number): number {
    if (!el || dur <= 0) return 0
    const r = el.getBoundingClientRect()
    return Math.min(dur, Math.max(0, ((clientX - r.left) / r.width) * dur))
  }
  function onmove(e: PointerEvent) {
    hovering = true
    hoverT = timeAt(e.clientX)
  }
  function ondown(e: PointerEvent) {
    seeking = true
    hoverT = timeAt(e.clientX)
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
  class="group relative w-full cursor-pointer select-none py-3 touch-none focus:outline-none focus-visible:shadow-none"
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
  <!-- Track -->
  <div class="relative h-1.5 w-full overflow-hidden rounded-full bg-white/25 transition-[height] duration-100 group-hover:h-2">
    <!-- Buffered / loaded extent -->
    <div class="absolute inset-y-0 left-0 bg-white/30" style="width:{pct(buffer)}%"></div>
    <!-- OP/ED/recap tints -->
    {#each segments as s}
      <div class="absolute inset-y-0 {segClass[s.type] ?? 'bg-white/20'}" style="left:{pct(s.start)}%;width:{pct(s.end) - pct(s.start)}%"></div>
    {/each}
    <!-- Hover scrub preview (below played) -->
    {#if hovering || seeking}
      <div class="absolute inset-y-0 left-0 bg-white/40" style="width:{pct(hoverT)}%"></div>
    {/if}
    <!-- Played -->
    <div class="absolute inset-y-0 left-0 bg-white" style="width:{pct(pos)}%"></div>
  </div>

  <!-- Chapter / segment boundary ticks -->
  {#each ticks as t}
    <div class="pointer-events-none absolute top-1/2 h-2 w-px -translate-y-1/2 bg-black/60" style="left:{pct(t)}%"></div>
  {/each}

  <!-- Playhead dot (shown on hover) -->
  <div
    class="pointer-events-none absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white opacity-0 shadow transition-opacity group-hover:opacity-100"
    style="left:{pct(pos)}%"
  ></div>

  <!-- Hover tooltip: chapter/segment label + timestamp -->
  {#if (hovering || seeking) && dur > 0}
    <div
      class="pointer-events-none absolute bottom-8 -translate-x-1/2 rounded-md border border-white/15 bg-neutral-900/95 px-2.5 py-1.5 text-center shadow-lg"
      style="left:clamp(52px, {pct(hoverT)}%, calc(100% - 52px))"
    >
      {#if labelAt(hoverT)}
        <div class="max-w-40 truncate text-xs text-white/60">{labelAt(hoverT)}</div>
      {/if}
      <div class="font-mono text-sm tabular-nums text-white">{fmt(hoverT)}</div>
    </div>
  {/if}
</div>
