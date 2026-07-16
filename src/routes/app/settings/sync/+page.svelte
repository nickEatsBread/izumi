<script lang="ts">
  import { onMount } from 'svelte'
  import { listen } from '@tauri-apps/api/event'
  import Copy from 'lucide-svelte/icons/copy'
  import Download from 'lucide-svelte/icons/download'
  import Link from 'lucide-svelte/icons/link'
  import RefreshCw from 'lucide-svelte/icons/refresh-cw'
  import Unlink from 'lucide-svelte/icons/unlink'
  import Upload from 'lucide-svelte/icons/upload'
  import { copyToClipboard } from '$lib/util/clipboard'
  import {
    createSyncGroup, disableDeviceSync, enableDeviceSync, getSyncStatus, joinSyncGroup, leaveSyncGroup,
    joinNearbyDevice, listNearbyDevices, openNearbyPairing, respondToPairRequest,
    listManualDevices, pullWatchProgress, pushWatchProgress,
    receiveManualSnapshot, sendManualSnapshot, syncDeviceName,
  } from '$lib/sync/client'
  import { anilistToken } from '$lib/anilist/auth'
  import { malToken } from '$lib/trackers/config'
  import type { ManualDevice, NearbyDevice, PairOutgoing, PairRequest, PairingWindow, SyncStatus } from '$lib/sync/types'

  let status = $state<SyncStatus>({ state: 'starting' })
  let joinTicket = $state('')
  let busy = $state('')
  let message = $state('')
  let error = $state('')
  let devices = $state<ManualDevice[]>([])
  let copied = $state(false)
  let nearby = $state<NearbyDevice[]>([])
  let pairingWindow = $state<PairingWindow | null>(null)
  let incoming = $state<PairRequest | null>(null)
  let outgoing = $state<PairOutgoing | null>(null)
  let now = $state(Date.now())

  const paired = $derived(status.state === 'ready' && status.paired)
  const ticket = $derived(status.state === 'ready' ? (status.ticket ?? '') : '')
  const trackerGate = $derived(!!$anilistToken || !!$malToken)
  const pairingActive = $derived(!!pairingWindow && pairingWindow.expiresAt > now)

  async function refresh() {
    try {
      status = await getSyncStatus()
      if (status.state === 'ready' && status.paired) devices = await listManualDevices()
      if (status.state === 'ready' && !status.paired) await refreshNearby()
      if (status.state !== 'ready') nearby = []
    } catch (e) { error = String(e) }
  }

  async function action(name: string, work: () => Promise<void>) {
    busy = name; message = ''; error = ''
    try { await work() }
    catch (e) { error = e instanceof Error ? e.message : String(e) }
    finally { busy = ''; await refresh() }
  }

  function join() {
    if (!joinTicket.trim()) return
    void action('join', async () => {
      await joinSyncGroup(joinTicket)
      joinTicket = ''
      await pullWatchProgress()
      message = 'Paired. This device will now reconnect automatically.'
    })
  }

  function enable() {
    void action('enable', async () => {
      await enableDeviceSync()
      message = 'Device sync is enabled on this device.'
    })
  }

  function disable() {
    void action('disable', async () => {
      await disableDeviceSync()
      nearby = []
      message = 'Device sync is off. Izumi is no longer listening or discoverable.'
    })
  }

  async function refreshNearby() {
    try { nearby = await listNearbyDevices() }
    catch { nearby = [] }
  }

  function allowNearby() {
    void action('nearby-open', async () => {
      const current = await getSyncStatus()
      if (current.state === 'ready' && !current.paired) await createSyncGroup()
      pairingWindow = await openNearbyPairing()
      message = 'Nearby pairing is available for two minutes. Approve the request when it appears here.'
    })
  }

  function joinNearby(device: NearbyDevice) {
    void action(`nearby-${device.endpointId}`, async () => {
      outgoing = null
      await joinNearbyDevice(device.endpointId)
      await pullWatchProgress()
      message = 'Paired. This device will now reconnect automatically.'
    })
  }

  function respond(approved: boolean) {
    if (!incoming) return
    const request = incoming
    incoming = null
    void action('respond', async () => {
      await respondToPairRequest(request.requestId, approved)
      message = approved ? `${request.deviceName} was added to this sync group.` : 'Pairing request declined.'
    })
  }

  function leave() {
    void action('leave', async () => {
      await leaveSyncGroup()
      devices = []
      message = 'This device left the sync group. Other devices remain paired.'
    })
  }

  function copyTicket() {
    copied = copyToClipboard(ticket)
    setTimeout(() => (copied = false), 1800)
  }

  function sendManual() {
    void action('send', async () => {
      await sendManualSnapshot()
      message = 'Sources, extensions, and portable Izumi settings sent.'
    })
  }

  function receive(device: ManualDevice) {
    void action('receive', async () => {
      receiveManualSnapshot(device)
      message = `Received setup from ${device.deviceName}. Sources, extensions, and portable settings are now active.`
    })
  }

  function syncWatchNow() {
    void action('watch', async () => {
      const imported = await pullWatchProgress()
      await pushWatchProgress()
      message = imported ? `Watch progress synced (${imported} updated entr${imported === 1 ? 'y' : 'ies'}).` : 'Watch progress is up to date.'
    })
  }

  onMount(() => {
    void refresh()
    const poll = setInterval(() => { if (status.state === 'starting') void refresh() }, 1200)
    const clock = setInterval(() => (now = Date.now()), 1000)
    const unsubs = [
      listen('iroh-nearby-update', () => { void refreshNearby() }),
      listen<PairRequest>('iroh-pair-request', (event) => { incoming = event.payload }),
      listen<PairOutgoing>('iroh-pair-outgoing', (event) => { outgoing = event.payload }),
    ]
    return () => {
      clearInterval(poll)
      clearInterval(clock)
      void Promise.all(unsubs).then((callbacks) => callbacks.forEach((unsubscribe) => unsubscribe()))
    }
  })
