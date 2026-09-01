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
      try {
        const socksProxyUrl = torrentProxyEndpoint(get(torrentProxyEnabled), get(torrentProxyUrl))
        const bindInterface = get(torrentBindInterface).trim() || null
        await invoke('torrent_engine_warmup', { socksProxyUrl, bindInterface })
      } catch { /* invalid proxy is shown in Settings and playback fails closed */ }
    }, 4500)
    const stopTheme = startThemeSync()
    return () => { stopPerformance(); stopTheme(); stopDolbySync() }
  })
</script>
{@render children()}
