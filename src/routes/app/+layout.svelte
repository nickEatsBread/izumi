<script lang="ts">
  import Sidebar from '$lib/components/shell/Sidebar.svelte'
  import BottomNav from '$lib/components/shell/BottomNav.svelte'
  import Background from '$lib/components/shell/Background.svelte'
  import Titlebar from '$lib/components/shell/Titlebar.svelte'
  import OnlineBanner from '$lib/components/shell/OnlineBanner.svelte'
  import PlayerOverlay from '$lib/components/player/PlayerOverlay.svelte'
  import AndroidPlayer from '$lib/components/player/AndroidPlayer.svelte'
  import CommentsPanel from '$lib/components/player/CommentsPanel.svelte'
  import { androidMpvActive } from '$lib/player/android-mpv'
  import StreamPicker from '$lib/components/player/StreamPicker.svelte'
  import DebridCaching from '$lib/components/player/DebridCaching.svelte'
  import ExitPrompt from '$lib/components/shell/ExitPrompt.svelte'
  import OnScreenKeyboard from '$lib/components/shell/OnScreenKeyboard.svelte'
  import DeckKeyboardWarning from '$lib/components/shell/DeckKeyboardWarning.svelte'
  import LofiPlayer from '$lib/components/shell/LofiPlayer.svelte'
  import { playing, fullscreen, gameMode, initGameMode, debridCaching } from '$lib/player/session'
  import { uiScale, enableDoH, doHUrl, playerCacheMb, playerCacheBytes, autoUpdateCheck } from '$lib/settings/ui'
  import { afterNavigate, beforeNavigate } from '$app/navigation'
  import { invoke } from '@tauri-apps/api/core'
  import { initInput, initDpadNav, suppressNativeContextMenus, suppressNativeTooltips } from '$lib/nav'
  import { startGamepadNav } from '$lib/nav/gamepad'
  import { attachDownloadEvents } from '$lib/downloads/store'
  import { getIndex } from '$lib/stremio/idmap'
  import { fetchManifest } from '$lib/stremio/manifest'
  import { enabledAddonUrls } from '$lib/stremio/sources'
  import { warmExtensions } from '$lib/extensions/manager'
  import { refreshAniListAvatar } from '$lib/trackers/anilist-auth'
  import { refreshMalViewer } from '$lib/trackers/mal-auth'
  import { isAndroid, isMobile, initPlatform } from '$lib/platform'
  import { initOffline } from '$lib/stores/offline'
  import { initReturnTracking, watchToast } from '$lib/player/android-tracking'
  import { initTrackerQueue } from '$lib/trackers/queue'
  import { initDeviceSync } from '$lib/sync/client'
  import { startUpdateChecks } from '$lib/updater'
  import UpdateToast from '$lib/components/shell/UpdateToast.svelte'
  import { get } from 'svelte/store'
  let { children } = $props()
  // Push a BASELINE player cache to the backend on load + whenever the setting changes (playback
  // re-sizes it per file by bitrate in play.ts). Handles the Uncapped sentinel. Picked up next file.
  $effect(() => { invoke('set_player_cache', { bytes: playerCacheBytes(Number($playerCacheMb)) }).catch(() => {}) })
  // Game mode (Deck): start the backend controller reader + the app-wide gamepad→nav
  // translator once gamescope/Deck mode is resolved. Reacts to the async gameMode store.
  $effect(() => {
    if (!$gameMode) return
    suppressNativeTooltips() // no native `title` hover popups under controller/touch
    suppressNativeContextMenus() // held presses must not open WebKit's desktop link menu
    invoke('gamepad_start').catch(() => {})
    const stop = startGamepadNav()
    return () => { stop(); invoke('gamepad_stop').catch(() => {}) }
  })
  $effect(() => {
    initPlatform() // resolve isAndroid/isMobile FIRST — playback + nav branch on it
    initOffline() // latch offline mode from launch connectivity + the persisted force toggle
    if (get(isAndroid)) initReturnTracking() // return-to-app = watched (external-player flow)
    // Cross-platform update check: a delayed launch check + a 6h interval. Gated to packaged
    // builds so dev never nags. The facade dispatches per platform (desktop/android/flatpak);
    // the toast is still opt-in to APPLY. `autoUpdateCheck` is read each tick, so toggling it
    // in settings takes effect without a restart.
    let stopUpdates: (() => void) | null = null
    if (!import.meta.env.DEV) stopUpdates = startUpdateChecks(() => get(autoUpdateCheck))
    initInput()
    initDpadNav()
    initGameMode() // resolve gamescope/Deck fullscreen-touch mode once (drives chrome-hiding)
    attachDownloadEvents() // wire download progress/done events + resume interrupted jobs (guarded, once)
    initTrackerQueue() // wire the online-reconnect flush + boot-flush any tracker writes that failed offline
    initDeviceSync() // account-free Iroh watch sync (automatically gated off by AniList/MAL)
    // Pre-warm the Fribb id map (kitsu lookup) at boot — it's a ~6MB one-time fetch
    // (persisted to idb after), so a fresh install's FIRST play doesn't eat it on the
    // click-to-play path. Fire-and-forget; getIndex is cached/idempotent.
    getIndex().catch(() => {})
    // Warm each addon's connection on the shared pooled HTTP client (and cache its
    // manifest) so the FIRST play skips the ~200ms TLS handshake and the picker has
    // logos ready. Only effective now that http_get pools connections.
    for (const base of get(enabledAddonUrls)) fetchManifest(base).catch(() => {})
    // Same idea for source extensions: pre-boot the whole runtime (manifest + esm.sh modules +
    // workers) now, off the click-to-play path — the reference client does this at startup too,
    // which is why its first picker open is instant while ours paid the full build.
    warmExtensions()
    // Refresh the signed-in profile (name + avatar) for an already-connected session,
    // so the sidebar shows the real picture without needing a re-login. No-op if not
    // connected. Fire-and-forget.
    refreshAniListAvatar().catch(() => {})
    refreshMalViewer().catch(() => {})
    return () => stopUpdates?.() // tear the update timer down on unmount (mirrors the gamepad effect)
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
    // Game mode (gamescope): scale the browse UI up ~25% for the Deck's small screen +
    // controller distance. Not while the player is up (its controls are already sized for
    // touch). `gamemode` class drives the no-cursor + focus-highlight rules in app.css.
    const z = $uiScale * ($gameMode && !$playing ? 1.25 : 1)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rootStyle = document.documentElement.style as any
    if ($isMobile) {
      // Mobile never applies the desktop/Deck UI-scale (a persisted value would zoom the whole page).
      rootStyle.zoom = '1'
    } else if ($gameMode) {
      // Native WebKit page zoom (compositor-scrolled) rather than CSS `zoom` on the scroll
      // root — CSS zoom re-rasterizes the whole page on every scroll, which is what made
      // vertical scrolling crawl on the Deck. Native zoom scrolls like a zoomed desktop page.
      rootStyle.zoom = '1'
      invoke('set_webview_zoom', { level: z }).catch(() => {})
    } else {
      rootStyle.zoom = String(z)
    }
    document.documentElement.classList.toggle('gamemode', $gameMode)
  })

  // Single-window player: mpv renders into THIS window, behind the webview. When
  // playing, punch a transparent hole — drop the opaque app background (app.css
  // paints html/body solid) so mpv shows through the overlay's transparent areas.
  $effect(() => {
    // Also punch the hole for the embedded Android player (its SurfaceView renders behind the webview).
    const holePunched = $playing || $androidMpvActive
    const bg = holePunched ? 'transparent' : ''
    document.documentElement.style.background = bg
    document.body.style.background = bg
    // Lock page scroll while the player is open. On the Deck a drag in the video area was
    // being taken as a native pan/rubber-band that shoved the (fixed) overlay + video out of
    // place; with the document non-scrollable there's nothing to pan.
    const lock = holePunched ? 'hidden' : ''
    document.documentElement.style.overflow = lock
    document.body.style.overflow = lock
  })
  // Inset the video to the RIGHT of the 56px sidebar rail while playing windowed, so
  // it never renders under the black sidebar. NOT inset at the top: the video fills
  // full height and the transparent titlebar overlays it — a top inset
  // exposed the opaque window background as a black band under the titlebar.
  // Full-frame in fullscreen (chrome hidden) and 0 in browse. Physical px = CSS × DPR.
  $effect(() => {
    // Game mode = always fullscreen video (no sidebar rail), so no inset there either.
    const left = $playing && !$fullscreen && !$gameMode ? Math.round(56 * $uiScale * window.devicePixelRatio) : 0
    invoke('player_set_inset', { left, top: 0 }).catch(() => {})
  })
  // Navigating away (e.g. a sidebar link) exits playback and restores the browse UI.
  beforeNavigate(() => {
    if ($playing) {
      invoke('close_player').catch(() => {})
      playing.set(false)
    }
  })
  // Gamescope may switch the XWayland touch mode while a controller action changes screens. The
  // gamepad-side restore runs shortly after the button press; this second restore runs after Svelte
  // has completed the navigation, so touch scrolling remains available on the destination screen.
  afterNavigate(() => {
    if (get(gameMode)) invoke('restore_native_touch').catch(() => {})
  })
