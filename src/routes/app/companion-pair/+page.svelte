<script lang="ts">
  import { onMount } from 'svelte'
  import { invoke } from '@tauri-apps/api/core'
  import { goto } from '$app/navigation'
  import { page } from '$app/state'
  import { getContextClient } from '@urql/svelte'
  import MonitorSmartphone from '@lucide/svelte/icons/monitor-smartphone'
  import LoaderCircle from '@lucide/svelte/icons/loader-circle'
  import Check from '@lucide/svelte/icons/check'
  import { pairCompanion, type PairedCompanion } from '$lib/companion/client'
  import { isAndroid } from '$lib/platform'
  import { parseCompanionPairingLink, type CompanionPairingLink } from '$lib/companion/protocol'
  import { createCompanionSnapshot } from '$lib/companion/snapshot'
  import {
    createSyncGroup,
    createCloudflareCompanionEnrollment,
    enableDeviceSync,
    getSyncStatus,
    publishPresence,
    syncDeviceName,
    syncProvider,
  } from '$lib/sync/client'
  import type { SyncStatus } from '$lib/sync/types'

  const client = getContextClient()
  let link = $state<CompanionPairingLink | null>(null)
  let status = $state<SyncStatus>({ state: 'starting' })
  let busy = $state(false)
  let complete = $state(false)
  let pairedDevice = $state<PairedCompanion | null>(null)
  let notificationBusy = $state(false)
  let notificationSetupStarted = $state(false)
  let detail = $state('Checking your sync group…')
  let error = $state('')

  const paired = $derived(status.state === 'ready' && status.paired)
  const actionLabel = $derived(paired ? 'Add this TV' : 'Create sync group and add TV')
  const pairingCode = $derived(link
    ? `${link.challenge.slice(0, 3)} ${link.challenge.slice(3, 6)}`.toUpperCase()
    : '')

  async function waitForReady(): Promise<SyncStatus> {
    for (let attempt = 0; attempt < 30; attempt += 1) {
      const current = await getSyncStatus()
      status = current
      if (current.state === 'ready') return current
      if (current.state === 'failed') throw new Error(current.error)
      await new Promise((resolve) => setTimeout(resolve, 500))
    }
    throw new Error('Device sync did not become ready in time.')
  }

  async function addTv() {
    if (!link || busy) return
    busy = true
    error = ''
    try {
      detail = 'Preparing your sync group…'
      let current = await getSyncStatus()
      if (current.state === 'disabled') {
        await enableDeviceSync()
        current = await waitForReady()
      } else if (current.state === 'starting') current = await waitForReady()
      if (current.state === 'failed') throw new Error(current.error)
      if (current.state !== 'ready') throw new Error('Device sync is not available.')
      if (!current.paired) {
        if ($syncProvider === 'cloudflare') {
          throw new Error('Connect or join your Cloudflare Worker in Device sync, then return to this pairing code.')
        }
        await createSyncGroup()
        current = await waitForReady()
      }
      status = current
      await publishPresence().catch(() => {})
      detail = 'Building the TV home from your selected catalog…'
      const snapshot = await createCompanionSnapshot(client)
      detail = 'Verifying the code with your TV…'
      pairedDevice = await pairCompanion(link, snapshot, $syncDeviceName.trim() || 'Izumi sync group')
      complete = true
      detail = pairedDevice.cloudflare
        ? $isAndroid
          ? 'This TV is linked. Enable private Worker notifications to let it reach this phone while Izumi is closed.'
          : 'This TV is linked to your opt-in private Worker resolver. The desktop app will not receive closed-app requests.'
        : 'This TV is linked. Continue Watching and your selected catalog are ready.'
    } catch (reason) {
      error = reason instanceof Error ? reason.message : String(reason)
    } finally {
      busy = false
    }
  }

  async function enableTvNotifications() {
    if (!pairedDevice?.cloudflare || notificationBusy) return
    notificationBusy = true
    error = ''
    try {
      const enrollment = await createCloudflareCompanionEnrollment()
      await invoke('plugin:extplayer|open_browser', { payload: { url: enrollment.url } })
      notificationSetupStarted = true
      detail = 'Grant notification permission in the browser, then use Return to Izumi. Your Worker is the only Izumi server involved.'
    } catch (reason) {
      error = reason instanceof Error ? reason.message : String(reason)
    } finally {
      notificationBusy = false
    }
  }

  onMount(() => {
    const raw = `izumi://companion/pair?${page.url.searchParams.toString()}`
    link = parseCompanionPairingLink(raw)
    if (!link) {
      error = 'This TV pairing code is invalid or expired.'
      detail = ''
      return
    }
    void getSyncStatus().then((value) => {
      status = value
      detail = value.state === 'ready' && value.paired
        ? 'Your sync group is ready to add this TV.'
        : 'No sync group is active yet. Izumi can create one before adding the TV.'
    }).catch((reason) => { error = reason instanceof Error ? reason.message : String(reason) })
  })
