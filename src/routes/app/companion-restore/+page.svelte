<script lang="ts">
  import { onMount } from 'svelte'
  import { page } from '$app/state'
  import { goto } from '$app/navigation'
  import MonitorSmartphone from '@lucide/svelte/icons/monitor-smartphone'
  import LoaderCircle from '@lucide/svelte/icons/loader-circle'
  import { activeProfile, activeProfileLocked, profileSwitcherOpen } from '$lib/profiles/store'
  import { cloudflareSyncConfig } from '$lib/sync/cloudflare'
  import {
    LIMITED_RECOVERY_WARNING, dismissTvRestore, finishTvRestore, linkAndRestoreTv,
    listTvRestoreSetups, normalizeRestoreCode, normalizeRestoreEndpoint, pendingTvRestore,
    prepareRestoreProfiles, restoreTvProgress, restoreTvSetup, type TvRestoreSession,
  } from '$lib/companion/restore'
  import type { ManualDevice } from '$lib/sync/types'

  let endpoint = $state('')
  let code = $state('')
  let deviceName = $state('Izumi device')
  let session = $state<TvRestoreSession | null>(null)
  let busy = $state('')
  let error = $state('')
  let message = $state('')
  let devices = $state<ManualDevice[]>([])
  let selectedSetup = $state('')
  let setupsLoaded = $state(false)
  let setupsProfileId = $state('')
  const unlocked = $derived(!$activeProfileLocked && !$profileSwitcherOpen)
  const validInput = $derived.by(() => {
    try { normalizeRestoreEndpoint(endpoint); normalizeRestoreCode(code); return true } catch { return false }
  })
  const availableSetups = $derived(setupsProfileId === $activeProfile.id ? devices : [])

  async function action(name: string, run: () => Promise<void>) {
    if (busy) return
    busy = name; error = ''; message = ''
    try { await run() }
    catch (cause) { error = cause instanceof Error ? cause.message : 'Restore could not finish. Please try again.' }
    finally {
      busy = ''
      try { session = pendingTvRestore() } catch { /* Keep the actionable read error already shown. */ }
    }
  }

  async function link() {
    await action('link', async () => {
      session = await linkAndRestoreTv(endpoint, code, deviceName)
      // The validated claim is durable before removing the one-use secret from browser history.
      history.replaceState(history.state, '', `/app/companion-restore?${new URLSearchParams({ worker: session.config.endpoint })}`)
      code = ''
      session = await prepareRestoreProfiles()
    })
  }

  async function continueRestore() {
    await action('continue', async () => {
      if (session?.stage === 'validated') session = await prepareRestoreProfiles()
      else { session = await finishTvRestore(); message = 'Your TV is linked. Choose whether to import watch progress below.' }
    })
  }

  async function findSetups() {
    await action('setups', async () => {
      const profileId = $activeProfile.id
      devices = await listTvRestoreSetups()
      setupsProfileId = profileId; setupsLoaded = true; selectedSetup = ''
    })
  }

  onMount(() => {
    try {
      session = pendingTvRestore()
      endpoint = session?.config.endpoint ?? page.url.searchParams.get('worker') ?? ''
      code = new URLSearchParams(page.url.hash.slice(1)).get('code') ?? page.url.searchParams.get('code') ?? ''
      // Direct local navigation gets the same fragment-only treatment as external deep links.
      if (page.url.searchParams.has('code')) {
        history.replaceState(history.state, '', `/app/companion-restore?${new URLSearchParams({ worker: endpoint })}#${new URLSearchParams({ code })}`)
      }
      if (session?.stage === 'profile') profileSwitcherOpen.set(true)
    } catch (cause) { error = cause instanceof Error ? cause.message : 'The saved restore could not be read.' }
  })
</script>

<svelte:head><title>Restore from TV · izumi</title></svelte:head>

