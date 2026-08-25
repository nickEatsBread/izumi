<script lang="ts">
  import { getCurrentWindow } from '@tauri-apps/api/window'
  import { onMount } from 'svelte'
  import Minus from '@lucide/svelte/icons/minus'
  import Square from '@lucide/svelte/icons/square'
  import Copy from '@lucide/svelte/icons/copy'
  import X from '@lucide/svelte/icons/x'
  import { commentsOpen, gifRecordingStart, playerNotice } from '$lib/player/session'
  import { playerGifStop } from '$lib/player/native'
  import { usePlayerGifRecordingIndicator } from '$lib/player/gif-indicator'
  import { isMacOS } from '$lib/platform'

  const win = getCurrentWindow()
  // Track the real window state so the button shows maximize vs restore correctly —
  // maximize/unmaximize/drag-snap all fire a resize event, which we re-sync on.
  let maximized = $state(false)
  const sync = async () => { try { maximized = await win.isMaximized() } catch { /* web preview */ } }
  onMount(() => {
    sync()
    let un: (() => void) | undefined
    win.onResized(() => sync()).then((f) => (un = f)).catch(() => {})
    return () => un?.()
  })

  const minimize = () => win.minimize()
  const toggle = async () => { await win.toggleMaximize().catch(() => {}); sync() }
  const close = () => win.close()

  async function stopGif(event: MouseEvent) {
    event.stopPropagation()
    if ($gifRecordingStart == null) return
    const startedAt = $gifRecordingStart
    gifRecordingStart.set(null)
    try {
      const background = await playerGifStop({ startSec: startedAt })
      playerNotice.set(background ? 'Saving GIF in background…' : 'GIF saved to Pictures/izumi')
    } catch (error) {
      playerNotice.set(
        String(error).includes('ffmpeg-unavailable')
          ? 'GIF recording needs ffmpeg installed'
          : String(error).includes('gif-no-frames')
            ? 'GIF was too short — hold O a bit longer'
            : 'GIF recording failed',
      )
    }
  }
</script>

<!--
  Thin custom titlebar for the frameless window. The bar itself is a drag region
  (data-tauri-drag-region); the control buttons are NOT, so they stay clickable.
  Transparent so the hero banner shows through to the very top edge.

  Hidden while the in-player discussion panel is open: that panel is full-height on the right but is
  trapped inside the player overlay's z-20 stacking context, so it can't paint over this z-50 bar. Since
  the window controls aren't wanted while the discussion is open anyway, we hide the whole bar — the
  panel then owns the top edge cleanly. `invisible` also drops it from hit-testing, so panel clicks land.
-->
<div
  data-tauri-drag-region
  class="fixed inset-x-0 top-0 z-50 flex h-8 items-center justify-between"
  class:invisible={$commentsOpen}
>
  <!-- macOS keeps its real native traffic lights at the leading edge. Reserve their hit area and
       place the GIF indicator after them; Windows/Linux retain the sidebar-width indicator slot. -->
  <div class="flex h-8 shrink-0 items-center overflow-hidden [contain:paint] {$isMacOS ? 'w-28 justify-end pr-2' : 'w-14 justify-center'}">
    {#if !usePlayerGifRecordingIndicator && $gifRecordingStart != null}
      <button
        data-capture-exclude
        class="flex h-5 max-w-[48px] items-center gap-0.5 rounded-full bg-red-600 px-1.5 text-[9px] font-semibold leading-none text-white outline-none hover:bg-red-500 focus:outline-none focus-visible:outline-none"
        onclick={stopGif}
      >
        <span class="size-1.5 shrink-0 animate-pulse rounded-full bg-white"></span>
        GIF
      </button>
    {/if}
  </div>
  {#if !$isMacOS}
  <div class="flex items-center">
  <button
    onclick={minimize}
    aria-label="Minimize"
    class="grid h-8 w-11 place-items-center text-muted-foreground transition-colors hover:bg-white/10 hover:text-foreground"
  >
    <Minus size={15} />
  </button>
  <button
    onclick={toggle}
    aria-label={maximized ? 'Restore' : 'Maximize'}
    class="grid h-8 w-11 place-items-center text-muted-foreground transition-colors hover:bg-white/10 hover:text-foreground"
  >
    {#if maximized}<Copy size={12} />{:else}<Square size={12} />{/if}
  </button>
  <button
    onclick={close}
    aria-label="Close"
    class="grid h-8 w-11 place-items-center text-muted-foreground transition-colors hover:bg-red-600 hover:text-white"
  >
    <X size={16} />
  </button>
  </div>
  {/if}
</div>