</script>

<!-- Solid app floor; hidden while playing so mpv (behind the webview) shows. -->
{#if !$playing && !$androidMpvActive}<Background />{/if}
<!-- Chrome hides in fullscreen playback (edge-to-edge video); stays visible and
     clickable over windowed playback. Game mode (Deck/gamescope) is always fullscreen
     touch — no sidebar/titlebar while playing, just the content. -->
{#if !($playing && ($fullscreen || $gameMode)) && !$androidMpvActive}
  <!-- Mobile: a bottom tab bar instead of the left rail. -->
  {#if $isMobile}<BottomNav />{:else}<Sidebar />{/if}
  <!-- No window-control titlebar in Game mode (gamescope owns the fullscreen window; the
       minimize/maximize/close icons are meaningless + unreachable there) or on mobile. -->
  {#if !$gameMode && !$isMobile}<Titlebar />{/if}
  <OnlineBanner />
{/if}
<!-- Lo-fi speaker: only while an uncached torrent is caching at the debrid service
     (the loading screen). Sits above the caching overlay (z-[60]). Desktop only. -->
{#if $debridCaching && !$gameMode && !$isMobile}<LofiPlayer />{/if}
<!-- No `overflow-x-clip` here: it would clip the Hero banner's full-bleed
     (`-left-14 w-screen`) so it never reaches under the sidebar, leaving a black
     column. Horizontal overflow is clipped on <body> instead (app.css).
     Hidden while playing so its opaque content doesn't block the video. -->
<main class="relative min-h-screen {$isMobile ? 'mb-[calc(4rem+env(safe-area-inset-bottom))]' : 'ml-14'}" class:hidden={$playing || $androidMpvActive}>{@render children()}</main>
{#if $playing}<PlayerOverlay />{/if}
<!-- Touch overlay for the embedded Android libmpv player + its discussion panel (self-gates on
     commentsOpen; the desktop mounts its own inside PlayerOverlay). -->
{#if $androidMpvActive}<AndroidPlayer />{/if}
{#if $androidMpvActive}<CommentsPanel />{/if}
<StreamPicker />
<DebridCaching />
<ExitPrompt />
<OnScreenKeyboard />
<DeckKeyboardWarning />
<!-- Android external-play "marked watched" toast (the in-player overlay isn't mounted on mobile). -->
{#if $watchToast}
  <div class="fixed inset-x-0 bottom-20 z-[60] mx-auto flex w-fit max-w-[92vw] items-center gap-3 rounded-full bg-neutral-900/95 px-4 py-2.5 text-sm text-white shadow-lg">
    <span class="truncate">{$watchToast.text}</span>
    <button data-focusable onclick={() => $watchToast?.undo()} class="shrink-0 font-bold text-theme">Undo</button>
  </div>
{/if}
<!-- Cross-platform update toast (available → downloading → ready); opt-in to apply. -->
<UpdateToast />
