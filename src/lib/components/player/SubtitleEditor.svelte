<script lang="ts">
  import { onDestroy, onMount } from 'svelte'
  import { get } from 'svelte/store'
  import Check from '@lucide/svelte/icons/check'
  import Minus from '@lucide/svelte/icons/minus'
  import Plus from '@lucide/svelte/icons/plus'
  import RotateCcw from '@lucide/svelte/icons/rotate-ccw'
  import X from '@lucide/svelte/icons/x'
  import {
    subtitleStyleEnabled, subtitleOverrideScope, subtitleFont, subtitleBold, subtitleFontSize, subtitleTextColor,
    subtitleBorderColor, subtitleBorderSize, subtitleShadow, subtitlePosition,
  } from '$lib/settings/ui'
  import { effectiveSubtitleStyle, sessionSubtitleStyle } from '$lib/settings/subtitle-presets'
  import { subtitleStyleProps, type SubtitleStyle } from '$lib/player/subtitle-style'
  import { clampSubtitlePosition, subtitlePositionFromPointer, subtitlePreviewFontSize } from '$lib/player/subtitle-editor'
  import { isAndroid, isMacOS } from '$lib/platform'

  let {
    paused, command, capture, onclose, onpaint, frameTop = 0, frameHeight = 0,
  }: {
    paused: boolean
    command: (name: string, args?: string[]) => void | Promise<void>
    capture: () => Promise<string | null>
    onclose: () => void
    /** Game-mode XWayland snapshots call this after the editor has painted a visual change. */
    onpaint?: () => void
    /** CSS-pixel native video surface inside the window; zero height means the full player. */
    frameTop?: number
    frameHeight?: number
  } = $props()

  const initial = effectiveSubtitleStyle(get(sessionSubtitleStyle), {
    enabled: get(subtitleStyleEnabled),
    scope: get(subtitleOverrideScope),
    font: get(subtitleFont),
    bold: get(subtitleBold),
    fontSize: get(subtitleFontSize),
    textColor: get(subtitleTextColor),
    borderColor: get(subtitleBorderColor),
    borderSize: get(subtitleBorderSize),
    shadow: get(subtitleShadow),
    position: get(subtitlePosition),
  })
  let font = $state(initial.font)
  let fontSize = $state(initial.fontSize)
  let textColor = $state(initial.textColor)
  let borderColor = $state(initial.borderColor)
  let borderSize = $state(initial.borderSize)
  let shadow = $state(initial.shadow)
  let position = $state(initial.position)
  let snapshot = $state<string | null>(null)
  let captureDone = $state(false)
  let previewHeight = $state(720)
  let stageEl = $state<HTMLElement>()
  let dragPointer: number | null = null
  let closing = false
  let resumeAfter = false
  let paintFrame = 0
  let paintTimer: ReturnType<typeof setTimeout> | undefined
  const previewFontSize = $derived(subtitlePreviewFontSize(fontSize, previewHeight))
  const previewBorder = $derived(Math.max(0, borderSize * previewHeight / 720))
  const previewShadow = $derived(Math.max(0, shadow * previewHeight / 720))

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
    void font; void fontSize; void textColor; void borderColor; void borderSize; void shadow
    void position; void snapshot; void captureDone; void previewHeight
    requestPaint()
  })

  onMount(() => {
    resumeAfter = !paused
    let alive = true
    void (async () => {
      await safeCommand('set', ['pause', 'yes'])
      const frame = await capture().catch(() => null)
      if (!alive) return
      snapshot = frame
      captureDone = true
      // The still excludes subtitles, leaving one movable preview line. Hiding the native line is
      // also the fallback when a protected stream cannot be copied into an image.
      await safeCommand('set', ['sub-visibility', 'no'])
    })()
    return () => { alive = false }
  })

  onDestroy(() => {
    if (paintFrame) cancelAnimationFrame(paintFrame)
    if (paintTimer) clearTimeout(paintTimer)
    if (closing) return
    void safeCommand('set', ['sub-visibility', 'yes'])
    if (resumeAfter) void safeCommand('set', ['pause', 'no'])
  })

  function moveToPointer(event: PointerEvent) {
    const rect = stageEl?.getBoundingClientRect()
    if (rect) position = subtitlePositionFromPointer(event.clientY, rect.top, rect.height)
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
  function reset() {
    font = 'Nunito'; fontSize = 42; textColor = '#ffffff'; borderColor = '#000000'
    borderSize = 3; shadow = 1; position = 92
  }

  async function finish(save: boolean) {
    if (closing) return
    closing = true
    if (save) {
      const style: SubtitleStyle = {
        enabled: true,
        scope: initial.scope,
        font: font.trim() || 'Nunito',
        bold: initial.bold,
        fontSize: Math.round(fontSize),
        textColor, borderColor, borderSize, shadow,
        position: clampSubtitlePosition(position),
      }
      subtitleFont.set(style.font)
      subtitleOverrideScope.set(style.scope)
      subtitleBold.set(style.bold)
      subtitleFontSize.set(style.fontSize)
      subtitleTextColor.set(style.textColor)
      subtitleBorderColor.set(style.borderColor)
      subtitleBorderSize.set(style.borderSize)
      subtitleShadow.set(style.shadow)
      subtitlePosition.set(style.position)
      subtitleStyleEnabled.set(true)
      // The visible style becomes the global style instead of being masked by a session preset.
      sessionSubtitleStyle.set(null)
      for (const [property, value] of subtitleStyleProps(style)) await safeCommand('set', [property, value])
    }
    await safeCommand('set', ['sub-visibility', 'yes'])
    if (resumeAfter) await safeCommand('set', ['pause', 'no'])
    onclose()
  }
  function keydown(event: KeyboardEvent) {
    if (event.key === 'Escape') { event.preventDefault(); void finish(false) }
  }
</script>

<svelte:window onkeydown={keydown} />

<div data-nav-trap class="absolute inset-0 z-[80] text-white" class:bg-black={!!snapshot || !captureDone} class:bg-transparent={captureDone && !snapshot} role="dialog" aria-modal="true" aria-label="Subtitle position and size editor" tabindex="-1" onkeydown={keydown} onfocusin={requestPaint} onpointerdown={(event) => event.stopPropagation()} onclick={(event) => event.stopPropagation()}>
  <header class="absolute inset-x-0 top-0 z-10 flex items-center gap-3 border-b border-white/10 bg-neutral-950/95 px-3 py-2 sm:px-5">
    {#if $isMacOS}<div class="w-16 shrink-0" aria-hidden="true"></div>{/if}
    <button data-focusable class="grid size-10 place-items-center rounded-full hover:bg-white/10" onclick={() => void finish(false)} aria-label="Cancel subtitle changes"><X size={21} /></button>
    <div class="min-w-0 flex-1">
      <h2 class="truncate text-base font-black sm:text-lg">Edit subtitles</h2>
      <p class="truncate text-xs text-white/55">Drag the sample to place it on the captured frame.</p>
    </div>
    <button
      data-focusable
      class="flex h-10 shrink-0 items-center gap-2 rounded-full bg-white/10 px-3 text-xs font-extrabold text-white hover:bg-white/15"
      onclick={reset}
      aria-label="Reset to the original subtitle style"
      title="Reset to original style"
    >
      <RotateCcw size={16} /><span class="hidden sm:inline">Reset</span>
    </button>
    <div
      class="inline-flex shrink-0 items-center gap-1 rounded-full border border-white/20 bg-black/80 px-3 py-1.5 text-xs font-extrabold text-white shadow-lg"
      role="status"
      aria-label={`Subtitle position ${Math.round(position)} percent`}
    >
      <span class="hidden sm:inline">Position</span><span>{Math.round(position)}%</span>
    </div>
    <button data-focusable class="flex h-10 items-center gap-2 rounded-full bg-theme px-4 text-sm font-extrabold text-white" onclick={() => void finish(true)}><Check size={18} /> Save</button>
    {#if !$isAndroid && !$isMacOS}<div class="w-[8.25rem] shrink-0" aria-hidden="true"></div>{/if}
  </header>

  <div bind:this={stageEl} bind:clientHeight={previewHeight} class="absolute inset-x-0 touch-none overflow-hidden" class:inset-y-0={frameHeight <= 0} class:bg-black={!!snapshot || !captureDone} style:top={frameHeight > 0 ? `${frameTop}px` : undefined} style:height={frameHeight > 0 ? `${frameHeight}px` : undefined} role="application" aria-label="Drag subtitle preview vertically" onpointerdown={startDrag} onpointermove={drag} onpointerup={endDrag} onpointercancel={endDrag}>
    {#if snapshot}
      <img src={snapshot} alt="Captured video frame" class="pointer-events-none absolute inset-0 size-full object-contain" />
    {:else if !captureDone}
      <div class="absolute inset-0 grid place-items-center bg-black"><span class="size-8 animate-spin rounded-full border-2 border-white/20 border-t-white"></span></div>
    {/if}
    <div class="pointer-events-none absolute inset-x-0 border-t border-dashed border-white/20" style:top={`${position}%`}></div>
    <div class="pointer-events-none absolute left-1/2 max-w-[92%] -translate-x-1/2 -translate-y-full text-center font-bold leading-[1.18]"
      style:top={`${position}%`} style:font-family={font || 'Nunito'} style:font-size={`${previewFontSize}px`} style:color={textColor}
      style:-webkit-text-stroke={`${previewBorder}px ${borderColor}`} style:text-shadow={`0 ${previewShadow}px ${Math.max(1, previewShadow * 2)}px ${borderColor}`}
    >Drag subtitles to where you want them</div>
  </div>

  <section class="absolute inset-x-0 bottom-0 z-10 border-t border-white/10 bg-neutral-950/95 px-3 py-3 sm:px-5">
    <div class="mx-auto grid max-w-5xl gap-3 sm:grid-cols-[minmax(12rem,1fr)_minmax(12rem,1fr)_auto] sm:items-end">
      <label class="block text-xs font-bold">
        <span class="mb-1 flex justify-between"><span>Size</span><span>{Math.round(fontSize)}px</span></span>
        <span class="flex items-center gap-2">
          <button data-focusable class="grid size-9 shrink-0 place-items-center rounded-lg bg-white/10" onclick={() => (fontSize = Math.max(20, fontSize - 2))} aria-label="Decrease subtitle size"><Minus size={17} /></button>
          <input data-focusable class="w-full accent-theme" type="range" min="20" max="80" step="1" bind:value={fontSize} aria-label="Subtitle size" />
          <button data-focusable class="grid size-9 shrink-0 place-items-center rounded-lg bg-white/10" onclick={() => (fontSize = Math.min(80, fontSize + 2))} aria-label="Increase subtitle size"><Plus size={17} /></button>
        </span>
      </label>
      <label class="block text-xs font-bold">
        <span class="mb-1 flex justify-between"><span>Position</span><span>{Math.round(position)}%</span></span>
        <input data-focusable class="h-9 w-full accent-theme" type="range" min="5" max="100" step="1" bind:value={position} aria-label="Subtitle vertical position" />
      </label>
      <div class="flex items-end gap-2">
        <label class="text-center text-[0.65rem] text-white/60">Text<input data-focusable class="mt-1 block size-9 rounded bg-transparent" type="color" bind:value={textColor} aria-label="Subtitle text colour" /></label>
        <label class="text-center text-[0.65rem] text-white/60">Border<input data-focusable class="mt-1 block size-9 rounded bg-transparent" type="color" bind:value={borderColor} aria-label="Subtitle border colour" /></label>
        <label class="w-16 text-[0.65rem] text-white/60">Outline <input data-focusable class="mt-1 w-full accent-theme" type="range" min="0" max="8" step="0.5" bind:value={borderSize} aria-label="Subtitle outline size" /></label>
        <label class="w-16 text-[0.65rem] text-white/60">Shadow <input data-focusable class="mt-1 w-full accent-theme" type="range" min="0" max="8" step="0.5" bind:value={shadow} aria-label="Subtitle shadow size" /></label>
      </div>
    </div>
  </section>
</div>
