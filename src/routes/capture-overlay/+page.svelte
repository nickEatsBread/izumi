<script lang="ts">
  import { onMount } from 'svelte'
  import { emitTo, listen, type UnlistenFn } from '@tauri-apps/api/event'
  import {
    CAPTURE_OUTPUT_CLASS,
    captureControlsEvents,
  } from '$lib/player/capture-presentation'

  type CaptureControlsFrame = {
    revision: number
    html: string
    documentClass: string
    documentStyle: string
    bodyClass: string
  }

  let surface: HTMLDivElement

  onMount(() => {
    let unlistenFrame: UnlistenFn | undefined
    let unlistenProbe: UnlistenFn | undefined
    let disposed = false
    document.documentElement.classList.add('capture-overlay-window')
    void (async () => {
      unlistenFrame = await listen<CaptureControlsFrame>(captureControlsEvents.frame, (event) => {
        if (disposed) return
        const frame = event.payload
        const classes = frame.documentClass
          .split(/\s+/)
          .filter((name) => name && name !== CAPTURE_OUTPUT_CLASS && name !== 'deck-launch-pending')
        document.documentElement.className = [...classes, 'capture-overlay-window'].join(' ')
        document.documentElement.style.cssText = frame.documentStyle
        document.body.className = frame.bodyClass
        surface.innerHTML = frame.html
        requestAnimationFrame(() => requestAnimationFrame(() => {
          void emitTo('main', captureControlsEvents.painted, frame.revision)
        }))
      })
      unlistenProbe = await listen<null>(captureControlsEvents.probe, () => {
        if (!disposed) void emitTo('main', captureControlsEvents.ready, null)
      })
      if (!disposed) await emitTo('main', captureControlsEvents.ready, null)
    })()
    return () => {
      disposed = true
      unlistenFrame?.()
      unlistenProbe?.()
    }
  })
</script>

<div bind:this={surface} class="capture-controls-surface" aria-hidden="true"></div>

<style>
  :global(html.capture-overlay-window),
  :global(html.capture-overlay-window body) {
    width: 100%;
    height: 100%;
    overflow: hidden;
    background: transparent !important;
  }
  .capture-controls-surface {
    position: fixed;
    inset: 0;
    pointer-events: none;
    background: transparent;
  }
  .capture-controls-surface :global(.izumi-capture-copy) {
    pointer-events: none !important;
  }
  .capture-controls-surface :global([data-capture-focus]) {
    outline: 2px solid hsl(var(--ring));
    outline-offset: 2px;
    border-radius: var(--radius);
  }
  :global(.gamemode) .capture-controls-surface :global([data-capture-focus]) {
    outline: none;
    box-shadow: 0 0 0 3px #fff;
  }
  .capture-controls-surface :global(button[data-capture-hover]) {
    filter: brightness(1.18);
  }
</style>
