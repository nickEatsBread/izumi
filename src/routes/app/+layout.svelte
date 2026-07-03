<script lang="ts">
  import Sidebar from '$lib/components/shell/Sidebar.svelte'
  import Background from '$lib/components/shell/Background.svelte'
  import Titlebar from '$lib/components/shell/Titlebar.svelte'
  import PlayerOverlay from '$lib/components/player/PlayerOverlay.svelte'
  import StreamPicker from '$lib/components/player/StreamPicker.svelte'
  import { playing, fullscreen } from '$lib/player/session'
  import { beforeNavigate } from '$app/navigation'
  import { invoke } from '@tauri-apps/api/core'
  import { initInput, initDpadNav } from '$lib/nav'
  let { children } = $props()
  $effect(() => {
    initInput()
    initDpadNav()
  })

  // Single-window player: mpv renders into THIS window, behind the webview. When
  // playing, punch a transparent hole — drop the opaque app background (app.css
  // paints html/body solid) so mpv shows through the overlay's transparent areas.
  $effect(() => {
    const bg = $playing ? 'transparent' : ''
    document.documentElement.style.background = bg
    document.body.style.background = bg
  })
  // Navigating away (e.g. a sidebar link) exits playback and restores the browse UI.
  beforeNavigate(() => {
    if ($playing) {
      invoke('close_player').catch(() => {})
      playing.set(false)
    }
  })
</script>

<!-- Solid app floor; hidden while playing so mpv (behind the webview) shows. -->
{#if !$playing}<Background />{/if}
<!-- Chrome hides only in fullscreen playback (edge-to-edge video); stays visible
     and clickable over windowed playback. -->
{#if !($playing && $fullscreen)}
  <Sidebar />
  <Titlebar />
{/if}
<!-- No `overflow-x-clip` here: it would clip the Hero banner's full-bleed
     (`-left-14 w-screen`) so it never reaches under the sidebar, leaving a black
     column. Horizontal overflow is clipped on <body> instead (app.css).
     Hidden while playing so its opaque content doesn't block the video. -->
<main class="relative ml-14 min-h-screen" class:hidden={$playing}>{@render children()}</main>
{#if $playing}<PlayerOverlay />{/if}
<StreamPicker />
