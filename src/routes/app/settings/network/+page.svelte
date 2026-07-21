<script lang="ts">
  import { onMount } from 'svelte'
  import {
    enableDoH, doHUrl, torrentAndroidPostSeed, torrentDownloadLimitMbps,
    torrentUploadLimitMode, torrentUpstreamCapacityMbps, syncRelayMode, syncRelayUrl,
  } from '$lib/settings/ui'
  import { getSyncRelayConfig, setSyncRelay } from '$lib/sync/client'
  import { isAndroid } from '$lib/platform'
  import Toggle from '$lib/components/settings/Toggle.svelte'

  let applyingRelay = $state(false)
  let relayNotice = $state('')
  let relayError = $state('')

  onMount(() => {
    void getSyncRelayConfig().then((config) => {
      syncRelayMode.set(config.customUrl ? 'custom' : 'public')
      if (config.customUrl) syncRelayUrl.set(config.customUrl)
    }).catch(() => {})
  })

  async function applyRelay() {
    applyingRelay = true
    relayNotice = ''
    relayError = ''
    try {
      await setSyncRelay($syncRelayMode === 'custom' ? $syncRelayUrl : null)
      relayNotice = $syncRelayMode === 'custom' ? 'Custom relay applied.' : 'Public relay network applied.'
    } catch (error) {
      relayError = error instanceof Error ? error.message : String(error)
    } finally {
      applyingRelay = false
    }
  }
</script>

<div class="p-4 sm:p-8">
  <h2 class="mb-1 text-xl font-black">Network</h2>
  <p class="mb-4 text-sm text-muted-foreground">Advanced networking. Limited effect with debrid streaming — see notes.</p>

  <div class="max-w-2xl space-y-3">
    <Toggle label="Use DNS over HTTPS" desc="Resolves hostnames via the DoH endpoint below for source/addon, metadata (AniZip/Kitsu) and download requests, falling back to the system resolver if it's unreachable. AniList/MAL browse and mpv playback still use the OS resolver." value={$enableDoH} onToggle={() => ($enableDoH = !$enableDoH)} />
    {#if $enableDoH}
      <label class="flex flex-col gap-1">
        <span class="text-sm font-bold">DNS-over-HTTPS URL</span>
        <input type="text" data-focusable bind:value={$doHUrl} placeholder="https://cloudflare-dns.com/dns-query" class="rounded-md bg-input px-3 py-2 text-sm" />
      </label>
    {/if}

    <section class="rounded-md border border-border p-3">
      <div class="font-bold">Direct torrent bandwidth</div>
      <p class="mt-1 text-xs text-muted-foreground">Only affects Direct P2P playback. Downloads are uncapped by default; upload is limited separately so seeding cannot saturate a slow upstream connection.</p>

      <label class="mt-3 flex items-center justify-between gap-4">
        <span>
          <span class="block text-sm font-bold">Download limit</span>
          <span class="block text-xs text-muted-foreground">Use 0 for uncapped.</span>
        </span>
        <span class="flex items-center gap-2">
          <input type="number" min="0" max="10000" step="1" data-focusable bind:value={$torrentDownloadLimitMbps} class="w-24 rounded-md bg-input px-3 py-2 text-right text-sm" />
          <span class="text-sm text-muted-foreground">Mb/s</span>
        </span>
      </label>

      <label class="mt-3 flex items-center justify-between gap-4">
        <span>
          <span class="block text-sm font-bold">Upload limit</span>
          <span class="block text-xs text-muted-foreground">Auto caps seeding at 1 Mb/s.</span>
        </span>
        <select data-focusable bind:value={$torrentUploadLimitMode} class="rounded-md bg-input px-3 py-2 text-sm">
          <option value="auto">Auto (1 Mb/s)</option>
          <option value="capacity">Use my upstream</option>
        </select>
      </label>

      {#if $torrentUploadLimitMode === 'capacity'}
        <label class="mt-3 flex items-center justify-between gap-4">
          <span>
            <span class="block text-sm font-bold">Upstream capacity</span>
            <span class="block text-xs text-muted-foreground">Izumi uses at most 70% ({Math.max(0, Number($torrentUpstreamCapacityMbps) || 0) * 0.7} Mb/s).</span>
          </span>
          <span class="flex items-center gap-2">
            <input type="number" min="0.1" max="10000" step="0.1" data-focusable bind:value={$torrentUpstreamCapacityMbps} class="w-24 rounded-md bg-input px-3 py-2 text-right text-sm" />
            <span class="text-sm text-muted-foreground">Mb/s</span>
          </span>
        </label>
      {/if}

      <p class="mt-3 text-xs text-muted-foreground">One torrent seeds while you watch. When playback closes, desktop continues for up to 30 minutes or a 0.25 ratio, whichever happens first. Upload is reduced automatically whenever less than one minute is buffered.</p>
    </section>

    {#if $isAndroid}
      <Toggle label="Continue seeding after playback" desc="Android only: continue toward the 30-minute / 0.25-ratio target when the device is charging on an unmetered network. Off by default; active playback still seeds." value={$torrentAndroidPostSeed} onToggle={() => ($torrentAndroidPostSeed = !$torrentAndroidPostSeed)} />
    {/if}

    <section class="rounded-md border border-border p-3">
      <div class="font-bold">Peer-to-peer relay</div>
      <p class="mt-1 text-xs text-muted-foreground">Device Sync and Watch Together use separate encrypted connections, but may independently use this Iroh relay when a direct path is unavailable. A custom relay changes routing only; it never combines their data.</p>
      <div class="mt-3 grid grid-cols-2 gap-2">
        <button data-focusable onclick={() => ($syncRelayMode = 'public')} class="rounded-md px-3 py-2 text-sm font-bold {$syncRelayMode === 'public' ? 'bg-theme text-white' : 'bg-secondary'}">Public relay</button>
        <button data-focusable onclick={() => ($syncRelayMode = 'custom')} class="rounded-md px-3 py-2 text-sm font-bold {$syncRelayMode === 'custom' ? 'bg-theme text-white' : 'bg-secondary'}">Custom relay</button>
      </div>
      {#if $syncRelayMode === 'custom'}
        <label class="mt-3 flex flex-col gap-1">
          <span class="text-sm font-bold">Iroh relay URL</span>
          <input type="url" data-focusable bind:value={$syncRelayUrl} placeholder="https://relay.example.com." class="rounded-md bg-input px-3 py-2 text-sm" />
        </label>
      {/if}
      <button data-focusable disabled={applyingRelay || ($syncRelayMode === 'custom' && !$syncRelayUrl.trim())} onclick={applyRelay} class="mt-3 rounded-md bg-secondary px-4 py-2 text-sm font-bold disabled:opacity-50">{applyingRelay ? 'Applying…' : 'Apply relay'}</button>
      <p class="mt-2 text-xs text-muted-foreground">The selection is used for new connections. Leave and rejoin an active room after changing it.</p>
      {#if relayNotice}<p class="mt-2 text-xs text-green-500">{relayNotice}</p>{/if}
      {#if relayError}<p class="mt-2 text-xs text-destructive">{relayError}</p>{/if}
    </section>
  </div>
</div>