</script>

<div class="p-4 sm:p-8">
  <h2 class="mb-1 text-xl font-black">Device sync</h2>
  <p class="mb-5 max-w-2xl text-sm text-muted-foreground">
    Account-free, end-to-end encrypted sync over Iroh. Works between Android, Steam Deck, Linux, and Windows without a camera.
  </p>

  {#if status.state === 'starting'}
    <div class="max-w-2xl rounded-md border border-border p-4 text-sm text-muted-foreground">Starting the secure sync service…</div>
  {:else if status.state === 'disabled'}
    <section class="max-w-2xl rounded-md border border-border p-4">
      <h3 class="font-bold">Device sync is off</h3>
      <p class="mt-1 text-sm text-muted-foreground">
        Izumi does not start iroh, contact a relay, listen for peers, or advertise this device until you enable it.
      </p>
      <button onclick={enable} disabled={!!busy} data-focusable class="mt-3 rounded-md bg-primary px-4 py-2 font-bold text-primary-foreground disabled:opacity-50">
        {busy === 'enable' ? 'Enabling…' : 'Enable device sync'}
      </button>
    </section>
  {:else if status.state === 'failed'}
    <div class="max-w-2xl rounded-md border border-destructive/50 bg-destructive/10 p-4 text-sm text-destructive">
      Sync could not start: {status.error}
      <button onclick={enable} disabled={!!busy} data-focusable class="mt-3 block rounded-md bg-secondary px-3 py-2 font-bold text-foreground disabled:opacity-50">
        {busy === 'enable' ? 'Retrying…' : 'Retry'}
      </button>
    </div>
  {:else if !paired}
    <section class="max-w-2xl space-y-5">
      <div class="rounded-md border border-primary/40 bg-primary/5 p-4">
        <h3 class="font-bold">Pair over your local network</h3>
        <p class="mt-1 text-sm text-muted-foreground">
          Put both devices on the same Wi-Fi or LAN. On a device already in the group, choose <strong>Allow nearby pairing</strong>. It will appear below automatically.
        </p>

        {#if outgoing}
          <div class="mt-3 rounded-md border border-primary/40 bg-background/70 p-3">
            <div class="text-xs font-bold uppercase tracking-wide text-muted-foreground">Confirm this code on the other device</div>
            <div class="mt-1 font-mono text-2xl font-black tracking-widest">{outgoing.code}</div>
            <p class="mt-1 text-xs text-muted-foreground">No code needs to be typed. Wait for approval on the other screen.</p>
          </div>
        {/if}

        <div class="mt-4 flex items-center justify-between gap-3">
          <div class="text-sm font-bold">Nearby Izumi devices</div>
          <div class="flex gap-2">
            <button onclick={refreshNearby} disabled={!!busy} data-focusable class="rounded-md bg-secondary px-2.5 py-1.5 text-xs font-bold">Refresh</button>
            <button onclick={disable} disabled={!!busy} data-focusable class="rounded-md bg-secondary px-2.5 py-1.5 text-xs font-bold text-destructive">Turn off</button>
          </div>
        </div>
        {#if nearby.length}
          <ul class="mt-2 space-y-2">
            {#each nearby as device (device.endpointId)}
              <li class="flex items-center justify-between gap-3 rounded-md bg-secondary/60 p-3">
                <div>
                  <div class="text-sm font-bold">Izumi device {device.shortId}</div>
                  <div class="text-xs text-muted-foreground">Discovered on this local network</div>
                </div>
                <button onclick={() => joinNearby(device)} disabled={!!busy} data-focusable class="rounded-md bg-primary px-3 py-2 text-sm font-bold text-primary-foreground disabled:opacity-50">
                  {busy === `nearby-${device.endpointId}` ? 'Waiting...' : 'Pair'}
                </button>
              </li>
            {/each}
          </ul>
        {:else}
          <p class="mt-2 rounded-md bg-secondary/40 p-3 text-sm text-muted-foreground">No nearby Izumi device is visible yet.</p>
        {/if}

        <div class="mt-4 border-t border-border pt-4">
          <p class="text-sm text-muted-foreground">Starting the first device instead?</p>
          <button onclick={allowNearby} disabled={!!busy} data-focusable class="mt-2 flex items-center gap-2 rounded-md bg-secondary px-4 py-2 text-sm font-bold disabled:opacity-50">
            <Link size={17} /> {busy === 'nearby-open' ? 'Starting...' : 'Create group and allow nearby pairing'}
          </button>
          {#if pairingActive && pairingWindow}
            <p class="mt-2 text-xs text-emerald-400">Visible for pairing as Izumi device {pairingWindow.shortId}.</p>
          {/if}
        </div>
      </div>

      <details class="rounded-md border border-border p-4">
        <summary data-focusable class="cursor-pointer text-sm font-bold">Advanced: use a pairing ticket</summary>
        <p class="mt-3 text-sm text-muted-foreground">Use this only when the devices cannot be placed on the same local network.</p>
        <textarea bind:value={joinTicket} data-focusable rows="4" spellcheck="false" placeholder="doc..." class="mt-3 w-full resize-y rounded-md bg-input px-3 py-2 font-mono text-xs"></textarea>
        <button onclick={join} disabled={!!busy || !joinTicket.trim()} data-focusable class="mt-2 rounded-md bg-primary px-4 py-2 font-bold text-primary-foreground disabled:opacity-50">
          {busy === 'join' ? 'Pairing...' : 'Pair with ticket'}
        </button>
      </details>
    </section>
  {:else}
    <div class="max-w-2xl space-y-6">
      {#if incoming}
        <section class="rounded-md border border-primary bg-primary/10 p-4">
          <h3 class="font-bold">Nearby pairing request</h3>
          <p class="mt-1 text-sm text-muted-foreground"><strong>{incoming.deviceName}</strong> wants to join this sync group.</p>
          <div class="mt-3 text-xs font-bold uppercase tracking-wide text-muted-foreground">Check that both screens show</div>
          <div class="mt-1 font-mono text-3xl font-black tracking-widest">{incoming.code}</div>
          <div class="mt-4 flex gap-2">
            <button onclick={() => respond(true)} disabled={!!busy} data-focusable class="rounded-md bg-primary px-4 py-2 font-bold text-primary-foreground disabled:opacity-50">Approve</button>
            <button onclick={() => respond(false)} disabled={!!busy} data-focusable class="rounded-md bg-secondary px-4 py-2 font-bold disabled:opacity-50">Decline</button>
          </div>
        </section>
      {/if}

      <section class="rounded-md border border-border p-4">
        <div class="flex items-start justify-between gap-3">
          <div>
            <h3 class="font-bold text-emerald-400">Paired</h3>
            <p class="mt-1 text-sm text-muted-foreground">Iroh reconnects directly where possible and uses its encrypted relay fallback when needed.</p>
          </div>
          <button onclick={leave} disabled={!!busy} data-focusable class="flex shrink-0 items-center gap-2 rounded-md bg-secondary px-3 py-2 text-sm font-bold text-destructive disabled:opacity-50"><Unlink size={16} /> Leave</button>
        </div>

        <label class="mt-4 flex flex-col gap-1">
          <span class="text-sm font-bold">This device name</span>
          <input bind:value={$syncDeviceName} data-focusable placeholder="e.g. Steam Deck" class="rounded-md bg-input px-3 py-2 text-sm" />
        </label>

        <div class="mt-4">
          <div class="mb-1 text-sm font-bold">Pair another device</div>
          <p class="text-sm text-muted-foreground">Make this device visible on the local network for two minutes. The other device can select it without typing anything.</p>
          <button onclick={allowNearby} disabled={!!busy} data-focusable class="mt-2 flex items-center gap-2 rounded-md bg-primary px-3 py-2 text-sm font-bold text-primary-foreground disabled:opacity-50">
            <Link size={16} /> {busy === 'nearby-open' ? 'Starting...' : 'Allow nearby pairing'}
          </button>
          {#if pairingActive && pairingWindow}
            <p class="mt-2 text-xs text-emerald-400">Visible as Izumi device {pairingWindow.shortId}. You will be asked to approve the joining device.</p>
          {/if}

          <details class="mt-4 border-t border-border pt-3">
            <summary data-focusable class="cursor-pointer text-xs font-bold text-muted-foreground">Advanced ticket fallback</summary>
            <textarea readonly value={ticket} rows="4" data-focusable spellcheck="false" class="mt-3 w-full resize-y rounded-md bg-input px-3 py-2 font-mono text-xs"></textarea>
            <button onclick={copyTicket} data-focusable class="mt-2 flex items-center gap-2 rounded-md bg-secondary px-3 py-2 text-sm font-bold"><Copy size={16} /> {copied ? 'Copied' : 'Copy pairing ticket'}</button>
            <p class="mt-2 text-xs text-amber-400">Anyone with this reusable ticket can read and change the group. Share it privately; it may also contain your current IP addresses.</p>
          </details>
        </div>
      </section>

      <section class="rounded-md border border-border p-4">
        <div class="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 class="font-bold">Watch progress</h3>
            {#if trackerGate}
              <p class="mt-1 text-sm text-muted-foreground">Exact resume positions and remembered playback sources sync through Iroh. AniList or MyAnimeList remains the source of truth for watched episode numbers.</p>
            {:else}
              <p class="mt-1 text-sm text-muted-foreground">Anime history, episode numbers, exact resume positions, and remembered playback sources sync automatically after playback changes.</p>
            {/if}
          </div>
          <button onclick={syncWatchNow} disabled={!!busy} data-focusable class="flex items-center gap-2 rounded-md bg-secondary px-3 py-2 text-sm font-bold disabled:opacity-50"><RefreshCw size={16} /> Sync now</button>
        </div>
      </section>

      <section class="rounded-md border border-border p-4">
        <h3 class="font-bold">Sources, extensions, and Izumi settings</h3>
        <p class="mt-1 text-sm text-muted-foreground">Manual only. “Send” publishes this device’s Stremio URLs, extension list, debrid configuration, and portable preferences. Device-specific paths and account tokens are excluded.</p>
        <p class="mt-1 text-xs text-amber-400">Configured addon URLs and the extension debrid credential can contain secrets. Only send them to devices you trust.</p>
        <button onclick={sendManual} disabled={!!busy} data-focusable class="mt-3 flex items-center gap-2 rounded-md bg-primary px-4 py-2 font-bold text-primary-foreground disabled:opacity-50"><Upload size={17} /> {busy === 'send' ? 'Sending…' : 'Send this device’s setup'}</button>

        <div class="mt-5 border-t border-border pt-4">
          <div class="mb-2 flex items-center justify-between gap-3">
            <h4 class="text-sm font-bold">Available device setups</h4>
            <button onclick={() => void action('refresh', async () => { devices = await listManualDevices() })} disabled={!!busy} data-focusable class="rounded-md bg-secondary px-2.5 py-1.5 text-xs font-bold">Refresh</button>
          </div>
          {#if devices.length}
            <ul class="space-y-2">
              {#each devices as device (device.deviceId)}
                <li class="flex items-center justify-between gap-3 rounded-md bg-secondary/50 p-3">
                  <div class="min-w-0">
                    <div class="truncate text-sm font-bold">{device.deviceName}{device.isThisDevice ? ' (this device)' : ''}</div>
                    <div class="text-xs text-muted-foreground">Sent {new Date(device.updatedAt).toLocaleString()}</div>
                  </div>
                  <button onclick={() => receive(device)} disabled={!!busy || device.isThisDevice} data-focusable class="flex shrink-0 items-center gap-2 rounded-md bg-secondary px-3 py-2 text-xs font-bold disabled:opacity-40"><Download size={15} /> Receive</button>
                </li>
              {/each}
            </ul>
          {:else}
            <p class="text-sm text-muted-foreground">No device has sent a manual setup yet.</p>
          {/if}
        </div>
      </section>
    </div>
  {/if}

  {#if message}<p class="mt-4 max-w-2xl rounded-md bg-emerald-500/10 p-3 text-sm text-emerald-400">{message}</p>{/if}
  {#if error}<p class="mt-4 max-w-2xl rounded-md bg-destructive/10 p-3 text-sm text-destructive">{error}</p>{/if}
</div>