</script>

<svelte:head><title>Pair TV · izumi</title></svelte:head>

<div class="mx-auto flex min-h-[70vh] max-w-xl items-center px-4 py-12">
  <section class="w-full rounded-2xl border border-border bg-card p-6 shadow-xl sm:p-8">
    <div class="mb-5 grid size-14 place-items-center rounded-2xl bg-primary/15 text-primary">
      {#if complete}<Check size={30} strokeWidth={3} />{:else}<MonitorSmartphone size={30} />{/if}
    </div>
    <p class="text-xs font-black uppercase tracking-[.18em] text-primary">izumi Companion</p>
    <h1 class="mt-2 text-3xl font-black">{complete ? 'TV paired' : 'Add this Samsung TV'}</h1>
    {#if link}<p class="mt-2 text-sm text-muted-foreground">TV on {link.address}</p>{/if}
    {#if link && !complete}
      <div class="mt-5 rounded-xl border border-primary/25 bg-primary/10 px-5 py-4 text-center">
        <p class="text-[.65rem] font-black uppercase tracking-[.24em] text-primary">Pairing code</p>
        <p class="mt-1 font-mono text-3xl font-black tracking-[.16em] text-foreground">{pairingCode}</p>
        <p class="mt-1 text-xs text-muted-foreground">Confirm this matches the code shown on your TV.</p>
      </div>
    {/if}
    {#if detail}<p class="mt-5 text-sm leading-6 text-muted-foreground">{detail}</p>{/if}
    {#if error}<p class="mt-5 rounded-xl border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">{error}</p>{/if}

    <div class="mt-7 flex flex-col gap-3 sm:flex-row">
      {#if !complete}
        <button type="button" data-focusable disabled={!link || busy} onclick={addTv}
          class="inline-flex min-h-12 flex-1 items-center justify-center gap-2 rounded-xl bg-primary px-5 font-black text-primary-foreground disabled:opacity-50">
          {#if busy}<LoaderCircle size={18} class="animate-spin" />{/if}{busy ? 'Adding TV…' : actionLabel}
        </button>
      {/if}
      {#if complete && pairedDevice?.cloudflare && $isAndroid}
        <button type="button" data-focusable disabled={notificationBusy} onclick={enableTvNotifications}
          class="inline-flex min-h-12 flex-1 items-center justify-center gap-2 rounded-xl bg-primary px-5 font-black text-primary-foreground disabled:opacity-50">
          {#if notificationBusy}<LoaderCircle size={18} class="animate-spin" />{/if}
          {notificationSetupStarted ? 'Open notification setup again' : 'Enable TV notifications'}
        </button>
      {/if}
      <button type="button" data-focusable onclick={() => goto(complete ? '/app/home' : '/app/settings/sync')}
        class="min-h-12 rounded-xl bg-secondary px-5 font-bold">
        {complete ? 'Done' : 'Device sync settings'}
      </button>
    </div>
  </section>
</div>