<div class="mx-auto w-full max-w-2xl px-4 py-8 sm:py-12">
  <a href="/app/settings/devices#tv" data-focusable class="inline-flex min-h-10 items-center text-sm font-bold text-muted-foreground hover:text-foreground">TV connections</a>
  <div class="mt-5 flex items-center gap-3">
    <span class="grid size-12 shrink-0 place-items-center rounded-xl bg-primary/15 text-primary"><MonitorSmartphone size={25} /></span>
    <div><p class="text-xs font-bold text-primary">izumi Companion</p><h1 class="text-3xl font-black">Restore from TV</h1></div>
  </div>
  <p class="mt-4 text-sm leading-6 text-muted-foreground">Bring your saved TV setup and watch progress to this device. On your Samsung TV, open Settings → Connection → Link phone or desktop, then scan the QR code with your phone’s camera to open Izumi. You can also enter the Worker address and 20-character code below.</p>

  {#if error}<p role="alert" class="mt-5 rounded-xl border border-destructive/30 bg-destructive/10 p-4 text-sm">{error}</p>{/if}
  {#if message}<p role="status" class="mt-5 text-sm text-primary">{message}</p>{/if}

  {#if !session}
    <form onsubmit={(event) => { event.preventDefault(); void link() }} class="mt-7 space-y-5">
      <label for="restore-worker" class="block text-sm font-bold">Worker address
        <input id="restore-worker" type="url" bind:value={endpoint} required autocomplete="off" spellcheck="false" placeholder="https://your-worker.workers.dev" data-focusable disabled={!!busy} class="mt-2 min-h-12 w-full rounded-lg bg-input px-3 font-normal" />
      </label>
      <label for="restore-code" class="block text-sm font-bold">Restore code
        <input id="restore-code" bind:value={code} required autocomplete="off" autocapitalize="characters" spellcheck="false" aria-describedby="restore-code-help" data-focusable disabled={!!busy} class="mt-2 min-h-12 w-full rounded-lg bg-input px-3 font-mono uppercase tracking-widest" />
        <span id="restore-code-help" class="mt-1 block text-xs font-normal text-muted-foreground">20 letters and numbers. Spaces and hyphens are accepted.</span>
      </label>
      <label for="restore-device-name" class="block text-sm font-bold">This device’s name
        <input id="restore-device-name" bind:value={deviceName} maxlength="80" autocomplete="off" data-focusable disabled={!!busy} class="mt-2 min-h-12 w-full rounded-lg bg-input px-3 font-normal" />
      </label>
      <div class="border-y border-border py-4 text-sm leading-6">
        <p class="font-bold">Review before linking</p>
        <p class="mt-2 text-muted-foreground">Link and restore replaces this device’s sync connection, saved sources, debrid settings, playback preferences, catalog settings, collections and household with the setup available from your TV.</p>
        {#if $cloudflareSyncConfig.endpoint}<p class="mt-2 break-all text-muted-foreground">Current Worker: {$cloudflareSyncConfig.endpoint}</p>{/if}
        <p class="mt-2 text-muted-foreground">You will choose and unlock your household profile using Izumi’s profile screen. Watch progress and other devices’ shared settings can then be imported separately.</p>
        <p class="mt-2 text-muted-foreground">Full encrypted sync requires a recovery key. Account logins that were not synced are not restored; sign in to those accounts separately.</p>
      </div>
      <button type="submit" disabled={!!busy || !validInput || !unlocked} data-focusable class="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-primary px-5 font-black text-primary-foreground disabled:opacity-50">
        {#if busy}<LoaderCircle size={18} class="animate-spin" />{/if}{busy ? 'Linking and restoring…' : 'Link and restore'}
      </button>
    </form>
  {:else}
    <section class="mt-7 space-y-5" aria-label="Restore status">
      <div class="border-y border-border py-4">
        <h2 class="text-lg font-black">{session.stage === 'validated' ? 'TV claim saved' : session.stage === 'profile' ? 'Choose your profile' : 'TV linked'}</h2>
        <p class="mt-1 break-all text-sm text-muted-foreground">{session.config.endpoint}</p>
        <p class="mt-2 text-sm text-muted-foreground">Your successful claim is saved on this device. Retry any unfinished step without entering another code.</p>
      </div>
      {#if session.limitedRecovery}<p role="status" class="rounded-lg border border-border p-4 text-sm leading-6">{LIMITED_RECOVERY_WARNING}</p>{/if}
      {#if session.recoverySeedPending}<p role="status" class="rounded-lg border border-border p-4 text-sm leading-6">This device already has the matching encrypted sync key. After choosing and unlocking your profile, finish secure recovery to let future clients restore through this TV.</p>{/if}
      {#if !session.profile}<p class="text-sm text-muted-foreground">The TV has no saved setup profile. Your existing source and catalog settings were kept.</p>{/if}
      <div>
        <p class="text-sm font-bold">Active profile: {$activeProfile.name}</p>
        <button type="button" onclick={() => profileSwitcherOpen.set(true)} disabled={!!busy} data-focusable class="mt-2 min-h-11 rounded-lg bg-secondary px-4 text-sm font-bold">Choose or unlock profile</button>
      </div>
      {#if session.stage !== 'linked'}
        <button type="button" onclick={continueRestore} disabled={!!busy || !unlocked} data-focusable class="min-h-12 w-full rounded-xl bg-primary px-5 font-bold text-primary-foreground disabled:opacity-50">
          {busy ? 'Restoring…' : session.stage === 'validated' ? 'Retry saved setup restore' : session.recoverySeedPending ? 'Finish secure recovery' : 'Continue with this profile'}
        </button>
      {:else}
        <section class="border-t border-border pt-5" aria-labelledby="restore-progress-heading">
          <h2 id="restore-progress-heading" class="font-black">Watch progress</h2>
          <p class="mt-1 text-sm leading-6 text-muted-foreground">Import progress for {$activeProfile.name}. {session.limitedRecovery ? 'TV progress is available; older encrypted sync records need a full-sync invitation.' : 'Shared watch history and TV progress will merge with this profile’s data.'}</p>
          <button type="button" disabled={!!busy || !unlocked} onclick={() => action('progress', async () => { await restoreTvProgress(); message = 'Watch progress restored for the active profile.' })} data-focusable class="mt-3 min-h-12 rounded-lg bg-primary px-4 font-bold text-primary-foreground disabled:opacity-50">{busy === 'progress' ? 'Importing…' : session.progressRestored ? 'Import progress again' : 'Restore watch progress'}</button>
        </section>
        {#if !session.limitedRecovery}
          <section class="border-t border-border pt-5" aria-labelledby="restore-setups-heading">
            <h2 id="restore-setups-heading" class="font-black">Previously shared device setup</h2>
            <p class="mt-1 text-sm leading-6 text-muted-foreground">Optional. A shared setup replaces sources, debrid credentials and preferences again. Only setups for your active profile are shown.</p>
            <button type="button" disabled={!!busy || !unlocked} onclick={findSetups} data-focusable class="mt-3 min-h-11 rounded-lg bg-secondary px-4 text-sm font-bold">{busy === 'setups' ? 'Looking…' : 'Find shared setups'}</button>
            {#if availableSetups.length}
              <label for="restore-shared-setup" class="mt-4 block text-sm font-bold">Setup to restore</label>
              <select id="restore-shared-setup" bind:value={selectedSetup} disabled={!!busy || !unlocked} data-focusable class="mt-2 min-h-12 w-full rounded-lg bg-input px-3">
                <option value="">Choose a shared setup</option>
                {#each availableSetups as device (device.deviceId)}<option value={device.deviceId}>{device.deviceName} · {new Date(device.updatedAt).toLocaleDateString()}</option>{/each}
              </select>
              <button type="button" disabled={!!busy || !unlocked || !selectedSetup} onclick={() => action('receive', async () => {
                const device = availableSetups.find(d => d.deviceId === selectedSetup)
                if (!device) return
                await restoreTvSetup(device); message = 'The selected setup was restored.'
              })} data-focusable class="mt-3 min-h-11 rounded-lg bg-secondary px-4 text-sm font-bold disabled:opacity-50">Replace settings with selected setup</button>
            {:else if setupsLoaded && setupsProfileId === $activeProfile.id}<p class="mt-3 text-sm text-muted-foreground">No readable shared setups for this profile.</p>{/if}
          </section>
        {/if}
        <button type="button" disabled={!!busy} onclick={() => { dismissTvRestore(); void goto('/app/home') }} data-focusable class="min-h-12 w-full rounded-xl bg-secondary px-5 font-bold">Done</button>
      {/if}
      <p class="text-xs leading-5 text-muted-foreground">Account logins that were not synced still need to be connected in account settings.</p>
    </section>
  {/if}
</div>
