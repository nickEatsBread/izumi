<script lang="ts">
  import { onMount } from 'svelte'
  import { listen } from '@tauri-apps/api/event'
  import Check from '@lucide/svelte/icons/check'
  import TriangleAlert from '@lucide/svelte/icons/triangle-alert'
  import QrCode from '$lib/components/QrCode.svelte'
  import { m } from '$lib/paraglide/messages.js'
  import {
    enableDeviceSync,
    getSyncStatus,
    joinSyncGroup,
    listManualDevices,
    openAdoptWindow,
    pullWatchProgress,
    respondToPairRequest,
  } from '$lib/sync/client'
  import { applyAccountTokens, applyManualSnapshot } from '$lib/sync/manual'
  import type { AdoptOffer, ManualDevice, PairingWindow } from '$lib/sync/types'
  import {
    deviceTransferLink,
    isTransferWorking,
    runDeviceTransfer,
    transferProgress,
    type TransferStage,
  } from '$lib/onboarding/device-transfer'

  let { oncancel, onfinished }: { oncancel: () => void; onfinished: () => void } = $props()

  /** Re-open the native adopt window when this much of its two minutes is left. */
  const REARM_BEFORE_MS = 30_000

  let stage = $state<TransferStage>('waiting')
  let window_ = $state<PairingWindow | undefined>()
  let offer = $state<AdoptOffer | undefined>()
  let error = $state('')
  let received = $state({ setup: false, history: 0, accounts: false })

  const link = $derived(window_ ? deviceTransferLink(window_.endpointId) : '')
  const working = $derived(isTransferWorking(stage))
  const progress = $derived(transferProgress(stage))

  const STAGE_LABEL: Record<TransferStage, () => string> = {
    waiting: m.onboarding_transfer_waiting,
    offered: m.onboarding_transfer_waiting,
    linking: m.onboarding_transfer_linking,
    sources: m.onboarding_transfer_sources,
    history: m.onboarding_transfer_history,
    accounts: m.onboarding_transfer_accounts,
    done: m.onboarding_transfer_done,
    failed: m.onboarding_transfer_failed,
  }

  /** The sender publishes its snapshot moments after the room is handed over, so the record is
   *  usually not there on the first read. Poll rather than fail, and give up loudly. */
  async function waitForSnapshot(timeoutMs = 25_000): Promise<ManualDevice | undefined> {
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      const devices = await listManualDevices().catch(() => [] as ManualDevice[])
      const sender = devices.find((device) => !device.isThisDevice)
      if (sender) return sender
      await new Promise((resolve) => setTimeout(resolve, 700))
    }
    return undefined
  }

  async function start() {
    error = ''
    stage = 'waiting'
    offer = undefined
    try {
      await enableDeviceSync()
      // The native runtime can still be starting on a cold first launch; the adopt window needs
      // an endpoint id, so wait for one rather than reporting a failure the user cannot act on.
      for (let attempt = 0; attempt < 20; attempt++) {
        const status = await getSyncStatus().catch(() => undefined)
        if (status?.state === 'ready') break
        if (status?.state === 'failed') throw new Error(status.error)
        await new Promise((resolve) => setTimeout(resolve, 500))
      }
      window_ = await openAdoptWindow()
    } catch (cause) {
      error = cause instanceof Error ? cause.message : String(cause)
      stage = 'failed'
    }
  }

  async function begin(ticket: string) {
    let snapshot: ManualDevice | undefined
    const outcome = await runDeviceTransfer(
      ticket,
      {
        link: async (value) => {
          await joinSyncGroup(value)
        },
        applySetup: async () => {
          snapshot = await waitForSnapshot()
          if (!snapshot) return false
          // Accounts are held back so they can be applied under their own label below, rather
          // than silently inside this step.
          applyManualSnapshot(snapshot, false)
          return true
        },
        applyHistory: () => pullWatchProgress(),
        applyAccounts: async () => applyAccountTokens(snapshot?.accounts),
      },
      (next) => (stage = next),
    )
    received = outcome.received
    if (outcome.stage === 'failed') error = outcome.error ?? ''
  }

  async function accept() {
    if (!offer) return
    const pending = offer
    offer = undefined
    await respondToPairRequest(pending.requestId, true).catch((cause) => {
      error = cause instanceof Error ? cause.message : String(cause)
      stage = 'failed'
    })
  }

  async function decline() {
    if (!offer) return
    const pending = offer
    offer = undefined
    stage = 'waiting'
    await respondToPairRequest(pending.requestId, false).catch(() => {})
  }

  onMount(() => {
    void start()
    const offers = listen<AdoptOffer>('iroh-adopt-offer', (event) => {
      if (stage !== 'waiting') return
      offer = event.payload
      stage = 'offered'
    })
    const accepted = listen<{ ticket: string }>('iroh-adopt-accepted', (event) => {
      void begin(event.payload.ticket)
    })
    // The native adopt window — and the nearby advertisement that lets the other device list this
    // one — lasts two minutes, while this screen routinely sits for much longer (walk to the other
    // device, find Settings → Sync). Re-arm it before it lapses; the endpoint id, so the QR and the
    // code, stay the same. Measured on a Deck 2026-09-12: after the window had silently expired,
    // every "Set up" from the sender was refused as "not waiting for a setup transfer" while this
    // screen still said "Waiting". Only if re-arming itself keeps failing does the expiry show.
    let rearming = false
    const expiry = setInterval(() => {
      if (stage !== 'waiting' || !window_) return
      const remaining = window_.expiresAt - Date.now()
      if (remaining < REARM_BEFORE_MS && !rearming) {
        rearming = true
        openAdoptWindow()
          .then((next) => { if (stage === 'waiting') window_ = next })
          .catch(() => {})
          .finally(() => { rearming = false })
      }
      if (remaining <= 0) {
        error = m.onboarding_transfer_expired()
        stage = 'failed'
      }
    }, 1000)
    return () => {
      clearInterval(expiry)
      void offers.then((stop) => stop()).catch(() => {})
      void accepted.then((stop) => stop()).catch(() => {})
    }
  })
