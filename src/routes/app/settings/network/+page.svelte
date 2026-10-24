<script lang="ts">
  import { onMount } from 'svelte'
  import { get } from 'svelte/store'
  import {
    enableDoH, doHUrl, torrentAndroidPostSeed, torrentBindInterface, torrentDownloadLimitMbps,
    torrentUploadLimitMode, torrentUpstreamCapacityMbps, torrentProxyEnabled, torrentProxyUrl,
  } from '$lib/settings/ui'
  import { torrentProxyEndpoint } from '$lib/player/torrent-proxy'
  import { listNetworkInterfaces, type NetInterfaceInfo } from '$lib/player/direct-torrent'
  import { isAndroid } from '$lib/platform'
  import SettingsSection from '$lib/components/settings/SettingsSection.svelte'
  import SettingsSubcategory from '$lib/components/settings/SettingsSubcategory.svelte'
  import SettingsRow from '$lib/components/settings/SettingsRow.svelte'
  import SettingsChoiceRow from '$lib/components/settings/SettingsChoiceRow.svelte'
  import SettingsSwitch from '$lib/components/settings/SettingsSwitch.svelte'
  import RefreshButton from '$lib/components/RefreshButton.svelte'

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
      return true
    } catch (error) {
      ifaceError = error instanceof Error ? error.message : String(error)
      return false
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
    // Keep a vanished adapter selectable so the menu doesn't silently jump off the binding — VPN
    // clients recreate their adapter under a new id on reinstall/protocol switches.
    const bound = $torrentBindInterface
    if (bound && !ifaces.some((iface) => iface.name === bound)) {
      options.push({ value: bound, label: `${bound} (not found)` })
    }
    return options
  })
  const boundIface = $derived(ifaces.find((iface) => iface.name === $torrentBindInterface) ?? null)

  onMount(() => {
    if (!get(isAndroid)) void refreshInterfaces()
  })
</script>

