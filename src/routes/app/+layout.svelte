<script lang="ts">
  import Sidebar from '$lib/components/shell/Sidebar.svelte'
  import BottomNav from '$lib/components/shell/BottomNav.svelte'
  import Background from '$lib/components/shell/Background.svelte'
  import Titlebar from '$lib/components/shell/Titlebar.svelte'
  import OnlineBanner from '$lib/components/shell/OnlineBanner.svelte'
  import IncognitoBanner from '$lib/components/shell/IncognitoBanner.svelte'
  import AniListDegradedBanner from '$lib/components/shell/AniListDegradedBanner.svelte'
  import { androidMiniPlayer, androidMpvActive } from '$lib/player/android-mpv'
  import OnScreenKeyboard from '$lib/components/shell/OnScreenKeyboard.svelte'
  // Lazy-mounted: the player stack + its source-resolve overlays are substantial but never render
  // until playback/resolve starts. Loading them on demand
  // keeps first home paint off that code entirely. See Lazy.svelte.
  import Lazy from '$lib/components/Lazy.svelte'
  import PlayFeedback from '$lib/components/PlayFeedback.svelte'
  import { title as mediaTitle, banner as mediaBanner, cover as mediaCover } from '$lib/anilist/media'
  const loadPlayerOverlay = () => import('$lib/components/player/PlayerOverlay.svelte')
  const loadAndroidPlayer = () => import('$lib/components/player/AndroidPlayer.svelte')
  const loadAndroidPreparingPlayer = () => import('$lib/components/player/AndroidPreparingPlayer.svelte')
  const loadCommentsPanel = () => import('$lib/components/player/CommentsPanel.svelte')
  const loadPartyPresence = () => import('$lib/components/watch/PartyPresence.svelte')
  const loadStreamPicker = () => import('$lib/components/player/StreamPicker.svelte')
  const loadDebridCaching = () => import('$lib/components/player/DebridCaching.svelte')
  const loadSourceConnecting = () => import('$lib/components/player/SourceConnecting.svelte')
  const loadExitPrompt = () => import('$lib/components/shell/ExitPrompt.svelte')
  const loadGlobalSearch = () => import('$lib/components/search/GlobalSearch.svelte')
  const loadTrailerDialog = () => import('$lib/components/cards/TrailerDialog.svelte')
  // NOT lazy: its onMount registers the `deck-keyboard-warning` listener that ANSWERS the native
  // side, and the native login popup stays hidden until that answer arrives. Mounting it only once
  // `$deckKeyboardWarning` is set would be circular — the listener is what leads to the store being
  // set — so a Deck third-party sign-in would open a window that never becomes visible. Small
  // component; it self-gates its own dialog.
  import DeckKeyboardWarning from '$lib/components/shell/DeckKeyboardWarning.svelte'
  const loadLofiPlayer = () => import('$lib/components/shell/LofiPlayer.svelte')
  import { streamPicker, connecting, exitPrompt, nowPlayingMedia } from '$lib/player/session'
  import { playing, fullscreen, pictureInPicture, exitPictureInPicture, gameMode, gameModeResolved, initGameMode, debridCaching } from '$lib/player/session'
  import { uiScale, enableDoH, doHUrl, playerCacheMb, playerCacheBytes, hotkeyBindings } from '$lib/settings/ui'
  import { catalogDefaultProvider, catalogLastProvider, catalogProvider, catalogProviders, catalogScreen, catalogScreens, enabledCatalogProviders, enabledCatalogScreens, nextCatalogScreen, previousCatalogScreen, resolveCatalogStartup, selectCatalogProvider, selectCatalogScreen } from '$lib/settings/catalog'
  import { afterNavigate, beforeNavigate, goto } from '$app/navigation'
  import { invoke } from '@tauri-apps/api/core'
  import { getCurrentWindow } from '@tauri-apps/api/window'
  import { initInput, initDpadNav, suppressNativeContextMenus, suppressNativeTooltips } from '$lib/nav'
  import { startGamepadNav } from '$lib/nav/gamepad'
  import { attachDownloadEvents } from '$lib/downloads/store'
  import { scheduleBootWork } from '$lib/util/boot-work'
  import { isAndroid, isMacOS, isMobile, isTv, initPlatform } from '$lib/platform'
  import { initOffline } from '$lib/stores/offline'
  import { initReturnTracking, watchToast } from '$lib/player/android-tracking'
  import { initTrackerQueue } from '$lib/trackers/queue'
  import { initAutoIncognito } from '$lib/player/auto-incognito'
  import { initDeviceSync } from '$lib/sync/client'
  import { getContextClient } from '@urql/svelte'
  import { acceptCompanionPlayRequest, initCompanionConnections } from '$lib/companion/client'
  import { initCompanionSourceBridge, selectPendingCompanionSource } from '$lib/companion/source-bridge'
  import { createCompanionDetails, createCompanionSearch, createCompanionSnapshot } from '$lib/companion/snapshot'
  import type { CompanionMedia } from '$lib/companion/protocol'
  import { initAutoDownloads } from '$lib/downloads/rules'
  import { initWatchTogether } from '$lib/watch-together/client'
  import { initAiringNotifications } from '$lib/notifications/airing'
  import { deepLinkNotice, initDeepLinks, showDeepLinkNotice } from '$lib/deep-links'
  import { initTorrentVpnToasts, torrentVpnNotice } from '$lib/player/direct-torrent'
  import { startUpdateChecks } from '$lib/updater'
  import { startExtensionUpdateChecks, extensionUpdateNotice } from '$lib/extensions/auto-update'
  import UpdateToast from '$lib/components/shell/UpdateToast.svelte'
  import FirstRunSetup from '$lib/components/onboarding/FirstRunSetup.svelte'
  import UpNextOverlay from '$lib/components/player/UpNextOverlay.svelte'
  import { get } from 'svelte/store'
  import { initCrashReporting } from '$lib/diagnostics'
  import { initDeveloperLogging } from '$lib/debug/native-logging'
  import { rememberScroll, restoreScroll } from '$lib/navigation/scroll-restoration'
  import { initGmTouchWatchdog, restoreGmTouchAfterTransition } from '$lib/player/gm-touch-watchdog'
  import { deckWebviewZoom } from '$lib/deck/webview-zoom'
  import { globalSearchOpen, closeGlobalSearch, openGlobalSearch } from '$lib/search/global-search'
  import { trailerPopup } from '$lib/stores/trailer'
  import { findHotkey, isTypingTarget } from '$lib/hotkeys'
  import { markClientPerformance } from '$lib/performance/client'
  import * as h from '$lib/haptics'
  let { children } = $props()
  const companionCatalogClient = getContextClient()
  let globalSearchMounted = $state(false)
  let trailerDialogMounted = $state(false)
  const androidWatchTarget = $derived.by(() => {
    if (!$isAndroid) return null
    const caching = $debridCaching
    if (caching?.media) return { media: caching.media, episode: caching.episode }
    const connection = $connecting
    if (connection?.media) return { media: connection.media, episode: connection.episode }
    const picker = $streamPicker
    if (picker?.media) return { media: picker.media, episode: picker.episode }
    if ($androidMpvActive && $nowPlayingMedia) return $nowPlayingMedia
    return null
  })
  $effect(() => {
    if ($globalSearchOpen) globalSearchMounted = true
    if ($trailerPopup) trailerDialogMounted = true
  })

  // Catalog navigation is logo-driven, so there is no longer a tab component around to repair an
  // unavailable active value. Keep fixed defaults inside the enabled set; Adaptive remains a
  // startup policy rather than a provider and resolves through the last explicitly selected one.
  $effect(() => {
    const enabled = $enabledCatalogProviders
    if (!enabled.length) return
    const screens = catalogScreens(enabled)
    if ($catalogDefaultProvider !== 'adaptive' && !screens.includes($catalogDefaultProvider)) {
      $catalogDefaultProvider = enabled[0]
    }
    const fallback = resolveCatalogStartup($catalogDefaultProvider, $catalogLastProvider, enabled)
    if (!enabled.includes($catalogProvider)) {
      if ($catalogScreen === 'merged' && screens.includes('merged')) {
        $catalogProvider = fallback
        $catalogLastProvider = fallback
      } else {
        selectCatalogProvider(fallback)
      }
    }
    if (!screens.includes($catalogScreen)) selectCatalogProvider(fallback)
  })

  function handleShellKeydown(event: KeyboardEvent) {
    if (event.defaultPrevented) return
    const catalogAction = findHotkey(event, $hotkeyBindings, 'Home', $isMacOS)
    if ((catalogAction === 'homeNextCatalog' || catalogAction === 'homePreviousCatalog')
        && $enabledCatalogScreens.length > 1
        && !$playing && !$androidMpvActive && !isTypingTarget(event.target)
        && !document.querySelector('[data-nav-trap]')) {
      event.preventDefault()
      h.tap()
      selectCatalogScreen(catalogAction === 'homePreviousCatalog'
        ? previousCatalogScreen($catalogScreen, $catalogProviders)
        : nextCatalogScreen($catalogScreen, $catalogProviders))
      void goto('/app/home')
      return
    }
    if (!$globalSearchOpen && !$playing && !document.querySelector('[data-nav-trap]')
        && !isTypingTarget(event.target)
        && findHotkey(event, $hotkeyBindings, 'Global', $isMacOS) === 'globalSearch') {
      event.preventDefault()
      openGlobalSearch()
    } else if ($globalSearchOpen && event.key === 'Escape') {
      event.preventDefault()
      closeGlobalSearch()
    } else if ($isTv && ['Escape', 'BrowserBack', 'GoBack'].includes(event.key)
        && !$playing && !$androidMpvActive && !isTypingTarget(event.target)) {
      // The native activity translates remote Back to Escape. Visible modals consume it first;
      // otherwise match TV launchers: back through screens, then ask before leaving Home.
      if (document.querySelector('[data-nav-trap]')) return
      event.preventDefault()
      if (location.pathname.replace(/\/$/, '') === '/app/home') {
        // Android TV's Back contract ends at the launcher; closing the native window finishes
        // the activity instead of showing the desktop confirmation dialog.
        void getCurrentWindow().close().catch(() => {})
      }
      else history.back()
    }
  }
  const skipSpeculativeNetwork = () => {
    const connection = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection
    return !navigator.onLine || connection?.saveData === true
  }
  // Push a BASELINE player cache to the backend on load + whenever the setting changes (playback
  // re-sizes it per file by bitrate in play.ts). Handles the Uncapped sentinel. Picked up next file.
  $effect(() => { invoke('set_player_cache', { bytes: playerCacheBytes(Number($playerCacheMb)) }).catch(() => {}) })
  // Game mode (Deck): start the backend controller reader + the app-wide gamepad→nav
  // translator once gamescope/Deck mode is resolved. Reacts to the async gameMode store.
  let webviewZoomChain: Promise<unknown> = Promise.resolve()
  $effect(() => {
    if (!$gameModeResolved) return
    if (!$gameMode) return
    // Gamescope touch survival: gesture-aware keepalive hold + stuck-pointer recovery (a lost
    // touch-up strands the pointer forever on this WebKitGTK — no pointercancel exists there).
    return initGmTouchWatchdog()
  })
  $effect(() => {
    if (!$gameMode) return
    suppressNativeTooltips() // no native `title` hover popups under controller/touch
    suppressNativeContextMenus() // held presses must not open WebKit's desktop link menu
    invoke('gamepad_start').catch(() => {})
    const stop = startGamepadNav()
    return () => { stop(); invoke('gamepad_stop').catch(() => {}) }
  })
  $effect(() => {
    initCrashReporting()
    markClientPerformance('izumi:app-layout-mounted')
    initPlatform() // resolve isAndroid/isMobile FIRST — playback + nav branch on it
    const stopDeveloperLogging = get(isAndroid) ? () => {} : initDeveloperLogging()
    initOffline() // latch offline mode from launch connectivity + the persisted force toggle
    if (get(isAndroid)) initReturnTracking() // return-to-app = watched (external-player flow)
    // Cross-platform update check: a delayed launch check + a 6h interval, always on (there's no
    // opt-out — a stale client is a support problem). Gated to packaged builds so dev never nags.
    // The facade dispatches per platform (desktop/android/flatpak); the toast is still opt-in to APPLY.
    let stopUpdates: (() => void) | null = null
    if (!import.meta.env.DEV) stopUpdates = startUpdateChecks()
    // Same cadence for installed .izumi-ext packages: catalogs are fetched live everywhere else,
    // but an INSTALLED package is a local copy that goes stale until someone reinstalls it. The
    // check reuses the sha-pinned catalog install path and skips itself during playback.
    let stopExtensionUpdates: (() => void) | null = null
    if (!import.meta.env.DEV) stopExtensionUpdates = startExtensionUpdateChecks()
    initInput()
    initDpadNav()
    initGameMode() // resolve gamescope/Deck fullscreen-touch mode once (drives chrome-hiding)
    attachDownloadEvents() // wire download progress/done events + resume interrupted jobs (guarded, once)
    initTrackerQueue() // wire the online-reconnect flush + boot-flush any tracker writes that failed offline
    initAutoIncognito() // adult play → incognito (setting-gated); exits + purges when playback closes
    initDeviceSync() // account-free Iroh watch sync (automatically gated off by connected trackers)
    const stopCompanionSources = initCompanionSourceBridge()
    const stopCompanions = initCompanionConnections(
      () => createCompanionSnapshot(companionCatalogClient),
      (media: CompanionMedia, device, context) => {
        showDeepLinkNotice(media.playback?.selection === 'manual'
          ? 'Finding sources for your TV. Choose one on the TV screen.'
          : 'Finding the best source for your TV…')
        void goto(acceptCompanionPlayRequest(media, device, context))
      },
      (query: string) => createCompanionSearch(companionCatalogClient, query),
      (media: CompanionMedia) => createCompanionDetails(media),
      selectPendingCompanionSource,
    )
    const stopAutoDownloads = initAutoDownloads()
    const stopWatchTogether = initWatchTogether()
    const stopAiringNotifications = initAiringNotifications()
    const stopVpnToasts = initTorrentVpnToasts()
    let stopDeepLinks: () => void = () => {}
    initDeepLinks().then((stop) => { stopDeepLinks = stop }).catch(() => {})
    // Aniyomi is a complete Home provider, so its runtime needs to be ready before the user switches
    // to it. Warm only that runtime after first paint when it is enabled; the later extension task
    // reuses the same in-flight/result cache and still owns the broader JS worker startup.
    void scheduleBootWork('aniyomi-catalog', async () => {
      if (skipSpeculativeNetwork() || !get(enabledCatalogProviders).includes('jvm')) return
      const { warmJvmExtensions } = await import('$lib/extensions/manager')
      await warmJvmExtensions()
    }, 1200)
    // Import the manifest/source graph only after first paint. Warm connections sequentially so a
    // large source list does not contend with the hero request or open many TLS handshakes at once.
    void scheduleBootWork('addon-manifests', async () => {
      if (skipSpeculativeNetwork()) return
      const [{ fetchManifest }, { enabledAddonUrls }] = await Promise.all([
        import('$lib/stremio/manifest'), import('$lib/stremio/sources'),
      ])
      for (const base of get(enabledAddonUrls)) await fetchManifest(base).catch(() => undefined)
    }, 1800)
    // Warm both the lazily-split UI and native player core once boot is quiet, so the first Play /
    // source pick pays neither module-load nor libmpv-initialization latency. This stays off the
    // first-paint critical path.
    void scheduleBootWork('player', async () => {
      const core = get(isAndroid)
        ? import('$lib/player/android-mpv').then(({ prepareEmbeddedPlayer }) => prepareEmbeddedPlayer())
        : invoke('prepare_player').catch(() => false)
      await Promise.all([
        loadStreamPicker(), loadSourceConnecting(),
        get(isAndroid) ? loadAndroidPlayer() : loadPlayerOverlay(),
        core,
      ])
    }, 2500)
    // Profile refreshes are useful but never launch-critical. Their modules and network requests
    // stay out of the shell path and yield to any interaction through BootWorkQueue.
    void scheduleBootWork('profiles', async () => {
      if (skipSpeculativeNetwork()) return
      const [{ refreshAniListAvatar }, { refreshMalViewer }, { refreshKitsuViewer }, { refreshSimklViewer }] = await Promise.all([
        import('$lib/trackers/anilist-auth'), import('$lib/trackers/mal-auth'),
        import('$lib/trackers/kitsu-auth'), import('$lib/trackers/simkl-auth'),
      ])
      await Promise.allSettled([refreshAniListAvatar(), refreshMalViewer(), refreshKitsuViewer(), refreshSimklViewer()])
    }, 4500)
    // Worker creation and a possible JVM/JRE setup are the heaviest speculative jobs. The manager
    // itself is dynamically imported and its JS/JVM warmers run sequentially.
    void scheduleBootWork('extensions', async () => {
      if (skipSpeculativeNetwork()) return
      const { warmExtensions } = await import('$lib/extensions/manager')
      await warmExtensions()
    }, 6500)
    return () => { stopDeveloperLogging(); stopUpdates?.(); stopExtensionUpdates?.(); stopCompanions(); stopCompanionSources(); stopAutoDownloads(); stopWatchTogether(); stopAiringNotifications(); stopVpnToasts(); stopDeepLinks() }
  })

  // Push the DNS-over-HTTPS setting into the Rust HTTP client. Reactive: runs on
  // startup and whenever the toggle/URL change, so the pooled client (addons, AniZip,
  // id-map, Kitsu, downloads, prefetch) rebuilds with or without the DoH resolver.
  $effect(() => {
    invoke('set_doh', { enabled: $enableDoH, url: $doHUrl }).catch(() => {})
  })

  $effect(() => {
    document.documentElement.classList.toggle('tv-mode', $isTv)
  })

  // UI scale: WebView (Chromium) zoom on the document root. mpv renders natively
  // behind the webview and is unaffected, so the sidebar-inset math below scales by
  // the same factor to keep the video hole aligned with the (zoomed) sidebar rail.
  $effect(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rootStyle = document.documentElement.style as any
    // Desktop can apply its ordinary CSS scale immediately. A Gamescope document has the native
    // launch-pending class and remains hidden here until detection chooses native page zoom below.
    if (!$gameModeResolved) {
      rootStyle.zoom = $isMobile ? '1' : String($uiScale)
      return
    }
    // Game mode (gamescope): scale the browse UI up ~25% for the Deck's small screen +
    // controller distance. Not while the player is up (its controls are already sized for
    // touch). `gamemode` class drives the no-cursor + focus-highlight rules in app.css.
    const z = $gameMode ? deckWebviewZoom($uiScale, $playing) : $uiScale
    if ($isMobile) {
      // Mobile never applies the desktop/Deck UI-scale (a persisted value would zoom the whole page).
      rootStyle.zoom = '1'
    } else if ($gameMode) {
      // Native WebKit page zoom (compositor-scrolled) rather than CSS `zoom` on the scroll
      // root — CSS zoom re-rasterizes the whole page on every scroll, which is what made
      // vertical scrolling crawl on the Deck. Native zoom scrolls like a zoomed desktop page.
      rootStyle.zoom = '1'
      // Keep native zoom changes ordered: a late browse callback must never overwrite the
      // player's 1:1 request. Reveal the launch document only at its final Deck scale.
      webviewZoomChain = webviewZoomChain
        .catch(() => {})
        .then(() => invoke('set_webview_zoom', { level: z }))
        .finally(() => requestAnimationFrame(() => requestAnimationFrame(() => {
          document.documentElement.classList.remove('deck-launch-pending')
        })))
    } else {
      rootStyle.zoom = String(z)
      document.documentElement.classList.remove('deck-launch-pending')
    }
    document.documentElement.classList.toggle('gamemode', $gameMode)
  })

  // Closing playback does not navigate, so afterNavigate cannot repair a touch release swallowed
  // by a comments iframe. Reset native routing as the browse surface becomes active again.
  let playerWasOpen = false
  $effect(() => {
    const open = $playing
    if ($gameMode && playerWasOpen && !open) restoreGmTouchAfterTransition()
    playerWasOpen = open
  })

  // Single-window player: mpv renders into THIS window, behind the webview. When
  // playing, punch a transparent hole — drop the opaque app background (app.css
  // paints html/body solid) so mpv shows through the overlay's transparent areas.
  $effect(() => {
    // Also punch the hole for the embedded Android player (its SurfaceView renders behind the webview).
    // The in-app Android mini-player is a bounded SurfaceView raised ABOVE the browse WebView.
    // Browse must regain native document scrolling while it is present; treating every active
    // Android core as a full-screen player left html/body permanently overflow:hidden after a
    // swipe-down collapse. Background transparency and scroll locking are therefore separate.
    const videoSurfaceActive = $playing || $androidMpvActive
    const fullPlayerActive = $playing || ($androidMpvActive && !$androidMiniPlayer)
    // Keep the WebView root transparent during the collapse too: the native video is raised above
    // browse as soon as it starts shrinking, while route content paints normally everywhere else.
    const bg = videoSurfaceActive ? 'transparent' : ''
    document.documentElement.style.background = bg
    document.body.style.background = bg
    // Lock page scroll while the player is open. On the Deck a drag in the video area was
    // being taken as a native pan/rubber-band that shoved the (fixed) overlay + video out of
    // place; with the document non-scrollable there's nothing to pan.
    const lock = fullPlayerActive ? 'hidden' : ''
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
    const left = $playing && !$fullscreen && !$gameMode && !$pictureInPicture ? Math.round(56 * $uiScale * window.devicePixelRatio) : 0
    invoke('player_set_inset', { left, top: 0 }).catch(() => {})
  })
  // Navigating away (e.g. a sidebar link) exits playback and restores the browse UI.
  beforeNavigate(({ from }) => {
    if (from?.url) rememberScroll(from.url)
    if ($playing) {
      void exitPictureInPicture()
      invoke('close_player').catch(() => {})
      playing.set(false)
    }
  })
  // Gamescope may switch the XWayland touch mode while a controller action changes screens. The
  // gamepad-side restore runs shortly after the button press; this second restore runs after Svelte
  // has completed the navigation, so touch scrolling remains available on the destination screen.
  afterNavigate(({ to }) => {
    if (to?.url && !$playing) restoreScroll(to.url)
    if (get(gameMode)) invoke('restore_native_touch').catch(() => {})
    requestAnimationFrame(() => requestAnimationFrame(() => markClientPerformance(
      'izumi:route-painted',
      { path: to?.url.pathname ?? location.pathname },
    )))
  })
