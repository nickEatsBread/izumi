<script lang="ts">
  import Sidebar from '$lib/components/shell/Sidebar.svelte'
  import Background from '$lib/components/shell/Background.svelte'
  import Titlebar from '$lib/components/shell/Titlebar.svelte'
  import OnlineBanner from '$lib/components/shell/OnlineBanner.svelte'
  import PlayerOverlay from '$lib/components/player/PlayerOverlay.svelte'
  import StreamPicker from '$lib/components/player/StreamPicker.svelte'
  import { playing, fullscreen } from '$lib/player/session'
  import { uiScale, enableDoH, doHUrl } from '$lib/settings/ui'
  import { beforeNavigate } from '$app/navigation'
  import { invoke } from '@tauri-apps/api/core'
  import { initInput, initDpadNav } from '$lib/nav'
  import { attachDownloadEvents } from '$lib/downloads/store'
  import { getIndex } from '$lib/stremio/idmap'
  import { fetchManifest } from '$lib/stremio/manifest'
  import { addonUrls } from '$lib/stremio/sources'
  import { refreshAniListAvatar } from '$lib/trackers/anilist-auth'
  import { refreshMalViewer } from '$lib/trackers/mal-auth'
  import { get } from 'svelte/store'
  let { children } = $props()
  $effect(() => {
    initInput()
    initDpadNav()
    attachDownloadEvents() // wire download progress/done events + resume interrupted jobs (guarded, once)
    // Pre-warm the Fribb id map (kitsu lookup) at boot — it's a ~6MB one-time fetch
    // (persisted to idb after), so a fresh install's FIRST play doesn't eat it on the
    // click-to-play path. Fire-and-forget; getIndex is cached/idempotent.
    getIndex().catch(() => {})
    // Warm each addon's connection on the shared pooled HTTP client (and cache its
    // manifest) so the FIRST play skips the ~200ms TLS handshake and the picker has
    // logos ready. Only effective now that http_get pools connections.
    for (const base of get(addonUrls)) fetchManifest(base).catch(() => {})
    // Refresh the signed-in profile (name + avatar) for an already-connected session,
    // so the sidebar shows the real picture without needing a re-login. No-op if not
    // connected. Fire-and-forget.
    refreshAniListAvatar().catch(() => {})
    refreshMalViewer().catch(() => {})
  })

  // Push the DNS-over-HTTPS setting into the Rust HTTP client. Reactive: runs on
  // startup and whenever the toggle/URL change, so the pooled client (addons, AniZip,
  // id-map, Kitsu, downloads, prefetch) rebuilds with or without the DoH resolver.
  $effect(() => {
    invoke('set_doh', { enabled: $enableDoH, url: $doHUrl }).catch(() => {})
  })

  // UI scale: WebView (Chromium) zoom on the document root. mpv renders natively
  // behind the webview and is unaffected, so the sidebar-inset math below scales by
  // the same factor to keep the video hole aligned with the (zoomed) sidebar rail.
  $effect(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(document.documentElement.style as any).zoom = String($uiScale)
  })

  // Single-window player: mpv renders into THIS window, behind the webview. When
  // playing, punch a transparent hole — drop the opaque app background (app.css
  // paints html/body solid) so mpv shows through the overlay's transparent areas.
  $effect(() => {
    const bg = $playing ? 'transparent' : ''
    document.documentElement.style.background = bg
    document.body.style.background = bg
  })
  // Inset the video to the RIGHT of the 56px sidebar rail while playing windowed, so
  // it never renders under the black sidebar. NOT inset at the top: the video fills
  // full height and the transparent titlebar overlays it — a top inset
  // exposed the opaque window background as a black band under the titlebar.
  // Full-frame in fullscreen (chrome hidden) and 0 in browse. Physical px = CSS × DPR.
  $effect(() => {
    const left = $playing && !$fullscreen ? Math.round(56 * $uiScale * window.devicePixelRatio) : 0
    invoke('player_set_inset', { left, top: 0 }).catch(() => {})
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
  <OnlineBanner />
{/if}
<!-- No `overflow-x-clip` here: it would clip the Hero banner's full-bleed
     (`-left-14 w-screen`) so it never reaches under the sidebar, leaving a black
     column. Horizontal overflow is clipped on <body> instead (app.css).
     Hidden while playing so its opaque content doesn't block the video. -->
<main class="relative ml-14 min-h-screen" class:hidden={$playing}>{@render children()}</main>
{#if $playing}<PlayerOverlay />{/if}
<StreamPicker />
