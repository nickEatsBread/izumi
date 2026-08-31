<script lang="ts">
  import { onMount } from 'svelte'
  import { goto } from '$app/navigation'
  import { listen } from '@tauri-apps/api/event'
  import { invoke } from '@tauri-apps/api/core'
  import { openUrl } from '@tauri-apps/plugin-opener'
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
  import Cloud from '@lucide/svelte/icons/cloud'
  import ExternalLink from '@lucide/svelte/icons/external-link'
  import KeyRound from '@lucide/svelte/icons/key-round'
  import RefreshCw from '@lucide/svelte/icons/refresh-cw'
  import SettingsGroup from '$lib/components/settings/SettingsGroup.svelte'
  import SettingsRow from '$lib/components/settings/SettingsRow.svelte'
  import {
    forgetCompanion,
    normalizeCompanionPairingCode,
    pairedCompanions,
    resolveCompanionPairingCode,
    type PairedCompanion,
  } from '$lib/companion/client'
  import * as h from '$lib/haptics'
  import { copyToClipboard } from '$lib/util/clipboard'
  import {
    createSyncGroup, disableDeviceSync, enableDeviceSync, getSyncStatus, joinSyncGroup, leaveSyncGroup,
    joinNearbyDevice, listNearbyDevices, openNearbyPairing, respondToPairRequest,
    listManualDevices, listSyncMembers, publishPresence, pullWatchProgress,
    receiveManualSnapshot, sendManualSnapshot, syncDeviceName,
    checkCloudflareWorkerUpdate, claimCloudflareWorker, cloudflareSetupSecret,
    cloudflareSyncConfig, cloudflareWorkerUpdateAvailable, createCloudflareInvite,
    createCloudflareCompanionEnrollment, generateCloudflareSetupSecret, joinCloudflareInvite,
    setSyncProvider, syncProvider,
    type SyncMember,
  } from '$lib/sync/client'
  import { CLOUDFLARE_DEPLOY_URL, CLOUDFLARE_UPDATE_GUIDE } from '$lib/sync/cloudflare'
  import {
    deleteCloudflareResolverProfile,
    getCloudflareResolverProfile,
    saveCloudflareResolverProfile,
  } from '$lib/sync/cloudflare'
  import { preferredAudioLang, preferredQuality, preferredStreamSort } from '$lib/settings/ui'
  import { enabledAddonUrls } from '$lib/stremio/sources'
  import { isAndroid } from '$lib/platform'
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
  let cloudflareEndpoint = $state('')
  let cloudflareInvite = $state('')
  let tvPairingCode = $state('')
  let confirmTvForget = $state('')
  let cloudResolverEnabled = $state(false)
  let cloudResolverLoaded = $state(false)
  let cloudResolverError = $state('')
  let cloudResolverUpdatedAt = $state<number | null>(null)

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
  const validTvPairingCode = $derived(Boolean(normalizeCompanionPairingCode(tvPairingCode)))

  function showMessage(text: string) {
    clearTimeout(messageTimer)
    message = text
    messageTimer = setTimeout(() => {
      if (message === text) message = ''
    }, 4000)
  }

  function updateTvPairingCode(event: Event) {
    const raw = (event.currentTarget as HTMLInputElement).value.replace(/[^0-9a-f]/gi, '').slice(0, 6).toUpperCase()
    tvPairingCode = raw.length > 3 ? `${raw.slice(0, 3)} ${raw.slice(3)}` : raw
  }

  function pairTvWithCode() {
    if (!validTvPairingCode) return
    void action('tv-pair', async () => {
      const link = await resolveCompanionPairingCode(tvPairingCode)
      const query = new URLSearchParams({
        v: String(link.protocol),
        tv: link.address,
        device: link.deviceId,
        challenge: link.challenge,
      })
      await goto(`/app/companion-pair?${query}`)
    })
  }

  function openTvNotificationSetup(device: PairedCompanion) {
    void action(`tv-notifications-${device.deviceId}`, async () => {
      if (!device.cloudflare || device.cloudflare.endpoint !== $cloudflareSyncConfig.endpoint) {
        throw new Error('Connect this phone to the private Worker used by that TV first.')
      }
      const enrollment = await createCloudflareCompanionEnrollment()
      await invoke('plugin:extplayer|open_browser', { payload: { url: enrollment.url } })
      showMessage('Grant browser notification permission, then return to Izumi.')
    })
  }

  function forgetTv(device: PairedCompanion) {
    if (confirmTvForget !== device.deviceId) {
      confirmTvForget = device.deviceId
      showMessage(`Press Forget again to remove ${device.name}.`)
      return
    }
    confirmTvForget = ''
    void action(`tv-forget-${device.deviceId}`, async () => {
      await forgetCompanion(device.deviceId)
      showMessage(`${device.name} was forgotten.`)
    })
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
        if ($syncProvider === 'cloudflare' && !cloudResolverLoaded) await refreshCloudResolver()
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

  async function refreshCloudResolver() {
    cloudResolverError = ''
    try {
      const result = await getCloudflareResolverProfile()
      cloudResolverEnabled = result.profile.enabled
      cloudResolverUpdatedAt = result.updatedAt
    } catch (e) {
      cloudResolverEnabled = false
      cloudResolverError = e instanceof Error ? e.message : String(e)
    } finally {
      cloudResolverLoaded = true
    }
  }

  async function uploadCloudResolverProfile() {
    const result = await saveCloudflareResolverProfile({
      enabled: true,
      addons: [...$enabledAddonUrls],
      quality: $preferredQuality,
      sort: $preferredStreamSort,
      audioLang: $preferredAudioLang,
    })
    cloudResolverEnabled = true
    cloudResolverLoaded = true
    cloudResolverUpdatedAt = result.updatedAt
    cloudResolverError = ''
  }

  function toggleCloudResolver() {
    void action('cloud-resolver-toggle', async () => {
      if (cloudResolverEnabled) {
        await deleteCloudflareResolverProfile()
        cloudResolverEnabled = false
        cloudResolverUpdatedAt = null
        showMessage('TV source resolving is off and its Worker profile was deleted.')
      } else {
        if (!$enabledAddonUrls.length) throw new Error('Enable at least one Stremio stream add-on first.')
        await uploadCloudResolverProfile()
        showMessage('Your paired TV can now resolve direct sources through your Worker.')
      }
    })
  }

  function updateCloudResolver() {
    void action('cloud-resolver-update', async () => {
      if (!$enabledAddonUrls.length) throw new Error('Enable at least one Stremio stream add-on first.')
      await uploadCloudResolverProfile()
      showMessage('The Worker resolver profile now matches this device.')
    })
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

  async function selectProvider(provider: 'iroh' | 'cloudflare') {
    if ($syncProvider === provider) return
    status = { state: 'starting' }
    presenceSent = false
    members = []
    devices = []
    resetPairingUi()
    cloudResolverLoaded = false
    cloudResolverEnabled = false
    cloudResolverError = ''
    await setSyncProvider(provider)
    await refresh()
  }

  function prepareCloudflare() {
    if (!$cloudflareSetupSecret) generateCloudflareSetupSecret()
  }

  function deployCloudflare() {
    prepareCloudflare()
    void openUrl(CLOUDFLARE_DEPLOY_URL)
  }

  function connectCloudflare() {
    if (!cloudflareEndpoint.trim() || !$cloudflareSetupSecret.trim()) return
    void action('cloudflare-connect', async () => {
      await claimCloudflareWorker(cloudflareEndpoint, $cloudflareSetupSecret, $syncDeviceName.trim() || 'Izumi device')
      await publishPresence()
      await pullWatchProgress()
      showMessage('Your self-hosted Worker is connected.')
      h.success()
    })
  }

  function joinCloudflare() {
    if (!joinTicket.trim()) return
    void action('cloudflare-join', async () => {
      await joinCloudflareInvite(joinTicket, $syncDeviceName.trim() || 'Izumi device')
      joinTicket = ''
      await publishPresence()
      await pullWatchProgress()
      showMessage('Paired through your Cloudflare Worker.')
      h.success()
    })
  }

  function makeCloudflareInvite() {
    void action('cloudflare-invite', async () => {
      cloudflareInvite = await createCloudflareInvite()
      showMessage('A single-use invite was created for ten minutes.')
      h.success()
    })
  }

  function copyCloudflare(value: string, label: string) {
    if (!copyToClipboard(value)) return
    showMessage(`${label} copied.`)
    h.success()
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
    cloudflareEndpoint = $cloudflareSyncConfig.endpoint
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
    Keep your progress and setup in step across Izumi devices. Records are end-to-end encrypted with either connection method.
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

  <SettingsGroup title="Samsung TV" desc="Add Izumi Companion without scanning the QR code" icon={MonitorSmartphone}>
    <div class="flex flex-col gap-3 p-3 sm:flex-row sm:items-end">
      <label for="tv-pairing-code" class="min-w-0 flex-1">
        <span class="block text-sm font-bold">Pairing code</span>
        <span class="block text-[11px] text-muted-foreground">Enter the six characters shown on the TV. Both devices must use the same Wi-Fi.</span>
        <input
          id="tv-pairing-code"
          value={tvPairingCode}
          oninput={updateTvPairingCode}
          onkeydown={(event) => { if (event.key === 'Enter') pairTvWithCode() }}
          maxlength="7"
          inputmode="text"
          autocomplete="off"
          spellcheck="false"
          placeholder="A82 B04"
          aria-label="TV pairing code"
          data-focusable
          class="mt-2 w-full rounded-lg bg-input px-3 py-2.5 font-mono text-lg font-black uppercase tracking-[.16em]"
        />
      </label>
      <button
        type="button"
        data-focusable
        disabled={!!busy || !validTvPairingCode}
        onclick={() => { h.impact(); pairTvWithCode() }}
        class="min-h-11 shrink-0 rounded-lg bg-primary px-4 py-2 text-sm font-bold text-primary-foreground disabled:opacity-50"
      >{busy === 'tv-pair' ? 'Finding TV…' : 'Pair TV'}</button>
    </div>
    {#if $pairedCompanions.length}
      <div class="border-t border-border/70 p-3">
        <p class="mb-2 text-xs font-black uppercase tracking-wide text-muted-foreground">Paired TVs</p>
        <ul class="space-y-2">
          {#each $pairedCompanions as device (device.deviceId)}
            <li class="flex flex-col gap-3 rounded-lg bg-secondary/50 p-3 sm:flex-row sm:items-center">
              <div class="min-w-0 flex-1">
                <p class="truncate text-sm font-bold">{device.name}</p>
                <p class="truncate text-xs text-muted-foreground">{device.address}{device.cloudflare ? ' · private Worker route' : ' · available while Izumi is open'}</p>
              </div>
              <div class="flex flex-wrap gap-2">
                {#if device.cloudflare && $isAndroid}
                  <button type="button" data-focusable disabled={!!busy} onclick={() => { h.tap(); openTvNotificationSetup(device) }} class="min-h-10 rounded-lg bg-secondary px-3 py-2 text-xs font-bold disabled:opacity-50">
                    {busy === `tv-notifications-${device.deviceId}` ? 'Opening…' : 'Notifications'}
                  </button>
                {/if}
                <button type="button" data-focusable disabled={!!busy} onclick={() => { h.warn(); forgetTv(device) }} class="min-h-10 rounded-lg px-3 py-2 text-xs font-bold text-destructive active:bg-destructive/10 disabled:opacity-50">
                  {busy === `tv-forget-${device.deviceId}` ? 'Forgetting…' : confirmTvForget === device.deviceId ? 'Confirm forget' : 'Forget'}
                </button>
              </div>
            </li>
          {/each}
        </ul>
      </div>
    {/if}
  </SettingsGroup>

  <SettingsGroup title="Connection" desc="Choose where encrypted device records travel" icon={Cloud}>
    <div class="grid grid-cols-2 gap-2 p-3">
      <button type="button" data-focusable onclick={() => { h.tap(); void selectProvider('iroh') }}
        class="min-h-12 rounded-lg px-3 py-2 text-sm font-bold {$syncProvider === 'iroh' ? 'bg-primary text-primary-foreground' : 'bg-secondary'}">
        Peer-to-peer <span class="mt-0.5 block text-[10px] font-normal opacity-75">No account</span>
      </button>
      <button type="button" data-focusable onclick={() => { h.tap(); void selectProvider('cloudflare') }}
        class="min-h-12 rounded-lg px-3 py-2 text-sm font-bold {$syncProvider === 'cloudflare' ? 'bg-primary text-primary-foreground' : 'bg-secondary'}">
        My Cloudflare <span class="mt-0.5 block text-[10px] font-normal opacity-75">Self-hosted Worker</span>
      </button>
    </div>
  </SettingsGroup>

  {#if $syncProvider === 'cloudflare'}
    {#if status.state === 'starting'}
      <SettingsGroup title="Cloudflare sync" desc="Checking your Worker">
        <SettingsRow title="Connecting…" description="This normally takes only a moment." />
      </SettingsGroup>
    {:else if status.state === 'disabled'}
      {#snippet cloudflareEnableControl()}
        <button type="button" data-focusable disabled={!!busy} onclick={() => { h.impact(); enable() }}
          class="min-h-10 rounded-lg bg-primary px-3 py-2 text-sm font-bold text-primary-foreground disabled:opacity-50">
          {busy === 'enable' ? 'Enabling…' : 'Enable Cloudflare sync'}
        </button>
      {/snippet}
      <SettingsGroup title="Cloudflare sync" desc="Nothing leaves this device while sync is off">
        <SettingsRow title="Self-hosted sync is off" description="Your Worker and local records are unchanged." control={cloudflareEnableControl} />
      </SettingsGroup>
    {:else if status.state === 'failed'}
      <section class="mb-5 max-w-2xl rounded-xl border border-destructive/30 bg-destructive/10 p-4">
        <h3 class="font-black">Couldn’t reach your Worker</h3>
        <p class="mt-1 text-sm text-muted-foreground">{status.error}</p>
        <div class="mt-3 flex flex-wrap gap-2">
          <button type="button" data-focusable onclick={() => { status = { state: 'starting' }; void refresh() }} class="min-h-10 rounded-lg bg-secondary px-3 py-2 text-sm font-bold">Try again</button>
          <button type="button" data-focusable onclick={() => openUrl(CLOUDFLARE_UPDATE_GUIDE)} class="inline-flex min-h-10 items-center gap-2 rounded-lg bg-secondary px-3 py-2 text-sm font-bold"><ExternalLink size={15} /> Worker guide</button>
        </div>
      </section>
    {:else if !paired}
      <div class="max-w-2xl space-y-5">
        <section class="rounded-xl border border-border p-4">
          <div class="flex items-start gap-3">
            <span class="grid size-9 shrink-0 place-items-center rounded-lg bg-primary/15 text-primary"><Cloud size={18} /></span>
            <div class="min-w-0 flex-1">
              <h3 class="font-black">Create my private Worker</h3>
              <p class="mt-1 text-sm leading-5 text-muted-foreground">Cloudflare signs you in, clones the isolated Worker, provisions D1, and deploys it. Izumi never receives a Cloudflare API key.</p>
            </div>
          </div>
          <ol class="mt-4 space-y-4">
            <li>
              <p class="text-xs font-black uppercase tracking-wide text-muted-foreground">1. Generate the setup secret</p>
              {#if $cloudflareSetupSecret}
                <div class="mt-2 flex gap-2">
                  <input readonly value={$cloudflareSetupSecret} aria-label="Cloudflare setup secret" class="min-w-0 flex-1 rounded-lg bg-input px-3 py-2 font-mono text-xs" />
                  <button type="button" data-focusable aria-label="Copy setup secret" onclick={() => copyCloudflare($cloudflareSetupSecret, 'Setup secret')} class="grid min-h-10 min-w-10 place-items-center rounded-lg bg-secondary"><Copy size={16} /></button>
                </div>
                <p class="mt-1 text-xs text-amber-400">Paste this as <code>BOOTSTRAP_SECRET</code> during deployment. Keep it private.</p>
              {:else}
                <button type="button" data-focusable onclick={() => { h.impact(); prepareCloudflare() }} class="mt-2 inline-flex min-h-10 items-center gap-2 rounded-lg bg-secondary px-3 py-2 text-sm font-bold"><KeyRound size={16} /> Generate secret</button>
              {/if}
            </li>
            <li>
              <p class="text-xs font-black uppercase tracking-wide text-muted-foreground">2. Deploy through Cloudflare</p>
              <button type="button" data-focusable onclick={() => { h.impact(); deployCloudflare() }} class="mt-2 inline-flex min-h-10 items-center gap-2 rounded-lg bg-primary px-3 py-2 text-sm font-bold text-primary-foreground"><ExternalLink size={16} /> Deploy with Cloudflare</button>
            </li>
            <li>
              <label for="cloudflare-endpoint" class="text-xs font-black uppercase tracking-wide text-muted-foreground">3. Connect the deployed URL</label>
              <input id="cloudflare-endpoint" type="url" data-focusable bind:value={cloudflareEndpoint} placeholder="https://izumi-sync.you.workers.dev" class="mt-2 w-full rounded-lg bg-input px-3 py-2.5 text-base sm:text-sm" />
              <button type="button" data-focusable disabled={!!busy || !cloudflareEndpoint.trim() || !$cloudflareSetupSecret.trim()} onclick={() => { h.impact(); connectCloudflare() }} class="mt-2 min-h-10 rounded-lg bg-primary px-3 py-2 text-sm font-bold text-primary-foreground disabled:opacity-50">{busy === 'cloudflare-connect' ? 'Connecting…' : 'Connect this Worker'}</button>
            </li>
          </ol>
        </section>

        <section class="rounded-xl border border-border p-4">
          <h3 class="font-black">Join my existing Worker</h3>
          <p class="mt-1 text-sm text-muted-foreground">Paste a single-use invite created on a paired device. It expires after ten minutes.</p>
          <textarea bind:value={joinTicket} rows="4" data-focusable spellcheck="false" autocomplete="off" placeholder="izumi-cloudflare:…" class="mt-3 w-full resize-y rounded-lg bg-input px-3 py-2.5 font-mono text-xs"></textarea>
          <button type="button" data-focusable disabled={!!busy || !joinTicket.trim()} onclick={() => { h.impact(); joinCloudflare() }} class="mt-2 min-h-10 rounded-lg bg-secondary px-3 py-2 text-sm font-bold disabled:opacity-50">{busy === 'cloudflare-join' ? 'Joining…' : 'Join with invite'}</button>
        </section>
      </div>
    {:else}
      <div class="max-w-2xl space-y-5">
        <section class="rounded-xl border border-border p-4">
          <div class="flex items-start gap-3">
            <span class="relative grid size-10 shrink-0 place-items-center rounded-full bg-primary/15 text-primary"><Cloud size={19} /><span class="absolute right-0 top-0 size-2.5 rounded-full border-2 border-background bg-emerald-400"></span></span>
            <div class="min-w-0 flex-1">
              <p class="text-[10px] font-black uppercase tracking-[0.14em] text-emerald-400">Worker connected</p>
              <h3 class="truncate font-black">{roomDeviceCount} {roomDeviceCount === 1 ? 'device' : 'devices'} syncing</h3>
              <p class="mt-0.5 truncate text-xs text-muted-foreground">{$cloudflareSyncConfig.endpoint}</p>
            </div>
            <button type="button" data-focusable disabled={!!busy} onclick={() => { h.impact(); makeCloudflareInvite() }} class="min-h-10 shrink-0 rounded-lg bg-primary px-3 py-2 text-sm font-bold text-primary-foreground disabled:opacity-50">{busy === 'cloudflare-invite' ? 'Creating…' : 'Add device'}</button>
          </div>
          {#if cloudflareInvite}
            <div class="mt-4 rounded-lg bg-secondary/50 p-3">
              <p class="text-xs font-bold">Single-use invite · expires in ten minutes</p>
              <textarea readonly value={cloudflareInvite} rows="4" aria-label="Cloudflare device invite" class="mt-2 w-full resize-y rounded-lg bg-input px-3 py-2 font-mono text-xs"></textarea>
              <button type="button" data-focusable onclick={() => copyCloudflare(cloudflareInvite, 'Invite')} class="mt-2 inline-flex min-h-10 items-center gap-2 rounded-lg bg-secondary px-3 py-2 text-sm font-bold"><Copy size={16} /> Copy invite</button>
            </div>
          {/if}
        </section>

        {#if $cloudflareWorkerUpdateAvailable}
          <section class="rounded-xl border border-amber-400/30 bg-amber-400/10 p-4">
            <h3 class="font-black text-amber-300">Worker update {$cloudflareWorkerUpdateAvailable} is available</h3>
            <p class="mt-1 text-xs leading-5 text-muted-foreground">Izumi checks automatically, but does not hold an API token that could change your Cloudflare account. Sync your Cloudflare-created repository with upstream and Workers Builds will deploy it.</p>
            <button type="button" data-focusable onclick={() => openUrl(CLOUDFLARE_UPDATE_GUIDE)} class="mt-2 inline-flex min-h-10 items-center gap-2 rounded-lg bg-secondary px-3 py-2 text-sm font-bold"><ExternalLink size={15} /> Open update guide</button>
          </section>
        {/if}

        <section class="rounded-xl border border-border p-4">
          <label data-setting-key="device-name">
            <span class="block text-sm font-black">This device</span>
            <span class="block text-xs text-muted-foreground">Name shown to your paired devices.</span>
            <input bind:value={$syncDeviceName} placeholder={currentRoomName} data-focusable class="mt-2 w-full rounded-lg bg-input px-3 py-2.5 text-base sm:text-sm" />
          </label>
          <div class="mt-4 border-t border-border/70 pt-4">
            <div class="flex items-center justify-between gap-3">
              <div><h4 class="text-sm font-black">Encrypted records</h4><p class="text-xs text-muted-foreground">Cloudflare stores ciphertext only; the key stays in Izumi invite tickets.</p></div>
              <button type="button" data-focusable disabled={!!busy} onclick={() => void action('worker-check', async () => { await checkCloudflareWorkerUpdate(); showMessage('Worker version checked.') })} class="grid min-h-10 min-w-10 place-items-center rounded-lg bg-secondary" aria-label="Check Worker version"><RefreshCw size={16} class={busy === 'worker-check' ? 'animate-spin' : ''} /></button>
            </div>
          </div>
        </section>

        <section class="rounded-xl border border-border p-4">
          <div class="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div class="min-w-0 flex-1">
              <h3 class="font-black">Resolve TV sources in my Worker</h3>
              <p class="mt-1 text-xs leading-5 text-muted-foreground">When Izumi is closed, a paired TV can ask this Worker for direct sources from your enabled Stremio add-ons. The TV still downloads and plays the media itself.</p>
            </div>
            <button
              type="button"
              data-focusable
              disabled={!!busy || (!cloudResolverEnabled && !$enabledAddonUrls.length)}
              onclick={() => { h.impact(); toggleCloudResolver() }}
              class="min-h-10 shrink-0 rounded-lg px-3 py-2 text-sm font-bold disabled:opacity-50 {cloudResolverEnabled ? 'bg-destructive/10 text-destructive' : 'bg-primary text-primary-foreground'}"
            >{busy === 'cloud-resolver-toggle' ? 'Saving…' : cloudResolverEnabled ? 'Turn off' : 'Enable'}</button>
          </div>
          <div class="mt-3 rounded-lg border border-amber-400/25 bg-amber-400/10 p-3 text-xs leading-5 text-amber-100">
            This is separate from encrypted sync: configured add-on URLs can contain credentials and must be readable by your own Worker to contact those add-ons. JVM extensions, torrent-only results, debrid API keys, and media proxying are not included.
          </div>
          {#if cloudResolverError}
            <p class="mt-3 text-xs text-amber-300">{cloudResolverError}</p>
          {/if}
          <div class="mt-3 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <span>{$enabledAddonUrls.length} enabled add-on{$enabledAddonUrls.length === 1 ? '' : 's'}</span>
            {#if cloudResolverEnabled}
              <span>· {$preferredQuality === 'any' ? 'Best available' : `${$preferredQuality}p preferred`}</span>
              {#if cloudResolverUpdatedAt}<span>· Updated {new Date(cloudResolverUpdatedAt).toLocaleString()}</span>{/if}
              <button type="button" data-focusable disabled={!!busy || !$enabledAddonUrls.length} onclick={() => { h.tap(); updateCloudResolver() }} class="ml-auto min-h-9 rounded-lg bg-secondary px-3 py-1.5 font-bold disabled:opacity-50">
                {busy === 'cloud-resolver-update' ? 'Updating…' : 'Update from this device'}
              </button>
            {/if}
          </div>
        </section>

        <section class="rounded-xl border border-border p-4">
          <h3 class="font-black">Settings & sources</h3>
          <p class="mt-1 text-xs leading-5 text-amber-400">This can include add-on URLs and debrid credentials. It remains encrypted, and is only applied when you choose a device below.</p>
          <button type="button" data-focusable disabled={!!busy} onclick={() => { h.impact(); sendManual() }} class="mt-2 inline-flex min-h-10 items-center gap-2 rounded-lg bg-secondary px-3 py-2 text-sm font-bold disabled:opacity-50"><Upload size={16} /> {busy === 'send' ? 'Sending…' : 'Share this device’s setup'}</button>
          {#if devices.some((device) => !device.isThisDevice)}
            <ul class="mt-3 space-y-2">
              {#each devices.filter((device) => !device.isThisDevice) as device (device.deviceId)}
                <li class="flex items-center gap-2 rounded-lg bg-secondary/50 p-3"><div class="min-w-0 flex-1"><div class="truncate text-sm font-bold">{device.deviceName}</div><div class="text-xs text-muted-foreground">{new Date(device.updatedAt).toLocaleString()}</div></div><button type="button" data-focusable disabled={!!busy} onclick={() => { h.tap(); receive(device) }} class="min-h-10 rounded-lg bg-secondary px-3 py-2 text-sm font-bold">{confirmReceive === device.deviceId ? 'Confirm replace' : 'Use setup'}</button></li>
              {/each}
            </ul>
          {/if}
        </section>

        <section class="flex flex-col gap-3 rounded-xl border border-border p-4 sm:flex-row sm:items-center">
          <div class="min-w-0 flex-1"><h3 class="font-black">Disconnect this device</h3><p class="text-xs text-muted-foreground">The encrypted records on your other devices and Worker remain.</p></div>
          <button type="button" data-focusable disabled={!!busy} onclick={() => { h.warn(); requestLeave() }} class="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-bold text-destructive active:bg-destructive/10 disabled:opacity-50"><Unlink size={16} /> {busy === 'leave' ? 'Leaving…' : confirmLeave ? 'Confirm leave' : 'Leave Worker'}</button>
        </section>
      </div>
    {/if}

  {:else if status.state === 'starting'}
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