</script>

<svelte:window onkeydown={handleShellKeydown} />

<!-- Solid app floor; hidden while playing so mpv (behind the webview) shows. -->
{#if !$playing && (!$androidMpvActive || $androidMiniPlayer)}<Background />{/if}
<!-- Chrome hides in fullscreen playback (edge-to-edge video); stays visible and
     clickable over windowed playback. Game mode (Deck/gamescope) is always fullscreen
     touch — no sidebar/titlebar while playing, just the content. -->
{#if !($playing && ($fullscreen || $gameMode || $pictureInPicture)) && (!$androidMpvActive || $androidMiniPlayer)}
  <!-- Mobile: a bottom tab bar instead of the left rail. -->
  {#if $isMobile}<BottomNav />{:else}<Sidebar />{/if}
  <!-- No window-control titlebar in Game mode (gamescope owns the fullscreen window; the
       minimize/maximize/close icons are meaningless + unreachable there) or on mobile. -->
  {#if !$gameMode && !$isMobile && !$isTv}<Titlebar />{/if}
  <OnlineBanner />
  <!-- Incognito remains active during playback, but its persistent browse reminder must not cover
       the video or controls. It returns unchanged as soon as the player closes. -->
  {#if !$playing && !$androidMpvActive}<IncognitoBanner />{/if}
  <!-- Playback must remain visually clean, including the windowed desktop player where the shell
       chrome stays mounted. The degraded state is preserved and the banner returns on exit. -->
  {#if !$playing}<AniListDegradedBanner />{/if}
{/if}
<!-- Lo-fi speaker: only while an uncached torrent is caching at the debrid service
     (the loading screen). Sits above the caching overlay (z-[60]). Desktop only. -->
{#if $debridCaching && !$gameMode && !$isMobile}<Lazy load={loadLofiPlayer} />{/if}
<!-- No `overflow-x-clip` here: it would clip the Hero banner's full-bleed
     (`-left-14 w-screen`) so it never reaches under the sidebar, leaving a black
     column. Horizontal overflow is clipped on <body> instead (app.css).
     Hidden while playing so its opaque content doesn't block the video. -->
<main class="relative min-h-screen {$isMobile ? 'mb-[calc(4rem+env(safe-area-inset-bottom))]' : 'ml-14'}" class:hidden={$playing || ($androidMpvActive && !$androidMiniPlayer)}>{@render children()}</main>
{#if $playing}<Lazy load={loadPlayerOverlay} />{/if}
<!-- One Android watch-details instance spans source preparation and native playback. In particular,
     its Disqus iframe is never destroyed merely because libmpv presented its first frame. -->
{#if androidWatchTarget}
  <Lazy load={loadAndroidPreparingPlayer} props={{ ...androidWatchTarget, active: $androidMpvActive, mini: $androidMiniPlayer }} />
{/if}
<!-- Touch overlay for the embedded Android libmpv player + its discussion panel (self-gates on
     commentsOpen; the desktop mounts its own inside PlayerOverlay). -->
{#if $androidMpvActive}<Lazy load={loadAndroidPlayer} />{/if}
{#if $androidMpvActive}<Lazy load={loadCommentsPanel} />{/if}
{#if $androidMpvActive}<Lazy load={loadPartyPresence} props={{ floating: true }} />{/if}
<!-- Player-flow overlays: self-gated on their trigger store here so the module loads only when a
     resolve/cache/picker actually starts. -->
<!-- These two ARE the feedback for a tap on Play or an episode, so they carry a `pending` stand-in:
     on a cold cache the gate can open while the module is still on the network — without this the
     click produced an empty screen and then, seconds later, a video.
     The continuation case stays silent on purpose: a binge keeps the picker hidden, so covering the
     screen there would flash a selector the user never asked for. -->
{#if $streamPicker}
  <Lazy load={loadStreamPicker}>
    {#snippet pending()}
      {#if !$streamPicker?.hidden}
        <!-- Same title/artwork the picker's own loader uses, so the stand-in and the screen it
             precedes are the same screen. -->
        <PlayFeedback
          label={$streamPicker?.media ? mediaTitle($streamPicker.media) : ''}
          caption="Finding sources"
          art={$streamPicker?.media ? (mediaBanner($streamPicker.media) || mediaCover($streamPicker.media)) : ''}
        />
      {/if}
    {/snippet}
  </Lazy>
{/if}
{#if $connecting}
  <Lazy load={loadSourceConnecting}>
    {#snippet pending()}
      {#if $isAndroid}
        <div class="fixed inset-x-4 top-[calc(env(safe-area-inset-top)+56.25vw-0.375rem)] z-[55] overflow-hidden rounded-full bg-black/85 shadow-xl" role="status">
          <div class="bar-loader h-1.5 w-full"></div>
          <p class="truncate px-3 py-2 text-xs text-white/80">Connecting</p>
        </div>
      {:else}
        <PlayFeedback label={$connecting?.title ?? ''} art={$connecting?.art ?? ''} />
      {/if}
    {/snippet}
  </Lazy>
{/if}
{#if $debridCaching}<Lazy load={loadDebridCaching} />{/if}
{#if $exitPrompt}<Lazy load={loadExitPrompt} />{/if}
{#if globalSearchMounted}<Lazy load={loadGlobalSearch} />{/if}
{#if trailerDialogMounted}<Lazy load={loadTrailerDialog} />{/if}
<OnScreenKeyboard />
<DeckKeyboardWarning />
<!-- Android external-play "marked watched" toast (the in-player overlay isn't mounted on mobile). -->
{#if $watchToast}
  <div class="fixed inset-x-0 bottom-20 z-[60] mx-auto flex w-fit max-w-[92vw] items-center gap-3 rounded-full bg-neutral-900/95 px-4 py-2.5 text-sm text-white shadow-lg">
    <span class="truncate">{$watchToast.text}</span>
    <button data-focusable onclick={() => $watchToast?.undo()} class="shrink-0 font-bold text-theme">Undo</button>
  </div>
{/if}
<!-- Why a link from outside the app landed where it did — including links we couldn't read, which
     would otherwise look like the app ignoring the click. -->
{#if $deepLinkNotice}
  <div role="status" class="fixed inset-x-0 bottom-20 z-[60] mx-auto w-fit max-w-[92vw] truncate rounded-full bg-neutral-900/95 px-4 py-2.5 text-sm text-white shadow-lg">
    {$deepLinkNotice}
  </div>
{/if}
<!-- Direct P2P VPN kill switch state — without this, a VPN drop reads as a broken source while
     the native engine quietly holds every torrent until the adapter returns. -->
{#if $torrentVpnNotice}
  <div role="status" class="fixed inset-x-0 bottom-20 z-[60] mx-auto w-fit max-w-[92vw] truncate rounded-full bg-neutral-900/95 px-4 py-2.5 text-sm text-white shadow-lg">
    {$torrentVpnNotice}
  </div>
{/if}
<!-- Background extension auto-update result ("Updated X …"); self-clears after a few seconds. -->
{#if $extensionUpdateNotice}
  <div role="status" class="fixed inset-x-0 bottom-20 z-[60] mx-auto w-fit max-w-[92vw] truncate rounded-full bg-neutral-900/95 px-4 py-2.5 text-sm text-white shadow-lg">
    {$extensionUpdateNotice}
  </div>
{/if}
<!-- Cross-platform update toast (available → downloading → ready); opt-in to apply. -->
<UpdateToast />
<FirstRunSetup />
<UpNextOverlay />
