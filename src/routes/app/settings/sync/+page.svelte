<script lang="ts">
  import { onMount } from 'svelte'
  import { listen } from '@tauri-apps/api/event'
  import Check from '@lucide/svelte/icons/check'
  import ChevronDown from '@lucide/svelte/icons/chevron-down'
  import Copy from '@lucide/svelte/icons/copy'
  import Download from '@lucide/svelte/icons/download'
  import LoaderCircle from '@lucide/svelte/icons/loader-circle'
  import MonitorSmartphone from '@lucide/svelte/icons/monitor-smartphone'
  import Plus from '@lucide/svelte/icons/plus'
  import Radio from '@lucide/svelte/icons/radio'
  import Ticket from '@lucide/svelte/icons/ticket'
  import Unlink from '@lucide/svelte/icons/unlink'
  import Upload from '@lucide/svelte/icons/upload'
  import SettingsGroup from '$lib/components/settings/SettingsGroup.svelte'
  import SettingsRow from '$lib/components/settings/SettingsRow.svelte'
  import * as h from '$lib/haptics'
  import { copyToClipboard } from '$lib/util/clipboard'
  import {
    createSyncGroup, disableDeviceSync, enableDeviceSync, getSyncStatus, joinSyncGroup, leaveSyncGroup,
    joinNearbyDevice, listNearbyDevices, openNearbyPairing, respondToPairRequest,
    listManualDevices, listSyncMembers, publishPresence, pullWatchProgress,
    receiveManualSnapshot, sendManualSnapshot, syncDeviceName,
    type SyncMember,
  } from '$lib/sync/client'
  import { anilistToken } from '$lib/anilist/auth'
  import { malToken } from '$lib/trackers/config'
  import type { ManualDevice, NearbyDevice, PairOutgoing, PairRequest, PairingWindow, SyncStatus } from '$lib/sync/types'

  let status = $state<SyncStatus>({ state: 'starting' })
  let joinTicket = $state('')
  let busy = $state('')
  let message = $state('')
  let messageTimer: ReturnType<typeof setTimeout> | undefined
  let error = $state('')
  let devices = $state<ManualDevice[]>([])
  let members = $state<SyncMember[]>([])
  let presenceSent = $state(false)
  let copied = $state(false)
  let nearby = $state<NearbyDevice[]>([])
  let pairingWindow = $state<PairingWindow | null>(null)
  let incoming = $state<PairRequest | null>(null)
  let outgoing = $state<PairOutgoing | null>(null)
  let ticketOpen = $state(false)
  let advancedOpen = $state(false)
  let confirmReceive = $state('')
  let confirmLeave = $state(false)
  let now = $state(Date.now())

  const paired = $derived(status.state === 'ready' && status.paired)
  const ticket = $derived(status.state === 'ready' ? (status.ticket ?? '') : '')
  const trackerGate = $derived(!!$anilistToken || !!$malToken)
  const pairingActive = $derived(!!pairingWindow && pairingWindow.expiresAt > now)
  const pairingTimeLeft = $derived.by(() => {
    if (!pairingWindow) return ''
    const seconds = Math.max(0, Math.ceil((pairingWindow.expiresAt - now) / 1000))
    return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
  })
  const roomDeviceCount = $derived(Math.max(1, members.length))
  const currentRoomName = $derived(members.find((member) => member.isThisDevice)?.name || $syncDeviceName.trim() || 'This device')

  function showMessage(text: string) {
    clearTimeout(messageTimer)
    message = text
    messageTimer = setTimeout(() => {
      if (message === text) message = ''
    }, 4000)
  }

  async function refreshRoom() {
    try { members = await listSyncMembers() }
    catch { members = [] }
    try { devices = await listManualDevices() }
    catch { devices = [] }
  }

  async function refresh() {
    try {
      status = await getSyncStatus()
      if (status.state === 'ready' && status.paired) {
        if (!presenceSent) {
          try { await publishPresence() } catch { /* native build without presence yet */ }
          presenceSent = true
        }
        await refreshRoom()
        nearby = []
      } else if (status.state === 'ready') {
        presenceSent = false
        members = []
        await refreshNearby()
      } else {
        presenceSent = false
        members = []
        nearby = []
      }
    } catch (e) { error = String(e) }
  }

  async function action(name: string, work: () => Promise<void>) {
    if (busy) return
    busy = name
    clearTimeout(messageTimer)
    message = ''
    error = ''
    try { await work() }
    catch (e) {
      error = e instanceof Error ? e.message : String(e)
      h.error()
    } finally {
      busy = ''
      await refresh()
    }
  }

  function join() {
    if (!joinTicket.trim()) return
    void action('join', async () => {
      await joinSyncGroup(joinTicket)
      joinTicket = ''
      await pullWatchProgress()
      showMessage('Paired. This device will now reconnect automatically.')
      h.success()
    })
  }

  function resetPairingUi() {
    outgoing = null
    incoming = null
    pairingWindow = null
  }

  function enable() {
    void action('enable', async () => {
      resetPairingUi()
      await enableDeviceSync()
      showMessage('Device sync is enabled on this device.')
    })
  }

  function disable() {
    void action('disable', async () => {
      await disableDeviceSync()
      nearby = []
      resetPairingUi()
      showMessage('Device sync is off. Izumi is no longer listening or discoverable.')
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
      showMessage('Nearby pairing is open for two minutes.')
    })
  }

  function joinNearby(device: NearbyDevice) {
    void action(`nearby-${device.endpointId}`, async () => {
      outgoing = null
      try {
        await joinNearbyDevice(device.endpointId)
        await pullWatchProgress()
        showMessage('Paired. This device will now reconnect automatically.')
        h.success()
      } finally {
        outgoing = null
      }
    })
  }

  function respond(approved: boolean) {
    if (!incoming) return
    const request = incoming
    void action('respond', async () => {
      await respondToPairRequest(request.requestId, approved)
      incoming = null
      showMessage(approved ? `${request.deviceName} was added to this sync group.` : 'Pairing request declined.')
      if (approved) h.success()
    })
  }

  function requestLeave() {
    if (!confirmLeave) {
      confirmLeave = true
      setTimeout(() => (confirmLeave = false), 5000)
      return
    }
    confirmLeave = false
    void action('leave', async () => {
      await leaveSyncGroup()
      devices = []
      members = []
      presenceSent = false
      pairingWindow = null
      showMessage('This device left the sync group. Your other devices remain paired.')
    })
  }

  function copyTicket() {
    copied = copyToClipboard(ticket)
    if (copied) h.success()
    setTimeout(() => (copied = false), 1800)
  }

  function sendManual() {
    void action('send', async () => {
      await sendManualSnapshot()
      showMessage('This device’s setup is now available to your other devices.')
      h.success()
    })
  }

  function receive(device: ManualDevice) {
    if (confirmReceive !== device.deviceId) {
      confirmReceive = device.deviceId
      setTimeout(() => { if (confirmReceive === device.deviceId) confirmReceive = '' }, 5000)
      return
    }
    confirmReceive = ''
    void action('receive', async () => {
      receiveManualSnapshot(device)
      showMessage(`Setup received from ${device.deviceName}.`)
      h.success()
    })
  }

  $effect(() => {
    if (status.state !== 'ready' || paired) return
    void refreshNearby()
    const poll = setInterval(() => { void refreshNearby() }, 2000)
    return () => clearInterval(poll)
  })

  $effect(() => {
    if (!paired) return
    const name = $syncDeviceName
    const timer = setTimeout(() => { void name; void publishPresence().then(() => refreshRoom()) }, 400)
    return () => clearTimeout(timer)
  })

  onMount(() => {
    void refresh()
    const poll = setInterval(() => { if (status.state === 'starting') void refresh() }, 1200)
    const clock = setInterval(() => (now = Date.now()), 1000)
    const unsubs = [
      listen('iroh-nearby-update', () => { void refreshNearby() }),
      listen<PairRequest>('iroh-pair-request', (event) => { incoming = event.payload }),
      listen<PairOutgoing>('iroh-pair-outgoing', (event) => { outgoing = event.payload }),
      listen('iroh-sync-update', () => { void refreshRoom() }),
    ]
    return () => {
      clearInterval(poll)
      clearInterval(clock)
      clearTimeout(messageTimer)
      void Promise.all(unsubs).then((callbacks) => callbacks.forEach((unsubscribe) => unsubscribe()))
    }
  })
