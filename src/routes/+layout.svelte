<script lang="ts">
  import '@fontsource-variable/nunito'
  import '@fontsource/geist-mono'
  import '../app.css'
  import { setContextClient } from '@urql/svelte'
  import { anilist } from '$lib/anilist/client'
  import { onMount } from 'svelte'
  import { get } from 'svelte/store'
  import { invoke } from '@tauri-apps/api/core'
  import { startQualitySync } from '$lib/player/quality'
  import { startEnhancementSync } from '$lib/player/enhancements'
  import { startThemeSync } from '$lib/theme'
  import { scheduleBootWork } from '$lib/util/boot-work'
  import { initClientPerformance } from '$lib/performance/client'
  import { getLocale, getTextDirection } from '$lib/paraglide/runtime.js'
  import {
    debridKey, torrentBindInterface, torrentPlaybackMode, torrentProxyEnabled, torrentProxyUrl,
  } from '$lib/settings/ui'
  import { torrentProxyEndpoint } from '$lib/player/torrent-proxy'
  setContextClient(anilist)
  let { children } = $props()
  onMount(() => {
    const stopPerformance = initClientPerformance()
    document.documentElement.lang = getLocale()
    document.documentElement.dir = getTextDirection()
    startQualitySync()
    startEnhancementSync()
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
    return () => { stopPerformance(); stopTheme() }
  })
</script>
{@render children()}
