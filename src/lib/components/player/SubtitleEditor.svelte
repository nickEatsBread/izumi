<script lang="ts">
  import { onDestroy, onMount } from 'svelte'
  import { get } from 'svelte/store'
  import Check from '@lucide/svelte/icons/check'
  import RotateCcw from '@lucide/svelte/icons/rotate-ccw'
  import X from '@lucide/svelte/icons/x'
  import { clampSubtitlePosition, subtitlePositionFromPointer } from '$lib/player/subtitle-editor'
  import { sessionSubtitleAdjustments } from '$lib/settings/subtitle-presets'
  import { isAndroid, isMacOS } from '$lib/platform'

  let {
    paused, command, getProperty, position: currentPosition, authoredPosition, ass = false, onclose, onpaint, frameTop = 0, frameHeight = 0,
  }: {
    paused: boolean
    command: (name: string, args?: string[]) => void | Promise<void>
    /** Read an mpv property; null when the player cannot answer. */
    getProperty: (name: string) => Promise<string | null>
    /** Where the bottom of dialogue sits now, in % of the frame height. */
    position: number
    /** Where the subtitles themselves put it, for Reset. */
    authoredPosition: number
    /** The selected track is an ASS script: libass places it on the picture, black bars excluded,
     *  whereas mpv places converted text on the whole player surface. */
    ass?: boolean
    onclose: () => void
    /** Game-mode XWayland snapshots call this after the editor has painted a visual change. */
    onpaint?: () => void
    /** CSS-pixel native video surface inside the window; zero height means the full player. */
    frameTop?: number
    frameHeight?: number
  } = $props()

  // The real subtitle moves while you drag: each change goes into the session adjustments, which the
  // player turns into mpv properties for the selected track, so what you see is exactly where it
  // stays. Only the position changes — never the font, size, colours or outline. Closing without
  // Save (the X, Escape, or B on a controller) puts the previous position back.
  const before = get(sessionSubtitleAdjustments)
  // svelte-ignore state_referenced_locally -- the editor starts from where the line is when opened
  let position = $state(clampSubtitlePosition(currentPosition))
  let stageEl = $state<HTMLElement>()
  let surfaceHeight = $state(0)
  /** Black bars above and below the picture, as fractions of the player surface (mpv osd-dimensions). */
  let bars = $state({ top: 0, bottom: 0 })
  const surface = $derived(frameHeight > 0 ? { top: frameTop, height: frameHeight } : { top: 0, height: surfaceHeight })
  const stage = $derived({
    top: surface.top + surface.height * bars.top,
    height: surface.height * Math.max(0.1, 1 - bars.top - bars.bottom),
  })
  let dragPointer: number | null = null
  let closing = false
  let resumeAfter = false
  let restoreTo: string | null = null
  let paintFrame = 0
  let paintTimer: ReturnType<typeof setTimeout> | undefined

  async function safeCommand(name: string, args: string[] = []) {
    try { await command(name, args) } catch { /* player may be closing */ }
  }

  function requestPaint() {
    if (!onpaint || typeof requestAnimationFrame !== 'function') return
    if (paintFrame) cancelAnimationFrame(paintFrame)
    if (paintTimer) clearTimeout(paintTimer)
    // Run after the browser has applied Svelte state and focus styles. Calling the native snapshot
    // from the input handler itself captures the previous slider/focus frame on WebKitGTK.
    paintFrame = requestAnimationFrame(() => {
      paintFrame = 0
      paintTimer = setTimeout(() => {
        paintTimer = undefined
        onpaint?.()
      }, 0)
    })
  }

  $effect(() => {
    void position
    requestPaint()
  })

  function setPosition(value: number | null) {
    if (value == null) {
      position = clampSubtitlePosition(authoredPosition)
      sessionSubtitleAdjustments.update((current) => ({ ...current, position: null }))
      return
    }
    position = clampSubtitlePosition(value)
    sessionSubtitleAdjustments.update((current) => ({ ...current, position }))
  }

  onMount(() => {
    resumeAfter = !paused
    void (async () => {
      await safeCommand('set', ['pause', 'yes'])
      if (ass) {
        try {
          const osd = JSON.parse((await getProperty('osd-dimensions')) ?? '{}') as { h?: number; mt?: number; mb?: number }
          if (osd.h && osd.h > 0) bars = { top: (osd.mt ?? 0) / osd.h, bottom: (osd.mb ?? 0) / osd.h }
        } catch { /* measure against the whole surface */ }
      }
      // Position a real line. When none is on screen, step to the next one and return afterwards.
      const text = await getProperty('sub-text').catch(() => null)
      if (!text?.trim()) {
        restoreTo = await getProperty('time-pos').catch(() => null)
        await safeCommand('sub-seek', ['1'])
      }
    })()
  })

  async function leave() {
    if (restoreTo) await safeCommand('seek', [restoreTo, 'absolute+exact'])
    if (resumeAfter) await safeCommand('set', ['pause', 'no'])
  }

  onDestroy(() => {
    if (paintFrame) cancelAnimationFrame(paintFrame)
    if (paintTimer) clearTimeout(paintTimer)
    if (closing) return
    sessionSubtitleAdjustments.set(before)
    void leave()
  })

  function moveToPointer(event: PointerEvent) {
    const rect = stageEl?.getBoundingClientRect()
    if (rect) setPosition(subtitlePositionFromPointer(event.clientY, rect.top, rect.height))
  }
  function startDrag(event: PointerEvent) {
    if (!event.isPrimary) return
    dragPointer = event.pointerId
    ;(event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId)
    moveToPointer(event)
  }
  function drag(event: PointerEvent) {
    if (dragPointer === event.pointerId) moveToPointer(event)
  }
  function endDrag(event: PointerEvent) {
    if (dragPointer !== event.pointerId) return
    dragPointer = null
    try { (event.currentTarget as HTMLElement).releasePointerCapture?.(event.pointerId) } catch { /* already released */ }
  }

  async function finish(save: boolean) {
    if (closing) return
    closing = true
    if (!save) sessionSubtitleAdjustments.set(before)
    await leave()
    onclose()
  }
  function keydown(event: KeyboardEvent) {
    if (event.key === 'Escape') { event.preventDefault(); void finish(false) }
  }