</script>

<section class="transfer">
  <h2 data-step-heading tabindex="-1" aria-describedby="setup-progress" class="setup-heading text-xl font-black">
    {m.onboarding_transfer_title()}
  </h2>

  {#if stage === 'done'}
    <div class="state">
      <span class="state-icon done" aria-hidden="true"><Check size={26} /></span>
      <p class="state-label">{m.onboarding_transfer_done()}</p>
      <p class="state-detail">
        {#if received.setup}{m.onboarding_transfer_sources()}{/if}
        {#if received.history}· {received.history}{/if}
      </p>
    </div>
    <button type="button" data-focusable onclick={onfinished} class="primary">{m.onboarding_transfer_continue()}</button>
  {:else if stage === 'failed'}
    <div class="state">
      <span class="state-icon failed" aria-hidden="true"><TriangleAlert size={24} /></span>
      <p class="state-label">{m.onboarding_transfer_failed()}</p>
      {#if error}<p class="state-detail">{error}</p>{/if}
    </div>
    <div class="row">
      <button type="button" data-focusable onclick={() => void start()} class="primary">{m.onboarding_transfer_retry()}</button>
      <button type="button" data-focusable onclick={oncancel} class="secondary">{m.onboarding_transfer_manual()}</button>
    </div>
  {:else if offer}
    <div class="state">
      <p class="state-label">{m.onboarding_transfer_offer({ device: offer.deviceName })}</p>
      <p class="code" aria-label={offer.code}>{offer.code}</p>
      <p class="state-detail">{m.onboarding_transfer_offer_hint()}</p>
    </div>
    <div class="row">
      <button type="button" data-focusable onclick={() => void accept()} class="primary">{m.onboarding_transfer_accept()}</button>
      <button type="button" data-focusable onclick={() => void decline()} class="secondary">{m.onboarding_transfer_decline()}</button>
    </div>
  {:else if working}
    <div class="state">
      <span class="signal" class:live={working} aria-hidden="true">
        <i></i><i></i><i></i>
      </span>
      <p class="state-label" role="status" aria-live="polite">{STAGE_LABEL[stage]()}</p>
      <div class="rail"><div class="fill" style:width="{Math.round(progress * 100)}%"></div></div>
    </div>
  {:else}
    <p class="intro">{m.onboarding_transfer_intro()}</p>
    <div class="pairing">
      {#if link}
        <figure class="qr-frame">
          <QrCode value={link} label={m.onboarding_transfer_scan()} />
          <figcaption>{m.onboarding_transfer_scan()}</figcaption>
        </figure>
      {/if}
      <div class="code-block">
        <p class="code-label">{m.onboarding_transfer_code_label()}</p>
        <p class="code">{window_?.shortId ?? '·····'}</p>
        <p class="state-detail">{m.onboarding_transfer_code_hint()}</p>
      </div>
    </div>
    <p class="waiting" role="status" aria-live="polite">
      <span class="signal live" aria-hidden="true"><i></i><i></i><i></i></span>
      {m.onboarding_transfer_waiting()}
    </p>
  {/if}
</section>

<style>
  .transfer { display: flex; flex-direction: column; gap: 1.25rem; }
  .intro { color: hsl(var(--muted-foreground)); font-size: .9rem; line-height: 1.5; }
  .pairing { display: grid; grid-template-columns: minmax(0, 9.5rem) minmax(0, 1fr); gap: 1.25rem; align-items: center; }
  @media (max-width: 520px) { .pairing { grid-template-columns: minmax(0, 1fr); } }
  .qr-frame { margin: 0; display: grid; gap: .5rem; padding: .75rem; border-radius: .75rem; background: #F4F8FF; }
  .qr-frame figcaption { text-align: center; font-size: .7rem; font-weight: 700; color: #14233F; }
  .code-block { display: grid; gap: .35rem; }
  .code-label { font-size: .75rem; font-weight: 700; text-transform: uppercase; letter-spacing: .08em; color: hsl(var(--muted-foreground)); }
  .code { font-family: var(--font-mono, monospace); font-size: 1.6rem; font-weight: 800; letter-spacing: .18em; }
  .state { display: grid; justify-items: center; gap: .6rem; padding: 1.25rem 0; text-align: center; }
  .state-label { font-size: 1rem; font-weight: 700; }
  .state-detail { font-size: .8rem; color: hsl(var(--muted-foreground)); }
  .state-icon { display: grid; place-items: center; width: 3rem; height: 3rem; border-radius: 50%; }
  .state-icon.done { background: hsl(var(--primary) / .15); color: hsl(var(--primary)); }
  .state-icon.failed { background: hsl(var(--destructive) / .15); color: hsl(var(--destructive)); }
  .rail { width: min(18rem, 100%); height: 4px; border-radius: 999px; background: hsl(var(--secondary)); overflow: hidden; }
  .fill { height: 100%; border-radius: 999px; background: hsl(var(--primary)); transition: width 400ms cubic-bezier(.2, .7, .2, 1); }
  .waiting { display: flex; align-items: center; gap: .6rem; font-size: .85rem; color: hsl(var(--muted-foreground)); }
  .row { display: flex; flex-wrap: wrap; gap: .75rem; }
  .primary, .secondary { min-height: 2.75rem; border-radius: .5rem; padding: .65rem 1.1rem; font-size: .85rem; font-weight: 700; }
  .primary { background: hsl(var(--primary)); color: hsl(var(--primary-foreground)); }
  .secondary { background: hsl(var(--secondary)); }

  /* Three rising bars, the shape everyone already reads as "a link is being established". */
  .signal { display: inline-flex; align-items: flex-end; gap: 2px; height: 1.1rem; }
  .signal i { width: 4px; border-radius: 1px; background: hsl(var(--primary)); opacity: .35; }
  .signal i:nth-child(1) { height: 35%; }
  .signal i:nth-child(2) { height: 65%; }
  .signal i:nth-child(3) { height: 100%; }
  .signal.live i { animation: signal 1.2s ease-in-out infinite; }
  .signal.live i:nth-child(2) { animation-delay: .18s; }
  .signal.live i:nth-child(3) { animation-delay: .36s; }
  @keyframes signal { 0%, 70%, 100% { opacity: .3; } 35% { opacity: 1; } }
  @media (prefers-reduced-motion: reduce) {
    .signal.live i { animation: none; opacity: .8; }
    .fill { transition: none; }
  }
</style>
