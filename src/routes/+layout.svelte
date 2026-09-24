<script lang="ts">
  import '@fontsource-variable/nunito'
  import '@fontsource/geist-mono'
  import '../app.css'
  import { setContextClient } from '@urql/svelte'
  import { anilist } from '$lib/anilist/client'
  import { onMount } from 'svelte'
  import { get } from 'svelte/store'
  import { invoke } from '@tauri-apps/api/core'
  import { getCurrentWindow } from '@tauri-apps/api/window'
  import { startQualitySync } from '$lib/player/quality'
  import { startEnhancementSync } from '$lib/player/enhancements'
  import { startDolbySync } from '$lib/player/dolby'
  import { startThemeSync } from '$lib/theme'
  import { initPlatform } from '$lib/platform'
  import { scheduleBootWork } from '$lib/util/boot-work'
  import { initClientPerformance } from '$lib/performance/client'
  import { libraryStorageError } from '$lib/storage/library-db'
  import { recoverPreferences, startPreferenceMirror } from '$lib/prefs-snapshot'
  import { getLocale, getTextDirection } from '$lib/paraglide/runtime.js'
  import {
    debridKey, torrentBindInterface, torrentPlaybackMode, torrentProxyEnabled, torrentProxyUrl,
  } from '$lib/settings/ui'
  import { torrentProxyEndpoint } from '$lib/player/torrent-proxy'
  setContextClient(anilist)
  let { children } = $props()
  // Resolve TV mode before the app shell decides whether desktop-only chrome should mount.
  initPlatform()
  const captureControlsWindow = (() => {
    try { return getCurrentWindow().label === 'capture-controls' }
    catch { return false }
  })()
  const skipSpeculativeNetwork = () => {
    const connection = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection
    return !navigator.onLine || connection?.saveData === true
  }
  onMount(() => {
    // The controls mirror is a deliberately inert second WebView. Starting the normal client
    // services here would duplicate sync, update, DHT and notification work while recording.
    if (captureControlsWindow) return
    const stopPerformance = initClientPerformance()
    document.documentElement.lang = getLocale()
    document.documentElement.dir = getTextDirection()
    startQualitySync()
    startEnhancementSync()
    const stopDolbySync = startDolbySync()
    // Keep the DHT bootstrap away from the first paint. A Play action promotes this task, so a fast
    // user never waits for the speculative delay; ordinary launches get a quiet shell first.
    void scheduleBootWork('torrent', async () => {
      if (get(torrentPlaybackMode) !== 'direct' && get(debridKey)) return
      // Once started, the engine (librqbit session + DHT) lives for the process. A fresh install
      // that only streams through online-source extensions, or has no source at all, would pay
      // that for nothing; the same goes for an offline or data-saver link. torrent_playback_url
      // starts the engine lazily and Play promotes this task, so skipping here costs only the
      // first torrent play's bootstrap.
      if (skipSpeculativeNetwork()) return
      const { enabledAddonUrls } = await import('$lib/stremio/sources')
      if (!get(enabledAddonUrls).length) {
        const { hasConfiguredExtensions } = await import('$lib/extensions/manager')
        if (!await hasConfiguredExtensions()) return
      }
      try {
        const socksProxyUrl = torrentProxyEndpoint(get(torrentProxyEnabled), get(torrentProxyUrl))
        const bindInterface = get(torrentBindInterface).trim() || null
        await invoke('torrent_engine_warmup', { socksProxyUrl, bindInterface })
      } catch { /* invalid proxy is shown in Settings and playback fails closed */ }
    }, 4500)
    const stopTheme = startThemeSync()
    // Preferences live only in the webview's localStorage, which the OS may evict without telling
    // anyone. If the on-disk snapshot describes settings this storage no longer has, put them back
    // and reload — the settings stores read localStorage at import time, so they are already
    // holding defaults by now and only a reload makes the restored values take effect.
    let stopMirror: (() => void) | undefined
    void recoverPreferences().then((restored) => {
      if (restored) { window.location.reload(); return }
      // Mirroring starts only once recovery has decided, so a snapshot is never overwritten with
      // the empty storage it was meant to repair.
      stopMirror = startPreferenceMirror()
    })
    return () => { stopPerformance(); stopTheme(); stopDolbySync(); stopMirror?.() }
  })
</script>
{#if $libraryStorageError && !captureControlsWindow}
  <div role="alert" class="fixed inset-x-0 top-0 z-[200] bg-destructive px-4 py-3 text-sm text-destructive-foreground">
    {$libraryStorageError} <a href="/app/settings/backup" class="font-bold underline">Export backup</a>
  </div>
{/if}
{@render children()}
