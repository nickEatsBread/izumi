<script lang="ts">
  import { onMount } from 'svelte'
  import { get } from 'svelte/store'
  import {
    enableDoH, doHUrl, torrentAndroidPostSeed, torrentBindInterface, torrentDownloadLimitMbps,
    torrentUploadLimitMode, torrentUpstreamCapacityMbps, torrentProxyEnabled, torrentProxyUrl,
    syncRelayMode, syncRelayUrl,
  } from '$lib/settings/ui'
  import { torrentProxyEndpoint } from '$lib/player/torrent-proxy'
  import { listNetworkInterfaces, type NetInterfaceInfo } from '$lib/player/direct-torrent'
  import { getSyncRelayConfig, setSyncRelay } from '$lib/sync/client'
  import { isAndroid } from '$lib/platform'
  import Toggle from '$lib/components/settings/Toggle.svelte'
  import SelectMenu from '$lib/components/settings/SelectMenu.svelte'

  let applyingRelay = $state(false)
  let relayNotice = $state('')
  let relayError = $state('')
  let ifaces = $state<NetInterfaceInfo[]>([])
  let ifaceError = $state('')

  const proxyError = $derived.by(() => {
    try { torrentProxyEndpoint($torrentProxyEnabled, $torrentProxyUrl); return '' }
    catch (error) { return error instanceof Error ? error.message : String(error) }
  })

  async function refreshInterfaces() {
    try {
      ifaces = await listNetworkInterfaces()
      ifaceError = ''
    } catch (error) {
      ifaceError = error instanceof Error ? error.message : String(error)
    }
  }

  const ifaceOptions = $derived.by(() => {
    const options = [{ value: '', label: 'Any interface (no binding)' }]
    for (const iface of ifaces) {
      const ip = iface.ips[0] ? ` — ${iface.ips[0]}` : ''
      options.push({
        value: iface.name,
        label: `${iface.label}${ip}${iface.isVpnLike ? ' (VPN)' : ''}${iface.isUp ? '' : ' (down)'}`,
      })
    }
    // Keep a vanished adapter selectable so the dropdown doesn't silently jump off the binding —
    // VPN clients recreate their adapter under a new id on reinstall/protocol switches.
    const bound = $torrentBindInterface
    if (bound && !ifaces.some((iface) => iface.name === bound)) {
      options.push({ value: bound, label: `${bound} (not found)` })
    }
    return options
  })
  const boundIface = $derived(ifaces.find((iface) => iface.name === $torrentBindInterface) ?? null)

  onMount(() => {
    if (!get(isAndroid)) void refreshInterfaces()
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
    <Toggle label="Use DNS over HTTPS" desc="Resolves hostnames via the DoH endpoint below for community sources, add-ons, metadata (AniZip/Kitsu) and downloads. JVM sources fail closed instead of falling back to intercepted system DNS; other app requests fall back if DoH is unreachable. AniList/MAL browse and mpv playback still use the OS resolver." value={$enableDoH} onToggle={() => ($enableDoH = !$enableDoH)} />
    {#if $enableDoH}
      <label class="flex flex-col gap-1">
        <span class="text-sm font-bold">DNS-over-HTTPS URL</span>
        <input type="text" data-focusable bind:value={$doHUrl} placeholder="https://cloudflare-dns.com/dns-query" class="rounded-md bg-input px-3 py-2.5 text-base sm:py-2 sm:text-sm" />
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
          <input type="number" min="0" max="10000" step="1" data-focusable bind:value={$torrentDownloadLimitMbps} class="w-24 rounded-md bg-input px-3 py-2.5 text-right text-base sm:py-2 sm:text-sm" />
          <span class="text-sm text-muted-foreground">Mb/s</span>
        </span>
      </label>

      <label class="mt-3 flex items-center justify-between gap-4">
        <span>
          <span class="block text-sm font-bold">Upload limit</span>
          <span class="block text-xs text-muted-foreground">Auto caps seeding at 1 Mb/s.</span>
        </span>
        <SelectMenu bind:value={$torrentUploadLimitMode} className="min-w-44" ariaLabel="Upload limit" options={[
          { value: 'auto', label: 'Auto (1 Mb/s)' },
          { value: 'capacity', label: 'Use my upstream' },
        ]} />
      </label>

      {#if $torrentUploadLimitMode === 'capacity'}
        <label class="mt-3 flex items-center justify-between gap-4">
          <span>
            <span class="block text-sm font-bold">Upstream capacity</span>
            <span class="block text-xs text-muted-foreground">Izumi uses at most 70% ({Math.max(0, Number($torrentUpstreamCapacityMbps) || 0) * 0.7} Mb/s).</span>
          </span>
          <span class="flex items-center gap-2">
            <input type="number" min="0.1" max="10000" step="0.1" data-focusable bind:value={$torrentUpstreamCapacityMbps} class="w-24 rounded-md bg-input px-3 py-2.5 text-right text-base sm:py-2 sm:text-sm" />
            <span class="text-sm text-muted-foreground">Mb/s</span>
          </span>
        </label>
      {/if}

      <p class="mt-3 text-xs text-muted-foreground">One torrent seeds while you watch. When playback closes, desktop continues for up to 30 minutes or a 0.25 ratio, whichever happens first. Upload is reduced automatically whenever less than one minute is buffered.</p>
    </section>

    {#if !$isAndroid}
      <section class="rounded-md border border-border p-3">
        <div class="font-bold">VPN adapter binding</div>
        <p class="mt-1 text-xs text-muted-foreground">Tie Direct P2P to one network adapter, the way qBittorrent binds to a VPN interface. Torrenting refuses to start while the adapter is missing, and the instant it drops every torrent is paused until it returns — a crashed VPN can't quietly continue on your normal connection.</p>

        <label class="mt-3 flex items-center justify-between gap-4">
          <span>
            <span class="block text-sm font-bold">Bind to network interface</span>
            <span class="block text-xs text-muted-foreground">Connect your VPN first, then pick its adapter.</span>
          </span>
          <span class="flex items-center gap-2">
            <SelectMenu bind:value={$torrentBindInterface} className="max-w-72 min-w-44" ariaLabel="Bind to network interface" options={ifaceOptions} />
            <button data-focusable onclick={refreshInterfaces} class="rounded-md bg-secondary px-3 py-2 text-sm font-bold">Refresh</button>
          </span>
        </label>
        {#if ifaceError}<p class="mt-2 text-xs text-destructive">{ifaceError}</p>{/if}

        {#if $torrentBindInterface}
          {#if boundIface && boundIface.isUp}
            <p class="mt-2 text-xs text-green-500">Bound to {boundIface.label}{boundIface.ips[0] ? ` (${boundIface.ips[0]})` : ''}. Torrenting stops the moment this adapter disconnects and resumes when it's back.</p>
          {:else}
            <p class="mt-2 text-xs text-destructive">The bound adapter is not connected right now — Direct P2P won't start until it is (or the binding is cleared).</p>
          {/if}
          <p class="mt-2 text-xs text-muted-foreground">Restart Izumi after changing this so the torrent session is recreated with the binding. While the VPN is connected its own route carries the traffic; this binding is the fail-safe for when it isn't. Keep the VPN app's kill switch on too, and combine with the SOCKS5 proxy below for defense in depth.</p>
        {/if}
      </section>
    {/if}

    <section class="rounded-md border border-border p-3">
      <div class="font-bold">Direct P2P SOCKS5 proxy</div>
      <p class="mt-1 text-xs text-muted-foreground">Route torrent peer connections and HTTP trackers through a SOCKS5 endpoint supplied by your VPN client or proxy provider. This is proxy routing, not qBittorrent-style VPN adapter binding.</p>
      <div class="mt-3">
        <Toggle label="Require SOCKS5 proxy" desc="Kill-switch mode: playback fails instead of falling back to the normal connection. Direct DHT and UDP trackers are disabled because they cannot use this proxy safely." value={$torrentProxyEnabled} onToggle={() => ($torrentProxyEnabled = !$torrentProxyEnabled)} />
      </div>
      {#if $torrentProxyEnabled}
        <label class="mt-3 flex flex-col gap-1">
          <span class="text-sm font-bold">SOCKS5 URL</span>
          <input type="text" autocomplete="off" spellcheck="false" data-focusable bind:value={$torrentProxyUrl}
                 placeholder="socks5://127.0.0.1:1080"
                 class="rounded-md bg-input px-3 py-2.5 font-mono text-base sm:py-2 sm:text-sm" />
          <span class="text-xs text-muted-foreground">Credentials are optional: <code>socks5://user:password@host:port</code>. Many VPN desktop clients expose a local SOCKS5 port.</span>
        </label>
        {#if proxyError}<p class="mt-2 text-xs text-destructive">{proxyError}</p>{/if}
        <p class="mt-2 text-xs text-muted-foreground">Restart Izumi after changing this setting so the warmed torrent session is recreated on the selected route. Proxy mode may discover fewer peers because UDP-only trackers and DHT are intentionally unavailable.</p>
      {/if}
    </section>

    {#if $isAndroid}
      <Toggle label="Continue seeding after playback" desc="Android only: continue toward the 30-minute / 0.25-ratio target when the device is charging on an unmetered network. Off by default; active playback still seeds." value={$torrentAndroidPostSeed} onToggle={() => ($torrentAndroidPostSeed = !$torrentAndroidPostSeed)} />
    {/if}

    <section class="rounded-md border border-border p-3">
      <div class="font-bold">Peer-to-peer relay</div>
      <p class="mt-1 text-xs text-muted-foreground">Device Sync and Watch Together use separate encrypted connections, but may independently use this Iroh relay when a direct path is unavailable. A custom relay changes routing only; it never combines their data.</p>
      <div class="mt-3 grid grid-cols-2 gap-2">
        <button data-focusable onclick={() => ($syncRelayMode = 'public')} class="rounded-md px-3 py-2.5 text-sm font-bold sm:py-2 {$syncRelayMode === 'public' ? 'bg-theme text-white' : 'bg-secondary'}">Public relay</button>
        <button data-focusable onclick={() => ($syncRelayMode = 'custom')} class="rounded-md px-3 py-2.5 text-sm font-bold sm:py-2 {$syncRelayMode === 'custom' ? 'bg-theme text-white' : 'bg-secondary'}">Custom relay</button>
      </div>
      {#if $syncRelayMode === 'custom'}
        <label class="mt-3 flex flex-col gap-1">
          <span class="text-sm font-bold">Iroh relay URL</span>
          <input type="url" data-focusable bind:value={$syncRelayUrl} placeholder="https://relay.example.com." class="rounded-md bg-input px-3 py-2.5 text-base sm:py-2 sm:text-sm" />
        </label>
      {/if}
      <button data-focusable disabled={applyingRelay || ($syncRelayMode === 'custom' && !$syncRelayUrl.trim())} onclick={applyRelay} class="mt-3 w-full rounded-md bg-secondary px-4 py-2.5 text-sm font-bold disabled:opacity-50 sm:w-auto sm:py-2">{applyingRelay ? 'Applying…' : 'Apply relay'}</button>
      <p class="mt-2 text-xs text-muted-foreground">The selection is used for new connections. Leave and rejoin an active room after changing it.</p>
      {#if relayNotice}<p class="mt-2 text-xs text-green-500">{relayNotice}</p>{/if}
      {#if relayError}<p class="mt-2 text-xs text-destructive">{relayError}</p>{/if}
    </section>
  </div>
</div>
