<script lang="ts">
  import TvAccounts from '$lib/components/catalog/TvAccounts.svelte'
  import { activeProfileId as tvAccountProfileId } from '$lib/profiles/store'
  import { authorizeHousehold, cancelHouseholdPrompt } from '$lib/profiles/household-gate'
  import { onDestroy, onMount, tick } from 'svelte'
  import { goto } from '$app/navigation'
  import { page } from '$app/state'
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
  import SettingsSection from '$lib/components/settings/SettingsSection.svelte'
  import SettingsSubcategory from '$lib/components/settings/SettingsSubcategory.svelte'
  import SettingsRow from '$lib/components/settings/SettingsRow.svelte'
  import SettingsChoiceRow from '$lib/components/settings/SettingsChoiceRow.svelte'
  import SettingsSwitch from '$lib/components/settings/SettingsSwitch.svelte'
  import SelectMenu from '$lib/components/settings/SelectMenu.svelte'
  import BackupRestore from '$lib/components/settings/BackupRestore.svelte'
  import { SUBCATEGORY_OPEN_EVENT } from '$lib/settings/sections'
  import {
    forgetCompanion,
    normalizeCompanionPairingCode,
    pairedCompanions,
    provisionCompanionResolverRoutes,
    resolveCompanionPairingCode,
    type PairedCompanion,
  } from '$lib/companion/client'
  import * as h from '$lib/haptics'
  import { copyToClipboard } from '$lib/util/clipboard'
  import {
    createSyncGroup, disableDeviceSync, enableDeviceSync, getSyncStatus, joinSyncGroup, leaveSyncGroup,
    joinNearbyDevice, listNearbyDevices, openNearbyPairing, respondToPairRequest,
    offerSetupToDevice, pushWatchProgress,
    listManualDevices, listSyncMembers, publishPresence, pullWatchProgress,
    receiveManualSnapshot, sendManualSnapshot, syncDeviceName,
    checkCloudflareWorkerUpdate, triggerCloudflareWorkerUpdate, workerUpdateFeedback, claimCloudflareWorker, cloudflareSetupSecret,
    cloudflareSyncConfig, cloudflareWorkerUpdateAvailable, createCloudflareInvite,
    createCloudflareCompanionEnrollment, generateCloudflareSetupSecret, joinCloudflareInvite,
    getSyncRelayConfig, setSyncProvider, setSyncRelay, syncProvider, watchSyncError,
    type SyncMember,
  } from '$lib/sync/client'
  import {
    CLOUDFLARE_GIT_DEPLOY_URL,
    CLOUDFLARE_PRIVACY_URL,
    CLOUDFLARE_TERMS_URL,
    CLOUDFLARE_TOKEN_CREATE_URL,
    CLOUDFLARE_TOKEN_MANAGE_URL,
    CLOUDFLARE_UPDATE_GUIDE,
    cloudflareAllowLanSources,
  } from '$lib/sync/cloudflare'
  import {
    deleteCloudflareResolverProfile,
    getCloudflareResolverProfile,
    saveCloudflareResolverProfile,
    type CloudflareDeploymentTarget,
    type CloudflareResolverProfile,
  } from '$lib/sync/cloudflare'
  import { debridKey, debridProvider, preferredQuality, syncRelayMode, syncRelayUrl } from '$lib/settings/ui'
  import { providerMeta, providerName } from '$lib/stremio/debrid'
  import { enabledAddonUrls } from '$lib/stremio/sources'
  import { currentCloudflareCompanionProfile } from '$lib/companion/cloud-profile'
  import { isAndroid } from '$lib/platform'
  import { anilistToken } from '$lib/anilist/auth'
  import { malToken } from '$lib/trackers/config'
  import type { ManualDevice, NearbyDevice, PairOutgoing, PairRequest, PairingWindow, SyncStatus } from '$lib/sync/types'

  type CloudflarePreview = {
    endpoint: string
    claimUrl: string
    claimExpiresAt: string
    deployment: CloudflareDeploymentTarget
  }

  let cloudflareOption = $state<HTMLElement>()
  let highlightCloudflare = $state(false)
  let cloudflareHighlightTimer: ReturnType<typeof setTimeout> | undefined
  let cloudSetup = $state<'create' | 'join'>('create')
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
  let confirmReceive = $state('')
  let confirmLeave = $state(false)
  let now = $state(Date.now())
  let cloudflareEndpoint = $state('')
  let cloudflareApiToken = $state('')
  let cloudflareAccounts = $state<{ id: string; name: string }[]>([])
  let cloudflareAccountId = $state('')
  let cloudflareTermsAccepted = $state(false)
  let cloudflarePreview = $state<CloudflarePreview | null>(null)
  let cloudflareInvite = $state('')
  let cloudflareUpdatePanel = $state<HTMLElement>()
  let advancedOpen = $state(false)
  let cloudflareNeedsDeploymentAccess = $state(false)
  let cloudflareUpdateFailure = $state('')
  let tvPairingCode = $state('')
  let confirmTvForget = $state('')
  let cloudResolverEnabled = $state(false)
  let cloudResolverConnectedDevices = $state(false)
  let cloudResolverDebridProvider = $state('')
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
  // Which setup rows Advanced shows: the Worker deployment options while Cloudflare has no room yet,
  // the ticket to join while peer-to-peer has no room, and the room's own ticket once it has one.
  const cloudflareSetupOpen = $derived($syncProvider === 'cloudflare' && status.state === 'ready' && !status.paired)
  const irohLobby = $derived($syncProvider !== 'cloudflare' && status.state === 'ready' && !status.paired)
  const irohRoom = $derived($syncProvider !== 'cloudflare' && paired)

  let applyingRelay = $state(false)
  let relayNotice = $state('')
  let relayError = $state('')

  async function applyRelay() {
    applyingRelay = true
    relayNotice = ''
    relayError = ''
    try {
      await setSyncRelay($syncRelayMode === 'custom' ? $syncRelayUrl : null)
      relayNotice = $syncRelayMode === 'custom' ? 'Custom relay applied.' : 'Public relay network applied.'
    } catch (cause) {
      relayError = cause instanceof Error ? cause.message : String(cause)
    } finally {
      applyingRelay = false
    }
  }

  async function openCloudflareSetup(event: MouseEvent) {
    event.preventDefault()
    // The connection choice lives in the folded Advanced subcategory: unfold it, then point at it.
    document.getElementById('advanced')?.dispatchEvent(new CustomEvent(SUBCATEGORY_OPEN_EVENT))
    await tick()
    cloudflareOption?.querySelector<HTMLElement>('[data-focusable]')?.focus({ preventScroll: true })
    cloudflareOption?.scrollIntoView({ block: 'center', behavior: 'instant' })
    highlightCloudflare = true
    clearTimeout(cloudflareHighlightTimer)
    cloudflareHighlightTimer = setTimeout(() => { highlightCloudflare = false }, 2400)
  }

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
      showMessage('Grant browser notification permission, then return to izumi.')
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
      cloudResolverConnectedDevices = result.profile.connectedDeviceFallback
      cloudResolverDebridProvider = result.profile.debrid?.configured ? result.profile.debrid.provider : ''
      cloudResolverUpdatedAt = result.updatedAt
      await provisionCompanionResolverRoutes(result.profile)
    } catch (e) {
      cloudResolverEnabled = false
      cloudResolverConnectedDevices = false
      cloudResolverDebridProvider = ''
      cloudResolverError = e instanceof Error ? e.message : String(e)
    } finally {
      cloudResolverLoaded = true
    }
  }

  async function uploadCloudResolverProfile() {
    const profile: CloudflareResolverProfile = currentCloudflareCompanionProfile(cloudResolverConnectedDevices)
    const result = await saveCloudflareResolverProfile(profile)
    cloudResolverEnabled = true
    cloudResolverLoaded = true
    cloudResolverUpdatedAt = result.updatedAt
    cloudResolverDebridProvider = profile.debrid?.provider ?? ''
    cloudResolverError = ''
    await provisionCompanionResolverRoutes(profile)
  }

  function toggleCloudResolver() {
    void action('cloud-resolver-toggle', async () => {
      if (cloudResolverEnabled) {
        await deleteCloudflareResolverProfile()
        await provisionCompanionResolverRoutes({
          enabled: false,
          connectedDeviceFallback: false,
        })
        cloudResolverEnabled = false
        cloudResolverConnectedDevices = false
        cloudResolverDebridProvider = ''
        cloudResolverUpdatedAt = null
        showMessage('TV source resolving is off and its Worker profile was deleted.')
      } else {
        if (!$enabledAddonUrls.length) throw new Error('Enable at least one Stremio stream add-on first.')
        await uploadCloudResolverProfile()
        showMessage($debridKey.trim() && providerMeta($debridProvider)
          ? `Your paired TV can now resolve direct and ${providerName($debridProvider)} sources through your Worker.`
          : 'Your paired TV can now resolve direct sources through your Worker.')
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

  function toggleCloudResolverConnectedDevices() {
    if (!cloudResolverEnabled) return
    const previous = cloudResolverConnectedDevices
    cloudResolverConnectedDevices = !previous
    void action('cloud-resolver-mode', async () => {
      try {
        await uploadCloudResolverProfile()
        showMessage(cloudResolverConnectedDevices
          ? 'The TV will use your Worker first, then this linked device when needed.'
          : 'The TV will now use only your Worker for source resolving.')
      } catch (error) {
        cloudResolverConnectedDevices = previous
        throw error
      }
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
    cloudResolverConnectedDevices = false
    cloudResolverError = ''
    await setSyncProvider(provider)
    await refresh()
  }

  function prepareCloudflare() {
    if (!$cloudflareSetupSecret) generateCloudflareSetupSecret()
  }

  function openCloudflareTokenSetup() {
    void openUrl(CLOUDFLARE_TOKEN_CREATE_URL)
  }

  function updateCloudflareToken(event: Event) {
    cloudflareApiToken = (event.currentTarget as HTMLInputElement).value.trim()
    cloudflareAccounts = []
    cloudflareAccountId = ''
  }

  function deployCloudflareFromGit() {
    prepareCloudflare()
    void openUrl(CLOUDFLARE_GIT_DEPLOY_URL)
  }

  function deployCloudflare() {
    if (!cloudflareApiToken) return
    prepareCloudflare()
    void action('cloudflare-deploy', async () => {
      const apiToken = cloudflareApiToken
      let accounts = cloudflareAccounts
      if (!accounts.length) {
        accounts = await invoke<{ id: string; name: string }[]>('cloudflare_deployment_accounts', { apiToken })
        cloudflareAccounts = accounts
        if (accounts.length === 1) cloudflareAccountId = accounts[0].id
      }
      if (!cloudflareAccountId) {
        showMessage('Choose the Cloudflare account that should own this Worker.')
        return
      }
      const result = await invoke<{ endpoint: string; deployment: CloudflareDeploymentTarget }>(
        'cloudflare_deploy_worker',
        {
          apiToken,
          accountId: cloudflareAccountId,
          bootstrapSecret: $cloudflareSetupSecret,
          existing: null,
        },
      )
      cloudflareEndpoint = result.endpoint
      await claimCloudflareWorker(
        result.endpoint,
        $cloudflareSetupSecret,
        $syncDeviceName.trim() || 'Izumi device',
        result.deployment,
      )
      await invoke('cloudflare_remove_bootstrap_secret', {
        apiToken,
        deployment: result.deployment,
      }).catch(() => {})
      cloudflareApiToken = ''
      cloudflareAccounts = []
      cloudflareAccountId = ''
      await publishPresence()
      await pullWatchProgress()
      showMessage('Your private Worker is connected. Future Worker updates will install automatically.')
      h.success()
    })
  }

  function createCloudflarePreview() {
    if (!cloudflareTermsAccepted) return
    prepareCloudflare()
    void action('cloudflare-preview', async () => {
      cloudflarePreview = await invoke<CloudflarePreview>('cloudflare_create_preview', {
        acceptTerms: cloudflareTermsAccepted,
        bootstrapSecret: $cloudflareSetupSecret,
      })
      await openUrl(cloudflarePreview.claimUrl)
      showMessage('Your Worker is ready. Claim it in Cloudflare, then return here to connect.')
    })
  }

  function connectCloudflarePreview() {
    if (!cloudflarePreview) return
    const preview = cloudflarePreview
    void action('cloudflare-preview-connect', async () => {
      cloudflareEndpoint = preview.endpoint
      await claimCloudflareWorker(
        preview.endpoint,
        $cloudflareSetupSecret,
        $syncDeviceName.trim() || 'Izumi device',
        preview.deployment,
      )
      cloudflarePreview = null
      await publishPresence()
      await pullWatchProgress()
      showMessage('Your claimed Cloudflare Worker is connected.')
      h.success()
    })
  }

  function openCloudflareWorkerUpdate() {
    void action('worker-check', async () => {
      const update = await triggerCloudflareWorkerUpdate()
      if (update?.configured && !update.error) {
        cloudflareNeedsDeploymentAccess = false
        cloudflareUpdateFailure = ''
        showMessage(update.phase === 'current' ? `Worker ${update.version} is up to date.`
          : update.phase === 'delayed' ? 'The update is taking longer than expected. Your Worker will retry automatically.'
          : 'Worker update requested. Check again shortly to verify the installed version.')
        return
      }
      const feedback = workerUpdateFeedback(update)
      cloudflareNeedsDeploymentAccess = feedback.needsAccess
      cloudflareUpdateFailure = feedback.failure
      const available = await checkCloudflareWorkerUpdate({ throwOnError: true })
      if (!available && !cloudflareNeedsDeploymentAccess && !cloudflareUpdateFailure) {
        showMessage('Your Worker is up to date with this version of izumi.')
        return
      }
      await tick()
      cloudflareUpdatePanel?.focus({ preventScroll: true })
      cloudflareUpdatePanel?.scrollIntoView({ block: 'nearest', behavior: 'instant' })
    })
  }

  function updateCloudflareDeployment() {
    const deployment = $cloudflareSyncConfig.deployment
    if (!deployment || !cloudflareApiToken) return
    void action('cloudflare-update', async () => {
      const apiToken = cloudflareApiToken
      const result = await invoke<{ endpoint: string; deployment: CloudflareDeploymentTarget }>(
        'cloudflare_deploy_worker',
        {
          apiToken,
          accountId: deployment.accountId,
          bootstrapSecret: null,
          existing: deployment,
        },
      )
      if (result.endpoint !== $cloudflareSyncConfig.endpoint) {
        throw new Error('Your workers.dev account address changed. Reconnect devices using the new Worker URL.')
      }
      cloudflareApiToken = ''
      cloudflareNeedsDeploymentAccess = false
      cloudflareUpdateFailure = ''
      if (await checkCloudflareWorkerUpdate({ throwOnError: true })) {
        throw new Error('The Worker update is still becoming available. Wait a moment, then check its version again.')
      }
      showMessage('Your private Worker is up to date. Future updates will install automatically.')
      h.success()
    })
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
      showMessage('Device sync is off. izumi is no longer listening or discoverable.')
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

  /** A device running first-run setup is asking to be handed this one's room. The confirmation
   *  lives here because the data is here: the new device can only ask, never take. */
  const waitingNearby = $derived(nearby.filter((device) => device.mode === 'adopt'))
  let offerTarget = $state<NearbyDevice | null>(null)
  let offerAccounts = $state(false)

  /** Arriving from a scanned QR. Aiming at a device is not agreeing to send it anything, so this
   *  only opens the same confirmation the list does, and only once per visit. */
  let scannedOffer = false
  $effect(() => {
    const wanted = page.url.searchParams.get('offer')
    if (scannedOffer || !wanted || !paired) return
    // A scanned device need not be on this network at all ("the QR works from anywhere"): the
    // native side connects by identity through iroh's discovery when there is no nearby address,
    // so an unlisted endpoint still gets the same confirmation. The short id mirrors the native
    // `short_id` (first six hex characters, upper-cased) the receiver is showing.
    const match = nearby.find((device) => device.endpointId === wanted)
      ?? { endpointId: wanted, shortId: wanted.slice(0, 6).toUpperCase(), mode: 'adopt' as const }
    scannedOffer = true
    askToSendSetup(match)
  })

  function askToSendSetup(device: NearbyDevice) {
    // Never carried over from a previous send. Including signed-in accounts has to be chosen
    // every time, not inherited from a decision made for a different device.
    offerAccounts = false
    offerTarget = device
  }

  // True while the main-PIN keypad is up on a restricted profile. Asked before `action`, so `busy`
  // does not disable (and relabel "Sending…") the Send setup button the keypad gives focus back to.
  let authorizingSend = false
  // Leaving the page while the keypad is still loading or up cancels it, so a PIN entered later
  // cannot send from a page that is gone.
  onDestroy(cancelHouseholdPrompt)

  async function confirmSendSetup() {
    const device = offerTarget
    if (!device || busy || authorizingSend) return
    const withAccounts = offerAccounts
    // The same data as a household backup: a restricted profile needs the main PIN first.
    authorizingSend = true
    let allowed = false
    try {
      allowed = await authorizeHousehold('send-setup')
    } finally {
      authorizingSend = false
    }
    // Cancelled, or the confirmation was closed meanwhile: nothing is offered.
    if (!allowed || offerTarget !== device) return
    void action(`offer-${device.endpointId}`, async () => {
      await offerSetupToDevice(device.endpointId)
      // Only now does anything actually leave: the offer above is a capability, these two calls
      // are the payload the new device reads once it has joined.
      await sendManualSnapshot(withAccounts)
      await pushWatchProgress()
      offerTarget = null
      offerAccounts = false
      showMessage(`Sent this device's setup to Izumi device ${device.shortId}.`)
      h.success()
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
    if (status.state !== 'ready') return
    void refreshNearby()
    const poll = setInterval(() => { void refreshNearby() }, 2000)
    return () => clearInterval(poll)
  })

  // The background Worker check can find an update at any time; its panel sits in Advanced, so unfold it.
  $effect(() => {
    if ($cloudflareWorkerUpdateAvailable) advancedOpen = true
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
    void getSyncRelayConfig().then((config) => {
      syncRelayMode.set(config.customUrl ? 'custom' : 'public')
      if (config.customUrl) syncRelayUrl.set(config.customUrl)
    }).catch(() => {})
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
      clearTimeout(cloudflareHighlightTimer)
      void Promise.all(unsubs).then((callbacks) => callbacks.forEach((unsubscribe) => unsubscribe()))
    }
  })
</script>

<SettingsSection section="devices">
  {#if message}
    <div role="status" aria-live="polite" class="pointer-events-none fixed inset-x-4 bottom-20 z-[60] mx-auto flex w-fit max-w-[92vw] items-center gap-2 rounded-full bg-neutral-900/95 px-4 py-2.5 text-sm text-white shadow-lg">
      <Check size={16} class="shrink-0 text-emerald-400" aria-hidden="true" />
      <span class="line-clamp-2">{message}</span>
    </div>
  {/if}

  <SettingsSubcategory id="devices">
    {#if $watchSyncError}
      <p role="alert" class="bg-destructive/10 px-3 py-2.5 text-sm">{$watchSyncError}</p>
    {/if}
    {#if error}
      <p role="alert" class="bg-destructive/10 px-3 py-2.5 text-sm text-destructive">{error}</p>
    {/if}

    <!-- Both "send my setup" surfaces live ABOVE the provider/state branches on purpose. A device
         that already has a room (the common sender) renders the paired branch, whose "Set up"
         button opens this dialog; while it sat inside the not-paired branch, that button set
         `offerTarget` and nothing appeared — measured on a desktop → Deck transfer 2026-09-12. -->
    {#if outgoing}
      <div class="bg-primary/10 px-3 py-3">
        <p class="text-xs font-bold uppercase tracking-wide text-muted-foreground">Confirm this code on the other device</p>
        <div class="mt-1 font-mono text-3xl font-black tracking-[0.18em]">{outgoing.code}</div>
        <p class="mt-1 text-sm text-muted-foreground">Nothing needs to be typed. Wait for approval on the other screen.</p>
      </div>
    {/if}
    {#if offerTarget}
      <section aria-labelledby="offer-title" class="bg-primary/10 px-3 py-3">
        <h4 id="offer-title" class="text-sm font-bold">Send your setup to Izumi device {offerTarget.shortId}?</h4>
        <ul class="mt-2 space-y-1 text-xs leading-5 text-muted-foreground">
          <li>· Sources, extensions and your debrid key</li>
          <li>· Player, catalog and interface preferences</li>
          <li>· Watch history, progress and local lists</li>
        </ul>
        <!-- Separate, and off every time. Everything above is configuration; this is a live
             credential, and a device that has it can act as you on those services. -->
        <label class="mt-3 flex items-start gap-2.5 text-xs leading-5">
          <input type="checkbox" bind:checked={offerAccounts} data-focusable class="mt-0.5 size-4 shrink-0" />
          <span>
            <span class="font-bold text-foreground">Also send signed-in accounts</span>
            <span class="block text-muted-foreground">Copies your AniList, MyAnimeList, Kitsu and SIMKL sign-in tokens to that device. Leave this off and sign in there instead.</span>
          </span>
        </label>
        <p class="mt-3 text-xs leading-5 text-muted-foreground">The other device shows a code. Check it matches before accepting there.</p>
        <div class="mt-3 flex flex-wrap gap-2">
          <button type="button" onclick={() => { h.impact(); confirmSendSetup() }} disabled={!!busy} data-focusable
            class="min-h-10 rounded-lg bg-primary px-3 py-2 text-sm font-bold text-primary-foreground disabled:opacity-50">
            {busy.startsWith('offer-') ? 'Sending…' : 'Send setup'}
          </button>
          <button type="button" onclick={() => { h.tap(); offerTarget = null }} disabled={!!busy} data-focusable
            class="min-h-10 rounded-lg px-3 py-2 text-sm font-bold hover:bg-secondary disabled:opacity-50">Cancel</button>
        </div>
      </section>
    {/if}

    {#if $syncProvider === 'cloudflare'}
      {#if status.state === 'starting'}
        <SettingsRow title="Connecting to your Worker…" description="Usually takes a moment" />
      {:else if status.state === 'disabled'}
        {#snippet cloudflareEnableControl()}
          <button type="button" data-focusable disabled={!!busy} onclick={() => { h.impact(); enable() }}
            class="min-h-10 rounded-lg bg-primary px-3 py-2 text-sm font-bold text-primary-foreground disabled:opacity-50">
            {busy === 'enable' ? 'Enabling…' : 'Enable Cloudflare sync'}
          </button>
        {/snippet}
        <SettingsRow settingKey="device-sync" title="Self-hosted sync is off" description="Nothing leaves this device; your Worker and records are unchanged" control={cloudflareEnableControl} />
      {:else if status.state === 'failed'}
        {#snippet cloudflareRetryControl()}
          <button type="button" data-focusable onclick={() => { status = { state: 'starting' }; void refresh() }} class="min-h-10 rounded-lg bg-secondary px-3 py-2 text-sm font-bold">Try again</button>
          <button type="button" data-focusable onclick={() => openUrl(CLOUDFLARE_UPDATE_GUIDE)} class="inline-flex min-h-10 items-center gap-2 rounded-lg bg-secondary px-3 py-2 text-sm font-bold"><ExternalLink size={15} /> Worker guide</button>
        {/snippet}
        <SettingsRow settingKey="device-sync" title="Couldn’t reach your Worker" description={status.error} control={cloudflareRetryControl} controlLayout="stack" />
      {:else if !paired}
        <SettingsChoiceRow settingKey="device-sync" title="Cloudflare sync" description="Create a Worker, or join one your devices already use" value={cloudSetup} onChange={(value) => (cloudSetup = value as 'create' | 'join')} options={[
          { value: 'create', label: 'Set up for the first time' },
          { value: 'join', label: 'Join my devices' },
        ]} />
        {#if cloudSetup === 'create'}
          {#snippet cloudIcon()}<span class="grid size-9 place-items-center rounded-lg bg-primary/15 text-primary"><Cloud size={18} /></span>{/snippet}
          <SettingsRow title="Create my private Worker" description="izumi prepares it; you sign in to Cloudflare to claim it" learnMore="izumi prepares the Worker first; then you sign in to Cloudflare—or create an account—to claim it. No GitHub, repository, command line, token, or technical fields." leading={cloudIcon}>
            {#if !cloudflarePreview}
              <div class="rounded-lg border border-border bg-secondary/30 p-3">
                <label class="flex items-start gap-3" for="cloudflare-terms">
                  <input id="cloudflare-terms" type="checkbox" bind:checked={cloudflareTermsAccepted} data-focusable class="mt-1 size-4 shrink-0 accent-primary" />
                  <span class="text-sm leading-5">I accept Cloudflare’s Terms of Service and Privacy Policy and ask izumi to create an expiring deployment for me.</span>
                </label>
                <p class="ml-7 mt-1 text-xs text-muted-foreground">
                  Read the <button type="button" data-focusable onclick={() => openUrl(CLOUDFLARE_TERMS_URL)} class="font-bold text-foreground underline underline-offset-2">Terms</button>
                  and <button type="button" data-focusable onclick={() => openUrl(CLOUDFLARE_PRIVACY_URL)} class="font-bold text-foreground underline underline-offset-2">Privacy Policy</button>.
                </p>
              </div>
              <button type="button" data-focusable disabled={!!busy || !cloudflareTermsAccepted} onclick={() => { h.impact(); createCloudflarePreview() }} class="mt-3 inline-flex min-h-10 items-center gap-2 rounded-lg bg-primary px-3 py-2 text-sm font-bold text-primary-foreground disabled:opacity-50">
                {#if busy === 'cloudflare-preview'}<LoaderCircle size={16} class="animate-spin" />{/if}
                {busy === 'cloudflare-preview' ? 'Preparing your Worker…' : 'Create my private Worker'}
              </button>
              <p class="mt-2 text-xs text-muted-foreground">The security check can take a moment; temporary credentials stay in the app.</p>
            {:else}
              <div class="rounded-lg border border-emerald-400/30 bg-emerald-400/10 p-3">
                <p class="text-xs font-black uppercase tracking-wide text-emerald-300">Worker ready to claim</p>
                <p class="mt-1 text-sm leading-5">Finish the Cloudflare page that opened. The deployment becomes permanent when you sign in or create an account and select <strong>Claim</strong>.</p>
                <p class="mt-1 text-xs text-muted-foreground">Keep izumi open. Cloudflare deletes unclaimed deployments after about one hour.</p>
                <div class="mt-3 flex flex-wrap gap-2">
                  <button type="button" data-focusable onclick={() => openUrl(cloudflarePreview!.claimUrl)} class="inline-flex min-h-10 items-center gap-2 rounded-lg bg-secondary px-3 py-2 text-sm font-bold"><ExternalLink size={15} /> Open Cloudflare claim</button>
                  <button type="button" data-focusable disabled={!!busy} onclick={() => { h.impact(); connectCloudflarePreview() }} class="inline-flex min-h-10 items-center gap-2 rounded-lg bg-primary px-3 py-2 text-sm font-bold text-primary-foreground disabled:opacity-50">
                    {#if busy === 'cloudflare-preview-connect'}<LoaderCircle size={16} class="animate-spin" />{/if}
                    {busy === 'cloudflare-preview-connect' ? 'Connecting…' : 'I claimed it — connect'}
                  </button>
                </div>
              </div>
            {/if}
          </SettingsRow>
        {:else}
          <SettingsRow title="Join my existing Worker" description="Paste a single-use invite from a paired device" learnMore="Create the invite on a paired device with Add device. It expires after ten minutes.">
            <textarea aria-label="Cloudflare device invite" bind:value={joinTicket} rows="3" data-focusable spellcheck="false" autocomplete="off" placeholder="izumi-cloudflare:…" class="w-full resize-y rounded-lg bg-input px-3 py-2.5 font-mono text-xs"></textarea>
            <button type="button" data-focusable disabled={!!busy || !joinTicket.trim()} onclick={() => { h.impact(); joinCloudflare() }} class="mt-2 min-h-10 rounded-lg bg-secondary px-3 py-2 text-sm font-bold disabled:opacity-50">{busy === 'cloudflare-join' ? 'Joining…' : 'Join with invite'}</button>
          </SettingsRow>
        {/if}
      {:else}
        {#snippet workerIcon()}
          <span class="relative grid size-10 place-items-center rounded-full bg-primary/15 text-primary"><Cloud size={19} /><span class="absolute right-0 top-0 size-2.5 rounded-full border-2 border-background bg-emerald-400"></span></span>
        {/snippet}
        {#snippet inviteControl()}
          <button type="button" data-focusable disabled={!!busy} onclick={() => { h.impact(); makeCloudflareInvite() }} class="min-h-10 rounded-lg bg-primary px-3 py-2 text-sm font-bold text-primary-foreground disabled:opacity-50">{busy === 'cloudflare-invite' ? 'Creating…' : 'Add device'}</button>
        {/snippet}
        {#snippet workerMeta()}<span class="block truncate">Worker connected · {$cloudflareSyncConfig.endpoint}</span>{/snippet}
        <SettingsRow settingKey="device-sync" title="{roomDeviceCount} {roomDeviceCount === 1 ? 'device' : 'devices'} syncing" meta={workerMeta} leading={workerIcon} control={inviteControl} expanded={!!cloudflareInvite}>
          {#if cloudflareInvite}
            <p class="text-xs font-bold">Single-use invite · expires in ten minutes</p>
            <textarea readonly value={cloudflareInvite} rows="4" aria-label="Cloudflare device invite" tabindex="-1" class="mt-2 w-full resize-y rounded-lg bg-input px-3 py-2 font-mono text-xs"></textarea>
            <button type="button" data-focusable onclick={() => copyCloudflare(cloudflareInvite, 'Invite')} class="mt-2 inline-flex min-h-10 items-center gap-2 rounded-lg bg-secondary px-3 py-2 text-sm font-bold"><Copy size={16} /> Copy invite</button>
          {/if}
        </SettingsRow>
        {#snippet cloudNameControl()}
          <input bind:value={$syncDeviceName} aria-label="Device name" placeholder={currentRoomName} data-focusable class="w-full rounded-lg bg-input px-3 py-2.5 text-base sm:w-56 sm:py-2 sm:text-sm" />
        {/snippet}
        <SettingsRow settingKey="device-name" title="This device" description="Name shown to your paired devices" control={cloudNameControl} controlLayout="stack" />
        <SettingsRow title="Encrypted records" description="Cloudflare stores ciphertext only; the key stays in invite tickets" />
        {#snippet leaveWorkerControl()}
          <button type="button" data-focusable disabled={!!busy} onclick={() => { h.warn(); requestLeave() }} class="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-bold text-destructive active:bg-destructive/10 disabled:opacity-50"><Unlink size={16} /> {busy === 'leave' ? 'Leaving…' : confirmLeave ? 'Confirm leave' : 'Leave Worker'}</button>
        {/snippet}
        <SettingsRow title="Disconnect this device" description="Records on your other devices and the Worker remain" control={leaveWorkerControl} />
      {/if}

    {:else if status.state === 'starting'}
      <SettingsRow title="Starting device sync…" description="Preparing the encrypted connection" />

    {:else if status.state === 'disabled'}
      {#snippet enableControl()}
        <button type="button" onclick={() => { h.impact(); enable() }} disabled={!!busy} data-focusable
          class="min-h-10 rounded-lg bg-primary px-3 py-2 text-sm font-bold text-primary-foreground disabled:opacity-50">
          {busy === 'enable' ? 'Enabling…' : 'Enable device sync'}
        </button>
      {/snippet}
      <SettingsRow settingKey="device-sync" title="Device sync is off" description="No listening, advertising or relay until enabled" control={enableControl} />

    {:else if status.state === 'failed'}
      {#snippet retryControl()}
        <button type="button" onclick={() => { h.tap(); enable() }} disabled={!!busy} data-focusable
          class="min-h-10 rounded-lg bg-secondary px-3 py-2 text-sm font-bold disabled:opacity-50">
          {busy === 'enable' ? 'Retrying…' : 'Try again'}
        </button>
      {/snippet}
      <SettingsRow settingKey="device-sync" title="Couldn’t start sync" description={status.error} control={retryControl} />

    {:else if !paired}
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
      {#snippet disableControl()}
        <button type="button" onclick={() => { h.tap(); disable() }} disabled={!!busy} data-focusable
          class="min-h-10 rounded-lg px-3 py-2 text-sm font-bold text-destructive transition-colors active:bg-destructive/10 sm:hover:bg-destructive/10 disabled:opacity-50">Turn off</button>
      {/snippet}

      <SettingsRow settingKey="device-sync" title="Start my own" description="Visible on this network for two minutes" leading={startIcon} control={startControl} />
      {#if nearby.length}
        {#each nearby as device (device.endpointId)}
          {#snippet deviceIcon()}
            <span class="grid size-9 place-items-center rounded-lg bg-secondary text-foreground"><MonitorSmartphone size={18} /></span>
          {/snippet}
          {#snippet joinControl()}
            <!-- Driven by what THAT device is advertising, never by this one's state. An earlier
                 version guessed from `paired`, which showed Join against a device waiting to be
                 set up — the one pairing everybody does first — and the native side rejected it
                 with "Nearby pairing is not enabled on that device." -->
            {#if device.mode === 'adopt'}
              <button type="button" onclick={() => { h.impact(); askToSendSetup(device) }} disabled={!!busy} data-focusable
                class="min-h-10 rounded-lg bg-primary px-3 py-2 text-sm font-bold text-primary-foreground disabled:opacity-50">
                {busy === `offer-${device.endpointId}` ? 'Sending…' : 'Set up this device'}
              </button>
            {:else}
              <button type="button" onclick={() => { h.impact(); joinNearby(device) }} disabled={!!busy} data-focusable
                class="min-h-10 rounded-lg bg-primary px-3 py-2 text-sm font-bold text-primary-foreground disabled:opacity-50">
                {busy === `nearby-${device.endpointId}` ? 'Waiting…' : 'Join'}
              </button>
            {/if}
          {/snippet}
          <SettingsRow
            title="Izumi device {device.shortId}"
            description={device.mode === 'adopt' ? 'Waiting to be set up — send it this device’s setup' : 'Hosting a room you can join'}
            leading={deviceIcon}
            control={joinControl}
          />
        {/each}
      {:else}
        <SettingsRow title="Looking for devices…" description="Devices appear while in first-run setup or after Start my own" leading={scanningIcon} />
      {/if}
      <SettingsRow title="Device sync is on" description="Not in a room yet; nothing is shared" control={disableControl} />

    {:else}
      {#if incoming}
        <section aria-labelledby="pair-request-title" class="bg-primary/10 px-3 py-3">
          <div class="flex items-start gap-3">
            <span class="grid size-9 shrink-0 place-items-center rounded-lg bg-primary/15 text-primary"><MonitorSmartphone size={18} /></span>
            <div class="min-w-0 flex-1">
              <h4 id="pair-request-title" class="text-base font-black">Add {incoming.deviceName}?</h4>
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

      {#snippet roomIcon()}
        <span class="relative grid size-10 place-items-center rounded-full bg-primary/15 text-primary">
          <Radio size={19} aria-hidden="true" />
          <span class="absolute right-0 top-0 size-2.5 rounded-full border-2 border-background bg-emerald-400"></span>
        </span>
      {/snippet}
      {#snippet addDeviceControl()}
        <button type="button" onclick={() => { h.impact(); allowNearby() }} disabled={!!busy} data-focusable
          class="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg bg-primary px-3 py-2 text-sm font-bold text-primary-foreground disabled:opacity-50">
          <Plus size={16} aria-hidden="true" />
          {busy === 'nearby-open' ? 'Opening…' : pairingActive ? 'Open again' : 'Add device'}
        </button>
      {/snippet}
      <SettingsRow settingKey="device-sync" title="{roomDeviceCount} {roomDeviceCount === 1 ? 'device' : 'devices'} connected" description="Room active · Watch progress syncs automatically" leading={roomIcon} control={addDeviceControl} expanded={pairingActive && !!pairingWindow}>
        {#if pairingActive && pairingWindow}
          <p class="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
            <span class="font-bold text-foreground">Visible as Izumi device {pairingWindow.shortId}</span>
            <span aria-hidden="true">·</span>
            <span>{pairingTimeLeft} remaining</span>
          </p>
        {/if}
      </SettingsRow>

      <SettingsRow title="Devices" value={String(roomDeviceCount)}>
        <ul class="space-y-1">
          {#each members as member (member.deviceId)}
            <li class="flex items-center gap-2.5 py-1.5">
              <span class="grid size-8 shrink-0 place-items-center rounded-full bg-secondary text-foreground"><MonitorSmartphone size={16} /></span>
              <span class="min-w-0 flex-1 truncate text-sm font-bold">{member.name}</span>
              <span class="shrink-0 text-xs font-bold {member.isThisDevice ? 'text-primary' : 'text-muted-foreground'}">{member.isThisDevice ? 'This device' : 'Connected'}</span>
            </li>
          {:else}
            <li class="flex items-center gap-2.5 py-1.5">
              <span class="grid size-8 shrink-0 place-items-center rounded-full bg-secondary text-foreground"><MonitorSmartphone size={16} /></span>
              <span class="min-w-0 flex-1 truncate text-sm font-bold">{currentRoomName}</span>
              <span class="shrink-0 text-xs font-bold text-primary">This device</span>
            </li>
          {/each}
        </ul>
      </SettingsRow>

      {#snippet roomNameControl()}
        <input bind:value={$syncDeviceName} aria-label="Device name" placeholder={currentRoomName} data-focusable
          class="w-full rounded-lg bg-input px-3 py-2.5 text-base sm:w-56 sm:py-2 sm:text-sm" />
      {/snippet}
      <SettingsRow settingKey="device-name" title="This device" description="Name shown to the room" control={roomNameControl} controlLayout="stack" />

      {#snippet syncedIcon()}
        <span class="grid size-7 place-items-center rounded-full bg-emerald-500/15 text-emerald-400"><Check size={15} /></span>
      {/snippet}
      <SettingsRow
        settingKey="watch-progress-sync"
        title="Syncing automatically"
        description={trackerGate ? 'Resume positions and remembered sources; your tracker owns watched episodes' : 'History, episode numbers, resume positions and remembered sources'}
        leading={syncedIcon}
      />

      <!-- The nearby list used to exist only in the unpaired branch, so the moment you had a room
           there was no way to add anything to it: a device running first-run setup was visible to
           nobody who could actually help it. Hosting is exactly when you need this. -->
      <SettingsRow settingKey="add-a-device" title="Add a device" description="On this Wi-Fi, while the new device runs first-run setup">
        {#if waitingNearby.length}
          <ul class="grid grid-cols-[minmax(0,1fr)] gap-2">
            {#each waitingNearby as device (device.endpointId)}
              <li class="flex items-center gap-3 rounded-lg bg-secondary/40 p-2.5">
                <span class="grid size-9 shrink-0 place-items-center rounded-lg bg-secondary text-foreground"><MonitorSmartphone size={18} /></span>
                <div class="min-w-0 flex-1">
                  <p class="truncate text-sm font-bold">Izumi device {device.shortId}</p>
                  <p class="text-xs text-muted-foreground">Waiting to be set up</p>
                </div>
                <button type="button" onclick={() => { h.impact(); askToSendSetup(device) }} disabled={!!busy} data-focusable
                  class="min-h-10 shrink-0 rounded-lg bg-primary px-3 py-2 text-sm font-bold text-primary-foreground disabled:opacity-50">
                  {busy === `offer-${device.endpointId}` ? 'Sending…' : 'Set up'}
                </button>
              </li>
            {/each}
          </ul>
        {:else}
          <p class="rounded-lg bg-secondary/40 px-3 py-2.5 text-xs text-muted-foreground">
            No device is waiting. Start izumi on the new device and choose “Set up from another device”.
          </p>
        {/if}
        <button type="button" onclick={() => { h.impact(); allowNearby() }} disabled={!!busy} data-focusable
          class="mt-3 min-h-10 rounded-lg bg-secondary px-3 py-2 text-sm font-bold disabled:opacity-50">
          {busy === 'nearby-open' ? 'Opening…' : 'Let a device join instead'}
        </button>
      </SettingsRow>

      {#snippet leaveRoomControl()}
        <button type="button" onclick={() => { h.warn(); requestLeave() }} disabled={!!busy} data-focusable
          class="inline-flex min-h-10 shrink-0 items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-bold text-destructive transition-colors active:bg-destructive/10 sm:hover:bg-destructive/10 disabled:opacity-50">
          <Unlink size={16} /> {busy === 'leave' ? 'Leaving…' : confirmLeave ? 'Confirm leave' : 'Leave room'}
        </button>
      {/snippet}
      <SettingsRow title="Leave room" description={confirmLeave ? 'Press Confirm leave within five seconds' : 'Stops syncing here; your other devices stay connected'} control={leaveRoomControl} />
    {/if}
  </SettingsSubcategory>

  <SettingsSubcategory id="tv">
    <SettingsRow title="Restore from TV" description="Bring your TV's setup and progress here; no sync needed" href="/app/companion-restore" chevron />
    <SettingsRow settingKey="tv-pairing" title="Pair a Samsung TV" description="Enter the code shown on the TV; both on the same Wi-Fi" learnMore="Adds izumi Companion without scanning the QR code.">
      <div class="flex flex-col gap-3 sm:flex-row sm:items-center">
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
          class="w-full rounded-lg bg-input px-3 py-2.5 font-mono text-lg font-black uppercase tracking-[.16em] sm:w-44"
        />
        <button
          type="button"
          data-focusable
          disabled={!!busy || !validTvPairingCode}
          onclick={() => { h.impact(); pairTvWithCode() }}
          class="min-h-11 shrink-0 rounded-lg bg-primary px-4 py-2 text-sm font-bold text-primary-foreground disabled:opacity-50"
        >{busy === 'tv-pair' ? 'Finding TV…' : 'Pair TV'}</button>
      </div>
    </SettingsRow>
    {#each $pairedCompanions as device (device.deviceId)}
      {#snippet tvIcon()}
        <span class="grid size-9 place-items-center rounded-lg bg-secondary text-foreground"><MonitorSmartphone size={18} /></span>
      {/snippet}
      {#snippet tvControl()}
        {#if device.cloudflare && $isAndroid}
          <button type="button" data-focusable disabled={!!busy} onclick={() => { h.tap(); openTvNotificationSetup(device) }} class="min-h-10 rounded-lg bg-secondary px-3 py-2 text-xs font-bold disabled:opacity-50">
            {busy === `tv-notifications-${device.deviceId}` ? 'Opening…' : 'Notifications'}
          </button>
        {/if}
        <button type="button" data-focusable disabled={!!busy} onclick={() => { h.warn(); forgetTv(device) }} class="min-h-10 rounded-lg px-3 py-2 text-xs font-bold text-destructive active:bg-destructive/10 disabled:opacity-50">
          {busy === `tv-forget-${device.deviceId}` ? 'Forgetting…' : confirmTvForget === device.deviceId ? 'Confirm forget' : 'Forget'}
        </button>
      {/snippet}
      <SettingsRow title={device.name} description={`${device.address}${device.cloudflare ? ' · private Worker route' : ' · available while izumi is open'}`} leading={tvIcon} control={tvControl} controlLayout="stack" />
    {/each}

    {#if $syncProvider === 'cloudflare' && paired}
      {#snippet resolverControl()}
        <button
          type="button"
          data-focusable
          disabled={!!busy || (!cloudResolverEnabled && !$enabledAddonUrls.length)}
          onclick={() => { h.impact(); toggleCloudResolver() }}
          class="min-h-10 shrink-0 rounded-lg px-3 py-2 text-sm font-bold disabled:opacity-50 {cloudResolverEnabled ? 'bg-destructive/10 text-destructive' : 'bg-primary text-primary-foreground'}"
        >{busy === 'cloud-resolver-toggle' ? 'Saving…' : cloudResolverEnabled ? 'Turn off' : 'Enable'}</button>
      {/snippet}
      <SettingsRow
        settingKey="tv-playback-worker"
        title="TV playback through CF Sync"
        description="Your TV asks your Worker for sources, even while izumi is closed"
        learnMore="The TV downloads media directly; Cloudflare only handles discovery, ranking, sync and optional debrid resolution. Unlike encrypted sync, your Worker must read your add-on URLs and debrid credential while it resolves a source, using the debrid provider set in Sources. The credential is never returned by the Worker or sent to the TV."
        control={resolverControl}
      />
      {#if cloudResolverEnabled}
        {#snippet fallbackSwitch()}
          <span class={busy ? 'opacity-50' : ''}><SettingsSwitch value={cloudResolverConnectedDevices} onToggle={toggleCloudResolverConnectedDevices} label="Linked-device fallback" interactive={false} /></span>
        {/snippet}
        <SettingsRow
          title="Linked-device fallback"
          description="Off by default; for streams the Worker can't handle"
          learnMore="Keep this only for raw P2P, true transcoding or remuxing, client-local sources, or unusual header-bound streams the free Worker cannot handle. Android may be notified when closed; desktop is used only while izumi is open."
          control={fallbackSwitch}
          onActivate={() => { if (!busy) toggleCloudResolverConnectedDevices() }}
          pressed={cloudResolverConnectedDevices}
        />
        {#snippet lanSwitch()}
          <span class={busy ? 'opacity-50' : ''}><SettingsSwitch value={$cloudflareAllowLanSources} onToggle={() => ($cloudflareAllowLanSources = !$cloudflareAllowLanSources)} label="Allow direct LAN sources" interactive={false} /></span>
        {/snippet}
        <SettingsRow
          title="Allow direct LAN sources"
          description="The Worker hands private URLs to this TV only"
          learnMore="It never fetches or proxies them. Enable only for add-ons and media servers you trust on the same network."
          control={lanSwitch}
          onActivate={() => { if (!busy) $cloudflareAllowLanSources = !$cloudflareAllowLanSources }}
          pressed={$cloudflareAllowLanSources}
        />
        {#snippet resolverUpdateControl()}
          <button type="button" data-focusable disabled={!!busy || !$enabledAddonUrls.length} onclick={() => { h.tap(); updateCloudResolver() }} class="min-h-9 rounded-lg bg-secondary px-3 py-1.5 text-sm font-bold disabled:opacity-50">
            {busy === 'cloud-resolver-update' ? 'Updating…' : 'Update from this device'}
          </button>
        {/snippet}
        <SettingsRow
          title="Worker resolver profile"
          description={[
            `${$enabledAddonUrls.length} enabled add-on${$enabledAddonUrls.length === 1 ? '' : 's'}`,
            $preferredQuality === 'any' ? 'Best available' : `${$preferredQuality}p preferred`,
            cloudResolverDebridProvider ? providerName(cloudResolverDebridProvider) : '',
            cloudResolverConnectedDevices ? 'Cloudflare + device' : 'Cloudflare only',
            cloudResolverUpdatedAt ? `Updated ${new Date(cloudResolverUpdatedAt).toLocaleString()}` : '',
          ].filter(Boolean).join(' · ')}
          control={resolverUpdateControl}
          controlLayout="stack"
        />
        <div class="px-3 pb-4 [&>section]:mt-0 [&>section]:border-t-0 [&>section]:pt-3">{#key $tvAccountProfileId}<TvAccounts />{/key}</div>
      {/if}
      {#if cloudResolverError}
        <p role="alert" class="px-3 py-2.5 text-xs text-amber-300">{cloudResolverError}</p>
      {/if}
    {:else}
      <p class="px-3 py-2.5 text-sm text-muted-foreground">TV playback while izumi is closed needs <a href="#cloudflare-connection" data-focusable onclick={openCloudflareSetup} class="font-semibold text-foreground underline underline-offset-4">private Cloudflare sync</a>.</p>
    {/if}
  </SettingsSubcategory>

  <SettingsSubcategory id="backup">
    <BackupRestore />
  </SettingsSubcategory>

  <SettingsSubcategory id="transfer">
    <SettingsRow title="Watch history" description="Import or export it from Home and library" href="/app/settings/library?setting=import-export-history" chevron />
    {#if paired}
      {#snippet shareControl()}
        <button type="button" onclick={() => { h.impact(); sendManual() }} disabled={!!busy} data-focusable
          class="inline-flex min-h-10 items-center gap-2 rounded-lg bg-secondary px-3 py-2 text-sm font-bold disabled:opacity-50">
          <Upload size={16} /> {busy === 'send' ? 'Sending…' : 'Share this device’s setup'}
        </button>
      {/snippet}
      <SettingsRow
        settingKey="settings-and-sources-sync"
        title="Settings and sources"
        description="Encrypted sources, add-ons and preferences for your other devices"
        learnMore="Add-on URLs, source repositories, and debrid credentials can contain secrets. Account tokens and device-specific paths are never included. Nothing is applied until you pick a setup on the other device."
        control={shareControl}
      />
      {#each devices.filter((device) => !device.isThisDevice) as device (device.deviceId)}
        {#snippet useControl()}
          <button type="button" onclick={() => { h.tap(); receive(device) }} disabled={!!busy} data-focusable
            class="inline-flex min-h-10 shrink-0 items-center justify-center gap-2 rounded-lg bg-secondary px-3 py-2 text-sm font-bold disabled:opacity-50">
            <Download size={15} /> {confirmReceive === device.deviceId ? 'Confirm replace' : 'Use this setup'}
          </button>
        {/snippet}
        <SettingsRow title={device.deviceName} description="Shared {new Date(device.updatedAt).toLocaleString()}" control={useControl} />
      {:else}
        <SettingsRow title="Available setups" description="No other device has shared a setup yet" />
      {/each}
    {:else}
      <SettingsRow settingKey="settings-and-sources-sync" title="Settings and sources" description="Pair a device first to share setups" />
    {/if}
  </SettingsSubcategory>

  <SettingsSubcategory id="advanced" summary="Connection method, Worker updates, pairing ticket, relay" bind:open={advancedOpen}>
    <div bind:this={cloudflareOption} id="cloudflare-connection" class:cloudflare-setup-highlight={highlightCloudflare}>
      <SettingsChoiceRow
        settingKey="sync-connection"
        title="Connection method"
        description="Where encrypted device records travel"
        value={$syncProvider}
        onChange={(value) => { if (busy) return; h.tap(); void selectProvider(value as 'iroh' | 'cloudflare') }}
        options={[
          { value: 'iroh', label: 'Peer-to-peer', description: 'No account' },
          { value: 'cloudflare', label: 'My Cloudflare', description: 'Self-hosted Worker' },
        ]}
      />
    </div>

    {#if $cloudflareSyncConfig.endpoint && $cloudflareSyncConfig.deviceToken}
      {#snippet workerUpdateControl()}
        <button type="button" data-focusable disabled={!!busy} onclick={() => { h.impact(); openCloudflareWorkerUpdate() }} class="inline-flex min-h-10 shrink-0 items-center gap-2 rounded-lg bg-secondary px-3 py-2 text-sm font-bold disabled:opacity-50">
          <RefreshCw size={16} class={busy === 'worker-check' ? 'animate-spin' : ''} />
          {busy === 'worker-check' ? 'Checking…' : 'Update Worker'}
        </button>
      {/snippet}
      <SettingsRow
        settingKey="worker-updates"
        title="Worker updates"
        description={$cloudflareSyncConfig.workerVersion ? `Installed ${$cloudflareSyncConfig.workerVersion}; stable updates install automatically` : 'Stable updates install automatically; check now to update sooner'}
        control={workerUpdateControl}
        expanded={!!$cloudflareWorkerUpdateAvailable || cloudflareNeedsDeploymentAccess || !!cloudflareUpdateFailure}
      >
        {#if $cloudflareWorkerUpdateAvailable || cloudflareNeedsDeploymentAccess || cloudflareUpdateFailure}
          <section bind:this={cloudflareUpdatePanel} tabindex="-1" aria-labelledby="worker-update-available-title">
            <h4 id="worker-update-available-title" class="font-black text-amber-300">{$cloudflareWorkerUpdateAvailable ? `Worker update ${$cloudflareWorkerUpdateAvailable} is available` : cloudflareNeedsDeploymentAccess ? 'Update Worker deployment access' : 'The automatic update could not finish'}</h4>
            {#if cloudflareUpdateFailure && !cloudflareNeedsDeploymentAccess}<p class="mt-1 text-xs leading-5 text-muted-foreground">{cloudflareUpdateFailure} Installing it directly from here replaces the Worker with the current version.</p>{/if}
            {#if $cloudflareSyncConfig.deployment}
              <p class="mt-1 text-xs leading-5 text-muted-foreground">Authorize this update with your Cloudflare deployment token. izumi also enables future automatic updates, keeping your data and device links.</p>
              <div class="mt-3 flex flex-wrap gap-2">
                <button type="button" data-focusable onclick={() => openCloudflareTokenSetup()} class="inline-flex min-h-10 items-center gap-2 rounded-lg bg-secondary px-3 py-2 text-sm font-bold"><ExternalLink size={15} /> Create update token</button>
                <button type="button" data-focusable onclick={() => openUrl(CLOUDFLARE_TOKEN_MANAGE_URL)} class="min-h-10 rounded-lg bg-secondary px-3 py-2 text-sm font-bold">Manage tokens</button>
              </div>
              <input
                type="password"
                data-focusable
                value={cloudflareApiToken}
                oninput={updateCloudflareToken}
                autocomplete="off"
                autocapitalize="off"
                spellcheck="false"
                aria-label="Cloudflare deployment token"
                placeholder="Paste Cloudflare deployment token"
                class="mt-3 w-full rounded-lg bg-input px-3 py-2.5 font-mono text-base sm:text-sm"
              />
              <p class="mt-1 text-xs text-muted-foreground">Your private Worker keeps this token as an encrypted secret for future updates. It is never sent to the TV.</p>
              <button type="button" data-focusable disabled={!!busy || !cloudflareApiToken} onclick={() => { h.impact(); updateCloudflareDeployment() }} class="mt-2 inline-flex min-h-10 items-center gap-2 rounded-lg bg-primary px-3 py-2 text-sm font-bold text-primary-foreground disabled:opacity-50">
                {#if busy === 'cloudflare-update'}<LoaderCircle size={16} class="animate-spin" />{/if}
                {busy === 'cloudflare-update' ? 'Updating Worker…' : 'Install Worker update'}
              </button>
            {:else}
              <p class="mt-1 text-xs leading-5 text-muted-foreground">Update from the device that created this Worker, or follow its original deployment method.</p>
              <button type="button" data-focusable onclick={() => openUrl(CLOUDFLARE_UPDATE_GUIDE)} class="mt-2 inline-flex min-h-10 items-center gap-2 rounded-lg bg-secondary px-3 py-2 text-sm font-bold"><ExternalLink size={15} /> Open update guide</button>
            {/if}
          </section>
        {/if}
      </SettingsRow>
    {/if}

    {#if cloudflareSetupOpen}
      <SettingsRow
        title="Deploy into my Cloudflare account"
        description="Paste a scoped setup token once; izumi deploys there"
        learnMore="Prefer an account you already manage? Create a narrowly scoped setup token and paste it once. Your private Worker stores the token as an encrypted secret for automatic updates; it is never sent to your TV or synced to other devices. Keep it valid for updates to continue."
      >
        <button type="button" data-focusable onclick={() => { h.impact(); openCloudflareTokenSetup() }} class="inline-flex min-h-10 items-center gap-2 rounded-lg bg-secondary px-3 py-2 text-sm font-bold"><ExternalLink size={16} /> Create setup token</button>
        <input
          id="cloudflare-api-token"
          type="password"
          data-focusable
          value={cloudflareApiToken}
          oninput={updateCloudflareToken}
          autocomplete="off"
          autocapitalize="off"
          spellcheck="false"
          aria-label="Cloudflare setup token"
          placeholder="Paste Cloudflare API token"
          class="mt-2 w-full rounded-lg bg-input px-3 py-2.5 font-mono text-base sm:text-sm"
        />
        {#if cloudflareAccounts.length > 1}
          <div class="mt-3">
            <SelectMenu value={cloudflareAccountId} onChange={(value) => (cloudflareAccountId = value)} ariaLabel="Cloudflare account" options={[
              { value: '', label: 'Choose an account…' },
              ...cloudflareAccounts.map((account) => ({ value: account.id, label: account.name })),
            ]} />
          </div>
        {/if}
        <button type="button" data-focusable disabled={!!busy || !cloudflareApiToken} onclick={() => { h.impact(); deployCloudflare() }} class="mt-2 inline-flex min-h-10 items-center gap-2 rounded-lg bg-secondary px-3 py-2 text-sm font-bold disabled:opacity-50">
          {#if busy === 'cloudflare-deploy'}<LoaderCircle size={16} class="animate-spin" />{/if}
          {busy === 'cloudflare-deploy' ? 'Setting up Worker…' : cloudflareAccounts.length > 1 && !cloudflareAccountId ? 'Continue' : 'Deploy into this account'}
        </button>
      </SettingsRow>
      <SettingsRow
        title="Connect a manual Worker"
        description="For Wrangler or Git deploys, using a bootstrap secret"
        learnMore="Generate the secret before deploying, configure it as BOOTSTRAP_SECRET, then paste the resulting Worker URL."
      >
        {#if $cloudflareSetupSecret}
          <div class="flex gap-2">
            <input type="password" readonly value={$cloudflareSetupSecret} aria-label="Cloudflare setup secret" tabindex="-1" class="min-w-0 flex-1 rounded-lg bg-input px-3 py-2 font-mono text-xs" />
            <button type="button" data-focusable aria-label="Copy setup secret" onclick={() => copyCloudflare($cloudflareSetupSecret, 'Setup secret')} class="grid min-h-10 min-w-10 place-items-center rounded-lg bg-secondary"><Copy size={16} /></button>
          </div>
        {:else}
          <button type="button" data-focusable onclick={() => { h.impact(); prepareCloudflare() }} class="inline-flex min-h-10 items-center gap-2 rounded-lg bg-secondary px-3 py-2 text-sm font-bold"><KeyRound size={16} /> Generate secret</button>
        {/if}
        <button type="button" data-focusable onclick={() => { h.impact(); deployCloudflareFromGit() }} class="mt-2 inline-flex min-h-10 items-center gap-2 rounded-lg bg-secondary px-3 py-2 text-sm font-bold"><ExternalLink size={16} /> Optional Git-based deploy</button>
        <label for="cloudflare-endpoint" class="mt-3 block text-xs font-bold text-muted-foreground">Deployed Worker URL</label>
        <input id="cloudflare-endpoint" type="url" data-focusable bind:value={cloudflareEndpoint} placeholder="https://izumi-sync.you.workers.dev" class="mt-1 w-full rounded-lg bg-input px-3 py-2.5 text-base sm:text-sm" />
        <button type="button" data-focusable disabled={!!busy || !cloudflareEndpoint.trim() || !$cloudflareSetupSecret.trim()} onclick={() => { h.impact(); connectCloudflare() }} class="mt-2 min-h-10 rounded-lg bg-secondary px-3 py-2 text-sm font-bold disabled:opacity-50">{busy === 'cloudflare-connect' ? 'Connecting…' : 'Connect existing Worker'}</button>
      </SettingsRow>
    {/if}

    {#if irohLobby}
      {#snippet ticketIcon()}
        <span class="grid size-9 place-items-center rounded-lg bg-secondary text-muted-foreground"><Ticket size={18} /></span>
      {/snippet}
      {#snippet ticketChevron()}
        <ChevronDown size={18} class="text-muted-foreground transition-transform {ticketOpen ? 'rotate-180' : ''}" aria-hidden="true" />
      {/snippet}
      <SettingsRow settingKey="pairing-ticket" title="Join with a pairing ticket" description="When devices cannot use the same local network" leading={ticketIcon} control={ticketChevron} onActivate={() => (ticketOpen = !ticketOpen)} expanded={ticketOpen}>
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
    {:else if irohRoom}
      {#snippet copyTicketControl()}
        <button type="button" onclick={() => { h.tap(); copyTicket() }} disabled={!ticket} data-focusable
          class="inline-flex min-h-10 items-center gap-2 rounded-lg bg-secondary px-3 py-2 text-sm font-bold disabled:opacity-50">
          <Copy size={16} /> {copied ? 'Copied' : 'Copy ticket'}
        </button>
      {/snippet}
      <SettingsRow settingKey="pairing-ticket" title="Pairing ticket" description="For devices on other networks; treat it like a password" learnMore="Anyone with this reusable ticket can access the group. Share it privately; it may contain your current IP addresses." control={copyTicketControl}>
        <textarea readonly value={ticket} rows="4" aria-label="Pairing ticket" spellcheck="false" tabindex="-1"
          class="w-full resize-y rounded-lg bg-input px-3 py-2.5 font-mono text-sm sm:py-2 sm:text-xs"></textarea>
      </SettingsRow>
    {/if}

    <SettingsChoiceRow
      settingKey="peer-to-peer-relay"
      title="Peer-to-peer relay"
      description="Fallback route for P2P sync and Watch Together"
      learnMore="Peer-to-peer Device Sync (when selected) and Watch Together use separate encrypted connections, but may independently use this Iroh relay when a direct path is unavailable. Cloudflare Device Sync does not use this relay."
      value={$syncRelayMode}
      onChange={(value) => ($syncRelayMode = value as 'public' | 'custom')}
      options={[
        { value: 'public', label: 'Public relay' },
        { value: 'custom', label: 'Custom relay' },
      ]}
    />
    {#snippet relayApplyControl()}
      <button type="button" data-focusable disabled={applyingRelay || ($syncRelayMode === 'custom' && !$syncRelayUrl.trim())} onclick={applyRelay} class="min-h-10 rounded-lg bg-secondary px-3 py-2 text-sm font-bold disabled:opacity-50">{applyingRelay ? 'Applying…' : 'Apply relay'}</button>
    {/snippet}
    <SettingsRow title="Apply relay" description="Used for new connections; rejoin an active room after changing it" control={relayApplyControl} expanded={$syncRelayMode === 'custom' || !!relayNotice || !!relayError}>
      {#if $syncRelayMode === 'custom'}
        <label class="flex flex-col gap-1">
          <span class="text-sm font-bold">Iroh relay URL</span>
          <input type="url" data-focusable bind:value={$syncRelayUrl} placeholder="https://relay.example.com." class="rounded-md bg-input px-3 py-2.5 text-base sm:py-2 sm:text-sm" />
        </label>
      {/if}
      {#if relayNotice}<p class="mt-2 text-xs text-green-500">{relayNotice}</p>{/if}
      {#if relayError}<p role="alert" class="mt-2 text-xs text-destructive">{relayError}</p>{/if}
    </SettingsRow>
  </SettingsSubcategory>
</SettingsSection>

<style>
  .cloudflare-setup-highlight {
    outline: 2px solid hsl(var(--primary));
    outline-offset: 3px;
    background-color: hsl(var(--primary) / 0.15);
  }
</style>