</script>

<svelte:window onkeydown={keydown} />

<div data-nav-trap bind:clientHeight={surfaceHeight} class="absolute inset-0 z-[80] bg-transparent text-white" role="dialog" aria-modal="true" aria-label="Subtitle position editor" tabindex="-1" onkeydown={keydown} onfocusin={requestPaint} onpointerdown={(event) => event.stopPropagation()} onclick={(event) => event.stopPropagation()}>
  <!-- The controls sit at the top: subtitles live at the bottom of the frame and must stay visible. -->
  <header class="absolute inset-x-0 top-0 z-10 border-b border-white/10 bg-neutral-950/90 px-3 py-2 sm:px-5">
    <div class="flex items-center gap-3">
      {#if $isMacOS}<div class="w-16 shrink-0" aria-hidden="true"></div>{/if}
      <button data-focusable class="grid size-10 place-items-center rounded-full hover:bg-white/10" onclick={() => void finish(false)} aria-label="Cancel subtitle changes"><X size={21} /></button>
      <div class="min-w-0 flex-1">
        <h2 class="truncate text-base font-black sm:text-lg">Move subtitles</h2>
        <p class="truncate text-xs text-white/55">Drag on the video or use the slider. The subtitles move as you go.</p>
      </div>
      <button
        data-focusable
        class="flex h-10 shrink-0 items-center gap-2 rounded-full bg-white/10 px-3 text-xs font-extrabold text-white hover:bg-white/15"
        onclick={() => setPosition(null)}
        aria-label="Reset to the original subtitle position"
        title="Reset to original position"
      >
        <RotateCcw size={16} /><span class="hidden sm:inline">Reset</span>
      </button>
      <button data-focusable class="flex h-10 items-center gap-2 rounded-full bg-theme px-4 text-sm font-extrabold text-white" onclick={() => void finish(true)}><Check size={18} /> Save</button>
      {#if !$isAndroid && !$isMacOS}<div class="w-[8.25rem] shrink-0" aria-hidden="true"></div>{/if}
    </div>
    <label class="mx-auto mt-1 block max-w-2xl text-xs font-bold">
      <span class="mb-1 flex justify-between"><span>Position</span><span role="status" aria-label={`Subtitle position ${Math.round(position)} percent`}>{Math.round(position)}%</span></span>
      <input data-focusable class="h-8 w-full accent-theme" type="range" min="5" max="100" step="1" value={position} oninput={(event) => setPosition(Number(event.currentTarget.value))} aria-label="Subtitle vertical position" />
    </label>
  </header>

  <div bind:this={stageEl} class="absolute inset-x-0 touch-none overflow-hidden" class:inset-y-0={stage.height <= 0} style:top={stage.height > 0 ? `${stage.top}px` : undefined} style:height={stage.height > 0 ? `${stage.height}px` : undefined} role="application" aria-label="Drag subtitles vertically" onpointerdown={startDrag} onpointermove={drag} onpointerup={endDrag} onpointercancel={endDrag}>
    <!-- Guide at the bottom edge of the dialogue; the subtitle itself is the real one, drawn by the player. -->
    <div class="pointer-events-none absolute inset-x-0 border-t border-dashed border-white/40" style:top={`${position}%`}></div>
  </div>
</div>