</script>

<div class="p-4 sm:p-8">
  <h2 class="mb-1 text-xl font-black">Device sync</h2>
  <p class="mb-5 max-w-2xl text-sm text-muted-foreground">
    Keep your progress and setup in step across Izumi devices. No account required, and everything is end-to-end encrypted.
  </p>

  {#if message}
    <div role="status" aria-live="polite" class="pointer-events-none fixed inset-x-4 bottom-20 z-[60] mx-auto flex w-fit max-w-[92vw] items-center gap-2 rounded-full bg-neutral-900/95 px-4 py-2.5 text-sm text-white shadow-lg">
      <Check size={16} class="shrink-0 text-emerald-400" aria-hidden="true" />
      <span class="line-clamp-2">{message}</span>
    </div>
  {/if}
  {#if error}
    <div role="alert" class="mb-4 max-w-2xl rounded-xl border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">{error}</div>
  {/if}

  {#if status.state === 'starting'}
    <SettingsGroup title="Device sync" desc="Preparing the encrypted connection">
      <SettingsRow title="Starting…" description="This normally takes only a moment." />
    </SettingsGroup>

  {:else if status.state === 'disabled'}
    {#snippet enableControl()}
      <button type="button" onclick={() => { h.impact(); enable() }} disabled={!!busy} data-focusable
        class="min-h-10 rounded-lg bg-primary px-3 py-2 text-sm font-bold text-primary-foreground disabled:opacity-50">
        {busy === 'enable' ? 'Enabling…' : 'Enable device sync'}
      </button>
    {/snippet}
    <SettingsGroup title="Device sync" desc="Nothing leaves this device until you turn it on">
      <SettingsRow
        title="Device sync is off"
        description="Izumi does not listen, advertise, or talk to a relay until you enable it."
        control={enableControl}
      />
    </SettingsGroup>

  {:else if status.state === 'failed'}
    {#snippet retryControl()}
      <button type="button" onclick={() => { h.tap(); enable() }} disabled={!!busy} data-focusable
        class="min-h-10 rounded-lg bg-secondary px-3 py-2 text-sm font-bold disabled:opacity-50">
        {busy === 'enable' ? 'Retrying…' : 'Try again'}
      </button>
    {/snippet}
    <SettingsGroup title="Device sync" desc="The secure service did not start">
      <SettingsRow title="Couldn’t start sync" description={status.error} control={retryControl} />
    </SettingsGroup>

  {:else if !paired}
    {#if outgoing}
      <section class="mb-5 max-w-2xl rounded-xl border border-primary/40 bg-primary/10 p-4">
        <p class="text-xs font-bold uppercase tracking-wide text-muted-foreground">Confirm this code on the other device</p>
        <div class="mt-1 font-mono text-3xl font-black tracking-[0.18em]">{outgoing.code}</div>
        <p class="mt-1 text-sm text-muted-foreground">Nothing needs to be typed. Wait for approval on the other screen.</p>
      </section>
    {/if}

    {#snippet startIcon()}
      <span class="grid size-9 place-items-center rounded-lg bg-primary/15 text-primary"><Plus size={18} /></span>
    {/snippet}
    {#snippet startControl()}
      <button type="button" onclick={() => { h.impact(); allowNearby() }} disabled={!!busy} data-focusable
        class="min-h-10 rounded-lg bg-primary px-3 py-2 text-sm font-bold text-primary-foreground disabled:opacity-50">
        {busy === 'nearby-open' ? 'Starting…' : 'Start'}
      </button>
    {/snippet}
    {#snippet scanningIcon()}
      <span class="grid size-9 place-items-center rounded-lg bg-secondary text-muted-foreground">
        <LoaderCircle size={18} class="animate-spin" />
      </span>
    {/snippet}
    {#snippet ticketChevron()}
      <ChevronDown size={18} class="text-muted-foreground transition-transform {ticketOpen ? 'rotate-180' : ''}" aria-hidden="true" />
    {/snippet}
    {#snippet ticketIcon()}
      <span class="grid size-9 place-items-center rounded-lg bg-secondary text-muted-foreground"><Ticket size={18} /></span>
    {/snippet}
    {#snippet disableControl()}
      <button type="button" onclick={() => { h.tap(); disable() }} disabled={!!busy} data-focusable
        class="min-h-10 rounded-lg px-3 py-2 text-sm font-bold text-destructive transition-colors active:bg-destructive/10 sm:hover:bg-destructive/10 disabled:opacity-50">Turn off</button>
    {/snippet}

    <SettingsGroup title="Nearby sessions" desc="On the same Wi-Fi. Join one, or start your own." icon={Radio}>
      <SettingsRow
        title="Start my own"
        description="Visible on this network for two minutes."
        leading={startIcon}
        control={startControl}
      />

      {#if nearby.length}
        {#each nearby as device (device.endpointId)}
          {#snippet deviceIcon()}
            <span class="grid size-9 place-items-center rounded-lg bg-secondary text-foreground"><MonitorSmartphone size={18} /></span>
          {/snippet}
          {#snippet joinControl()}
            <button type="button" onclick={() => { h.impact(); joinNearby(device) }} disabled={!!busy} data-focusable
              class="min-h-10 rounded-lg bg-primary px-3 py-2 text-sm font-bold text-primary-foreground disabled:opacity-50">
              {busy === `nearby-${device.endpointId}` ? 'Waiting…' : 'Join'}
            </button>
          {/snippet}
          <SettingsRow
            title="Izumi device {device.shortId}"
            description="Found on this local network"
            leading={deviceIcon}
            control={joinControl}
          />
        {/each}
      {:else}
        <SettingsRow
          title="Looking for hosts…"
          description="Scanning this network. A room shows up here when another device chooses Add a device."
          leading={scanningIcon}
        />
      {/if}

      <SettingsRow
        title="Advanced: pairing ticket"
        description="When devices cannot use the same local network."
        leading={ticketIcon}
        control={ticketChevron}
        onActivate={() => (ticketOpen = !ticketOpen)}
        expanded={ticketOpen}
      >
        <div class="space-y-2">
          <label for="join-ticket" class="sr-only">Pairing ticket</label>
          <textarea id="join-ticket" bind:value={joinTicket} rows="4" spellcheck="false" autocomplete="off" placeholder="Paste the pairing ticket" data-focusable
            class="w-full resize-y rounded-lg bg-input px-3 py-2.5 font-mono text-sm sm:py-2 sm:text-xs"></textarea>
          <button type="button" onclick={() => { h.impact(); join() }} disabled={!!busy || !joinTicket.trim()} data-focusable
            class="min-h-10 rounded-lg bg-primary px-3 py-2 text-sm font-bold text-primary-foreground disabled:opacity-50">
            {busy === 'join' ? 'Pairing…' : 'Pair with ticket'}
          </button>
        </div>
      </SettingsRow>

      <SettingsRow
        title="Device sync is on"
        description="Not in a room yet. Nothing is being shared."
        control={disableControl}
      />
    </SettingsGroup>

  {:else}
    {#if incoming}
      <section aria-labelledby="pair-request-title" class="mb-5 max-w-2xl rounded-xl border border-primary/40 bg-primary/10 p-4">
        <div class="flex items-start gap-3">
          <span class="grid size-9 shrink-0 place-items-center rounded-lg bg-primary/15 text-primary"><MonitorSmartphone size={18} /></span>
          <div class="min-w-0 flex-1">
            <h3 id="pair-request-title" class="text-base font-black">Add {incoming.deviceName}?</h3>
            <p class="mt-0.5 text-sm text-muted-foreground">Confirm that both screens show this code:</p>
            <div class="mt-2 font-mono text-3xl font-black tracking-[0.18em]">{incoming.code}</div>
            <div class="mt-4 flex flex-wrap gap-2">
              <button type="button" onclick={() => { h.impact(); respond(true) }} disabled={!!busy} data-focusable
                class="min-h-10 rounded-lg bg-primary px-3 py-2 text-sm font-bold text-primary-foreground disabled:opacity-50">Approve</button>
              <button type="button" onclick={() => { h.tap(); respond(false) }} disabled={!!busy} data-focusable
                class="min-h-10 rounded-lg bg-secondary px-3 py-2 text-sm font-bold disabled:opacity-50">Decline</button>
            </div>
          </div>
        </div>
      </section>
    {/if}

    <div class="max-w-2xl">
      <section class="pb-5" aria-labelledby="room-active-title">
        <div class="flex flex-col gap-4 sm:flex-row sm:items-center">
          <div class="flex min-w-0 flex-1 items-center gap-3">
            <span class="relative grid size-10 shrink-0 place-items-center rounded-full bg-primary/15 text-primary">
              <Radio size={19} aria-hidden="true" />
              <span class="absolute right-0 top-0 size-2.5 rounded-full border-2 border-background bg-emerald-400"></span>
            </span>
            <div class="min-w-0">
              <p class="text-[10px] font-black uppercase tracking-[0.14em] text-emerald-400">Room active</p>
              <h3 id="room-active-title" class="truncate text-base font-black">{roomDeviceCount} {roomDeviceCount === 1 ? 'device' : 'devices'} connected</h3>
              <p class="text-xs text-muted-foreground">Watch progress syncs automatically.</p>
            </div>
          </div>
          <button type="button" onclick={() => { h.impact(); allowNearby() }} disabled={!!busy} data-focusable
            class="inline-flex min-h-10 shrink-0 items-center justify-center gap-2 rounded-lg bg-primary px-3 py-2 text-sm font-bold text-primary-foreground disabled:opacity-50">
            <Plus size={16} aria-hidden="true" />
            {busy === 'nearby-open' ? 'Opening…' : pairingActive ? 'Open again' : 'Add device'}
          </button>
        </div>
        {#if pairingActive && pairingWindow}
          <div class="ml-[3.25rem] mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
            <span class="font-bold text-foreground">Visible as Izumi device {pairingWindow.shortId}</span>
            <span aria-hidden="true">·</span>
            <span>{pairingTimeLeft} remaining</span>
          </div>
        {/if}
      </section>

      <div class="grid gap-6 border-t border-border/70 py-5 sm:grid-cols-2">
        <section aria-labelledby="room-devices-title">
          <div class="mb-2 flex items-center justify-between gap-2">
            <h3 id="room-devices-title" class="text-sm font-black">Devices</h3>
            <span class="rounded-full bg-secondary px-2 py-0.5 text-[10px] font-bold text-muted-foreground">{roomDeviceCount}</span>
          </div>
          <ul class="space-y-1">
            {#each members as member (member.deviceId)}
              <li class="flex items-center gap-2.5 py-2">
                <span class="grid size-8 shrink-0 place-items-center rounded-full bg-secondary text-foreground"><MonitorSmartphone size={16} /></span>
                <span class="min-w-0 flex-1 truncate text-sm font-bold">{member.name}</span>
                <span class="shrink-0 text-[10px] font-bold {member.isThisDevice ? 'text-primary' : 'text-muted-foreground'}">{member.isThisDevice ? 'This device' : 'Connected'}</span>
              </li>
            {:else}
              <li class="flex items-center gap-2.5 py-2">
                <span class="grid size-8 shrink-0 place-items-center rounded-full bg-secondary text-foreground"><MonitorSmartphone size={16} /></span>
                <span class="min-w-0 flex-1 truncate text-sm font-bold">{currentRoomName}</span>
                <span class="shrink-0 text-[10px] font-bold text-primary">This device</span>
              </li>
            {/each}
          </ul>
        </section>

        <label data-setting-key="device-name">
          <span class="block text-sm font-black">This device</span>
          <span class="block text-[11px] text-muted-foreground">Name shown to the room.</span>
          <input bind:value={$syncDeviceName} aria-label="Device name" placeholder={currentRoomName} data-focusable
            class="mt-2 w-full rounded-lg bg-input px-3 py-2.5 text-base sm:py-2 sm:text-sm" />
        </label>
      </div>

      <div class="flex items-start gap-3 border-t border-border/70 py-4" data-setting-key="watch-progress-sync">
        <span class="mt-0.5 grid size-7 shrink-0 place-items-center rounded-full bg-emerald-500/15 text-emerald-400"><Check size={15} /></span>
        <div class="min-w-0">
          <h3 class="text-sm font-black">Syncing automatically</h3>
          <p class="mt-0.5 text-xs leading-5 text-muted-foreground">
            {#if trackerGate}
              Resume positions and remembered sources stay in step. Your tracker still owns watched episode numbers.
            {:else}
              History, episode numbers, resume positions, and remembered sources stay in step.
            {/if}
          </p>
        </div>
      </div>

      <section class="border-t border-border/70" data-setting-key="settings-and-sources-sync">
        <button type="button" data-focusable aria-expanded={advancedOpen}
          onclick={() => { h.tap(); advancedOpen = !advancedOpen; if (advancedOpen) void refreshRoom() }}
          class="flex w-full items-center gap-3 py-4 text-left transition-colors active:opacity-70 sm:hover:opacity-80">
          <div class="min-w-0 flex-1">
            <h3 class="text-sm font-black">Advanced tools</h3>
            <p class="mt-0.5 text-[11px] text-muted-foreground">Pairing ticket and settings transfer</p>
          </div>
          <ChevronDown size={18} class="shrink-0 text-muted-foreground transition-transform {advancedOpen ? 'rotate-180' : ''}" aria-hidden="true" />
        </button>

        {#if advancedOpen}
          <div class="space-y-5 border-t border-border/70 pb-5 pt-4">
            <div>
              <h4 class="text-xs font-black uppercase tracking-wide text-muted-foreground">Pairing ticket</h4>
              <p class="mt-1 text-xs text-muted-foreground">For devices that cannot use the same local network. Treat this like a password.</p>
              <textarea readonly value={ticket} rows="4" aria-label="Pairing ticket" spellcheck="false" data-focusable
                class="mt-2 w-full resize-y rounded-lg bg-input px-3 py-2.5 font-mono text-sm sm:py-2 sm:text-xs"></textarea>
              <button type="button" onclick={() => { h.tap(); copyTicket() }} disabled={!ticket} data-focusable
                class="mt-2 inline-flex min-h-10 items-center gap-2 rounded-lg bg-secondary px-3 py-2 text-sm font-bold disabled:opacity-50">
                <Copy size={16} /> {copied ? 'Copied' : 'Copy ticket'}
              </button>
              <p class="mt-2 text-xs text-amber-400">Anyone with this reusable ticket can access the group. Share it privately; it may contain your current IP addresses.</p>
            </div>
            <div class="border-t border-border/70 pt-4">
              <h4 class="text-xs font-black uppercase tracking-wide text-muted-foreground">Settings & sources</h4>
              <p class="mt-1 text-xs leading-5 text-amber-400">Add-on URLs, source repositories, and debrid credentials can contain secrets. Account tokens and device-specific paths are never included.</p>
              <button type="button" onclick={() => { h.impact(); sendManual() }} disabled={!!busy} data-focusable
                class="mt-2 inline-flex min-h-10 items-center gap-2 rounded-lg bg-secondary px-3 py-2 text-sm font-bold disabled:opacity-50">
                <Upload size={16} /> {busy === 'send' ? 'Sending…' : 'Share this device’s setup'}
              </button>
              <h4 class="mt-4 text-xs font-black uppercase tracking-wide text-muted-foreground">Available setups</h4>
              {#if devices.some((device) => !device.isThisDevice)}
                <ul class="mt-2 space-y-2">
                  {#each devices.filter((device) => !device.isThisDevice) as device (device.deviceId)}
                    <li class="flex flex-col gap-2 rounded-lg bg-secondary/50 p-3 sm:flex-row sm:items-center">
                      <div class="min-w-0 flex-1">
                        <div class="truncate text-sm font-bold">{device.deviceName}</div>
                        <div class="text-xs text-muted-foreground">Shared {new Date(device.updatedAt).toLocaleString()}</div>
                      </div>
                      <button type="button" onclick={() => { h.tap(); receive(device) }} disabled={!!busy} data-focusable
                        class="inline-flex min-h-10 shrink-0 items-center justify-center gap-2 rounded-lg bg-secondary px-3 py-2 text-sm font-bold disabled:opacity-50">
                        <Download size={15} /> {confirmReceive === device.deviceId ? 'Confirm replace' : 'Use this setup'}
                      </button>
                    </li>
                  {/each}
                </ul>
              {:else}
                <p class="mt-2 text-sm text-muted-foreground">No other device has shared a setup yet.</p>
              {/if}
            </div>
          </div>
        {/if}
      </section>

      <div class="flex flex-col gap-3 border-t border-border/70 pt-4 sm:flex-row sm:items-center">
        <div class="min-w-0 flex-1">
          <h3 class="text-sm font-black">Leave room</h3>
          <p class="mt-0.5 text-[11px] text-muted-foreground">{confirmLeave ? 'Press Confirm leave within five seconds.' : 'Stop syncing this device. Your other devices stay connected.'}</p>
        </div>
        <button type="button" onclick={() => { h.warn(); requestLeave() }} disabled={!!busy} data-focusable
          class="inline-flex min-h-10 shrink-0 items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-bold text-destructive transition-colors active:bg-destructive/10 sm:hover:bg-destructive/10 disabled:opacity-50">
          <Unlink size={16} /> {busy === 'leave' ? 'Leaving…' : confirmLeave ? 'Confirm leave' : 'Leave room'}
        </button>
      </div>
    </div>
  {/if}
</div>
