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
  import { getLocale, getTextDirection } from '$lib/paraglide/runtime.js'
  import {
    debridKey, torrentBindInterface, torrentPlaybackMode, torrentProxyEnabled, torrentProxyUrl,
  } from '$lib/settings/ui'
  import { torrentProxyEndpoint } from '$lib/player/torrent-proxy'
  setContextClient(anilist)
  let { children } = $props()
  onMount(() => {
    document.documentElement.lang = getLocale()
    document.documentElement.dir = getTextDirection()
    startQualitySync()
    startEnhancementSync()
    // Session creation + a cold DHT bootstrap used to happen inside the first Play click. Start it
    // quietly at app mount instead; no magnet is added and no episode data is downloaded.
    if (get(torrentPlaybackMode) === 'direct' || !get(debridKey)) {
      try {
        const socksProxyUrl = torrentProxyEndpoint(get(torrentProxyEnabled), get(torrentProxyUrl))
        const bindInterface = get(torrentBindInterface).trim() || null
        void invoke('torrent_engine_warmup', { socksProxyUrl, bindInterface }).catch(() => {})
      } catch { /* invalid proxy is shown in Settings and playback fails closed */ }
    }
    return startThemeSync()
  })
</script>
<svelte:head>
  <script type="module" src="https://discussanime.moe/embed.js"></script>
</svelte:head>
{@render children()}