{#snippet downloadLimitControl()}
  <span class="flex items-center gap-2">
    <input type="number" min="0" max="10000" step="1" data-focusable bind:value={$torrentDownloadLimitMbps} aria-label="Download limit in Mb/s" class="w-24 rounded-md bg-input px-3 py-2.5 text-right text-base sm:py-2 sm:text-sm" />
    <span class="text-sm text-muted-foreground">Mb/s</span>
  </span>
{/snippet}
{#snippet capacityControl()}
  <span class="flex items-center gap-2">
    <input type="number" min="0.1" max="10000" step="0.1" data-focusable bind:value={$torrentUpstreamCapacityMbps} aria-label="Upstream capacity in Mb/s" class="w-24 rounded-md bg-input px-3 py-2.5 text-right text-base sm:py-2 sm:text-sm" />
    <span class="text-sm text-muted-foreground">Mb/s</span>
  </span>
{/snippet}
{#snippet dohSwitch()}<SettingsSwitch value={$enableDoH} onToggle={() => ($enableDoH = !$enableDoH)} label="Use DNS over HTTPS" interactive={false} />{/snippet}
{#snippet proxySwitch()}<SettingsSwitch value={$torrentProxyEnabled} onToggle={() => ($torrentProxyEnabled = !$torrentProxyEnabled)} label="Require SOCKS5 proxy" interactive={false} />{/snippet}
{#snippet seedSwitch()}<SettingsSwitch value={$torrentAndroidPostSeed} onToggle={() => ($torrentAndroidPostSeed = !$torrentAndroidPostSeed)} label="Continue seeding after playback" interactive={false} />{/snippet}
{#snippet refreshControl()}
  <RefreshButton onRefresh={refreshInterfaces} class="min-w-[7.25rem] rounded-md bg-secondary px-3 py-2 text-sm font-bold hover:bg-accent" />
{/snippet}
{#snippet adapterMeta()}
  {#if !$torrentBindInterface}
    Not bound; torrents may use any interface
  {:else if boundIface && boundIface.isUp}
    <span class="text-green-500">Bound to {boundIface.label}{boundIface.ips[0] ? ` (${boundIface.ips[0]})` : ''}</span>
  {:else}
    <span class="text-destructive">Bound adapter is offline; Direct P2P waits for it</span>
  {/if}
{/snippet}

<SettingsSection section="network">
  <SettingsSubcategory id="p2p">
    <SettingsRow settingKey="torrent-download-limit" title="Download limit" description="Direct P2P only; 0 means uncapped" learnMore="Only affects Direct P2P playback. Downloads are uncapped by default; upload is limited separately so seeding cannot saturate a slow upstream connection." control={downloadLimitControl} />
    <SettingsChoiceRow settingKey="torrent-upload-limit" title="Upload limit" description="Auto caps seeding at 1 Mb/s" learnMore="One torrent seeds while you watch. When playback closes, desktop continues for up to 30 minutes or a 0.25 ratio, whichever happens first. Upload is reduced automatically whenever less than one minute is buffered." value={$torrentUploadLimitMode} onChange={(value) => ($torrentUploadLimitMode = value as 'auto' | 'capacity')} options={[
      { value: 'auto', label: 'Auto (1 Mb/s)' },
      { value: 'capacity', label: 'Use my upstream' },
    ]} />
    {#if $torrentUploadLimitMode === 'capacity'}
      <SettingsRow title="Upstream capacity" description={`izumi uses at most 70% (${Math.max(0, Number($torrentUpstreamCapacityMbps) || 0) * 0.7} Mb/s)`} control={capacityControl} />
    {/if}
  </SettingsSubcategory>

  <SettingsSubcategory id="advanced" summary="DNS over HTTPS, VPN binding, SOCKS5 proxy, seeding">
    <SettingsRow settingKey="use-dns-over-https" title="Use DNS over HTTPS" description="Encrypted DNS for sources, add-ons, metadata and downloads" learnMore="Resolves hostnames through the endpoint below for community sources, add-ons, metadata and downloads. Some extension sources fail closed instead of falling back to system DNS; other requests fall back if the endpoint is unreachable. Tracker browsing and mpv playback still use the system resolver." control={dohSwitch} onActivate={() => ($enableDoH = !$enableDoH)} pressed={$enableDoH} expanded={$enableDoH}>
      <label class="flex flex-col gap-1">
        <span class="text-sm font-bold">DNS-over-HTTPS URL</span>
        <input type="text" data-focusable bind:value={$doHUrl} placeholder="https://cloudflare-dns.com/dns-query" class="rounded-md bg-input px-3 py-2.5 text-base sm:py-2 sm:text-sm" />
      </label>
    </SettingsRow>

    {#if !$isAndroid}
      <SettingsChoiceRow settingKey="vpn-adapter-binding" title="VPN adapter binding" description="Tie Direct P2P to one adapter; connect your VPN first" learnMore="macOS and Linux bind torrent sockets to the adapter at the OS level; Windows keeps bound sessions outbound-only. Every desktop refuses to start while the adapter is missing and pauses all torrents the instant it drops. Restart izumi after changing this so the torrent session is recreated. Keep your VPN app's kill switch on too, and combine it with the SOCKS5 proxy for defence in depth." value={$torrentBindInterface} onChange={(value) => ($torrentBindInterface = value)} options={ifaceOptions} />
      <SettingsRow title="Adapter status" meta={adapterMeta} control={refreshControl} expanded={!!ifaceError}>
        {#if ifaceError}<p role="alert" class="text-xs text-destructive">{ifaceError}</p>{/if}
      </SettingsRow>
    {/if}

    <SettingsRow settingKey="require-socks5-proxy" title="Require SOCKS5 proxy" description="Kill switch: playback fails rather than skip the proxy" learnMore="Routes torrent peer connections and HTTP trackers through a SOCKS5 endpoint from your VPN client or proxy provider. Direct DHT and UDP trackers are disabled because they cannot use the proxy safely, so fewer peers may be found. Restart izumi after changing this so the torrent session uses the new route." control={proxySwitch} onActivate={() => ($torrentProxyEnabled = !$torrentProxyEnabled)} pressed={$torrentProxyEnabled} expanded={$torrentProxyEnabled}>
      <label class="flex flex-col gap-1">
        <span class="text-sm font-bold">SOCKS5 URL</span>
        <input type="text" autocomplete="off" spellcheck="false" data-focusable bind:value={$torrentProxyUrl}
               placeholder="socks5://127.0.0.1:1080"
               class="rounded-md bg-input px-3 py-2.5 font-mono text-base sm:py-2 sm:text-sm" />
        <span class="text-xs text-muted-foreground">Credentials are optional: <code>socks5://user:password@host:port</code>.</span>
      </label>
      {#if proxyError}<p role="alert" class="mt-2 text-xs text-destructive">{proxyError}</p>{/if}
    </SettingsRow>

    {#if $isAndroid}
      <SettingsRow settingKey="continue-seeding-after-playback" title="Continue seeding after playback" description="While charging on unmetered networks, to 30 min or a 0.25 ratio" learnMore="Off by default; active playback still seeds." control={seedSwitch} onActivate={() => ($torrentAndroidPostSeed = !$torrentAndroidPostSeed)} pressed={$torrentAndroidPostSeed} />
    {/if}
  </SettingsSubcategory>
</SettingsSection>
