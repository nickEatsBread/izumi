import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8')
const shell = read('./FirstRunSetup.svelte')
const transfer = read('./steps/TransferStep.svelte')
const watch = read('./steps/WatchStep.svelte')
const qr = read('../QrCode.svelte')
const syncPage = read('../../../routes/app/settings/sync/+page.svelte')
const deepLink = read('../../deep-link-target.ts')
const client = read('../../sync/client.ts')

describe('set up from another device', () => {
  it('opens on the transfer screen in game mode, but only once the flag has resolved', () => {
    // `gameMode` is populated asynchronously, so reading it at initialization would always see
    // false and every Deck would land in the typing-heavy wizard instead.
    const imported = shell.match(/import \{([^}]*)\} from '\$lib\/player\/session'/)![1]
    for (const name of ['gameMode', 'gameModeResolved']) expect(imported).toContain(name)
    expect(shell).toContain('if (modeSettled || !$gameModeResolved) return')
    expect(shell).toContain("if ($gameMode) mode = 'transfer'")
    // A choice the user already made by hand must not be overwritten when the flag lands.
    const effect = shell.slice(shell.indexOf('$gameModeResolved'))
    expect(effect.slice(0, effect.indexOf('}'))).toContain('modeSettled = true')
    for (const handler of ['function enterTransfer', 'function leaveTransfer']) {
      const body = shell.slice(shell.indexOf(handler))
      expect(body.slice(0, body.indexOf('\n  }'))).toContain('modeSettled = true')
    }
  })

  it('is an alternative to the wizard rather than a step inside it', () => {
    // Numbering it as a step would put "3 of 8" on a screen that replaces all eight, and would
    // drag it into the back/next footer it has no use for.
    expect(shell).toContain("let mode = $state<'wizard' | 'transfer'>('wizard')")
    expect(shell).not.toContain("step === 'transfer'")
    expect(shell).not.toMatch(/StepId\s*=\s*[^\n]*'transfer'/)
  })

  it('offers the alternative beside Next, and only on the screen it can still replace', () => {
    // In the footer rather than inside the step: it is the other way forward, not a setting on
    // the screen. Past the first screen it would throw away answers already given.
    expect(watch).not.toContain('onboarding_transfer_cta')
    // The transfer branch has a footer of its own earlier in the file; this is the wizard's.
    const footer = shell.slice(shell.lastIndexOf('<footer class="setup-actions'))
    const cta = footer.indexOf('m.onboarding_transfer_cta()')
    expect(cta).toBeGreaterThan(-1)
    expect(cta).toBeLessThan(footer.indexOf('m.onboarding_next()'))
    expect(footer.slice(0, cta)).toContain("{#if step === 'watch'}")
    expect(footer).toContain('onclick={enterTransfer}')
  })

  it('treats a finished transfer as a finished setup', () => {
    const body = shell.slice(shell.indexOf('async function completeTransfer'))
    const fn = body.slice(0, body.indexOf('\n  }'))
    expect(fn).toContain('finishOnboarding()')
    expect(fn).toContain("goto('/app/home')")
  })

  it('applies accounts under their own label instead of silently inside the setup step', () => {
    expect(transfer).toContain('applyManualSnapshot(snapshot, false)')
    expect(transfer).toContain('applyAccountTokens(snapshot?.accounts)')
    expect(transfer).toContain('m.onboarding_transfer_accounts')
  })

  it('waits for the sender to publish rather than failing on the first empty read', () => {
    // The room is handed over before the snapshot is written to it, so the first read is
    // normally empty. Failing there would make the happy path look broken.
    expect(transfer).toContain('async function waitForSnapshot')
    expect(transfer).toContain('while (Date.now() < deadline)')
    expect(transfer).toContain('device.isThisDevice')
  })

  it('says the code expired instead of leaving a dead one on screen', () => {
    expect(transfer).toContain('const remaining = window_.expiresAt - Date.now()')
    expect(transfer).toContain('m.onboarding_transfer_expired()')
  })

  it('animates the signal only while the device is actually working', () => {
    expect(transfer).toContain('isTransferWorking')
    expect(transfer).toContain('class:live={working}')
    expect(transfer).toContain('@media (prefers-reduced-motion: reduce)')
  })

  it('asks the person to match the code before the ticket is trusted', () => {
    // Anything on the network can reach an advertising endpoint, so an offer is never acted on
    // just because it arrived.
    expect(transfer).toContain('m.onboarding_transfer_offer_hint()')
    expect(transfer).toContain('respondToPairRequest(pending.requestId, true)')
    expect(transfer).toContain('respondToPairRequest(pending.requestId, false)')
  })

  it('gives the QR a quiet zone, without which many scanners never lock on', () => {
    expect(qr).toContain('const QUIET = 4')
    expect(qr).toContain('matrix.span')
    expect(qr).toContain("qrcode(0, 'M')")
  })
})

describe('sending a setup from the device that has one', () => {
  it('never carries an accounts choice over from a previous send', () => {
    const body = syncPage.slice(syncPage.indexOf('function askToSendSetup'))
    expect(body.slice(0, body.indexOf('\n  }'))).toContain('offerAccounts = false')
  })

  it('itemises what leaves, and keeps credentials a separate opt-in', () => {
    expect(syncPage).toContain('Also send signed-in accounts')
    expect(syncPage).toContain('bind:checked={offerAccounts}')
    expect(syncPage).toContain('sendManualSnapshot(withAccounts)')
    // Default off. `offerAccounts` is only ever initialised to false, never to a stored value.
    expect(syncPage).toContain('let offerAccounts = $state(false)')
  })

  it('picks send-vs-join from what the peer advertises, never from local state', () => {
    // Regression: this was gated on `paired`, so a device that had never created a room — the
    // normal state when pairing your first two devices — offered Join against a Deck waiting to
    // be adopted, and the native side answered "Nearby pairing is not enabled on that device."
    expect(syncPage).toContain("{#if device.mode === 'adopt'}")
    expect(syncPage).not.toContain('{#if paired}\n              <button')
    expect(syncPage).toContain('askToSendSetup(device)')
    expect(syncPage).toContain('offerSetupToDevice(device.endpointId)')
  })

  it('creates a room before offering one, since an empty device has no ticket to give', () => {
    const body = client.slice(client.indexOf('export async function offerSetupToDevice'))
    const fn = body.slice(0, body.indexOf('\n}'))
    expect(fn).toContain('if (!status.paired)')
    expect(fn).toContain('await createSyncGroup()')
    // Re-read: the status captured before the room existed still says unpaired.
    expect(fn.lastIndexOf('await getSyncStatus()')).toBeGreaterThan(fn.indexOf('createSyncGroup'))
  })

  it('keeps the adopt window open for as long as the screen is shown', () => {
    // The native window and its nearby advertisement last two minutes; the screen sits far
    // longer. Measured on a Deck: once it lapsed, every offer was refused while the screen still
    // said "Waiting". Re-arm before expiry; the expiry message is only the fallback.
    const tick = transfer.slice(transfer.indexOf('const expiry = setInterval'), transfer.indexOf('}, 1000)'))
    expect(tick).toContain('remaining < REARM_BEFORE_MS')
    expect(tick).toContain('openAdoptWindow()')
    expect(tick).toContain("if (stage === 'waiting') window_ = next")
    expect(tick).toContain('if (remaining <= 0)')
    expect(transfer).toContain('const REARM_BEFORE_MS = 30_000')
  })

  it('shows the send-setup dialog and the pairing code from every sender state', () => {
    // The usual sender already has a room and renders the paired branch; the dialog its "Set up"
    // button opens (and the code it must show) used to live only inside the not-paired branch, so
    // pressing the button did nothing visible. Both now sit above the provider/state chain.
    const chain = syncPage.indexOf("{#if $syncProvider === 'cloudflare'}")
    expect(chain).toBeGreaterThan(0)
    expect(syncPage.indexOf('{#if offerTarget}')).toBeLessThan(chain)
    expect(syncPage.indexOf('{#if outgoing}')).toBeLessThan(chain)
    expect(syncPage.match(/\{#if offerTarget\}/g)).toHaveLength(1)
    expect(syncPage.match(/\{#if outgoing\}/g)).toHaveLength(1)
    // Both branches still offer the button that opens it.
    expect(syncPage.match(/askToSendSetup\(device\)/g)!.length).toBeGreaterThanOrEqual(2)
  })

  it('offers to a scanned device even when it is not (or no longer) in the nearby list', () => {
    // The nearby cache forgets a peer 90 s after its last announcement; the native side now
    // connects by identity when no address is cached, so the page must not bail on `!match`.
    const effect = syncPage.slice(syncPage.indexOf("page.url.searchParams.get('offer')"))
    const body = effect.slice(0, effect.indexOf('\n  }'))
    expect(body).not.toContain('if (!match) return')
    expect(body).toContain("mode: 'adopt' as const")
    expect(body).toContain('wanted.slice(0, 6).toUpperCase()')
    const rust = readFileSync(fileURLToPath(new URL('../../../../src-tauri/src/sync.rs', import.meta.url)), 'utf8')
    const offer = rust.slice(rust.indexOf('pub async fn sync_offer_nearby'))
    const command = offer.slice(0, offer.indexOf('#[tauri::command]'))
    expect(command).not.toContain('That device is no longer visible nearby')
    expect(command).toContain('None => EndpointAddr::from_parts(remote_id, Vec::<TransportAddr>::new())')
  })

  it('treats a scanned code as aiming, not as consent', () => {
    expect(syncPage).toContain("page.url.searchParams.get('offer')")
    const body = syncPage.slice(syncPage.indexOf("page.url.searchParams.get('offer')"))
    expect(body.slice(0, body.indexOf('\n  }'))).toContain('askToSendSetup(match)')
    expect(deepLink).toContain("path: `/app/settings/sync?offer=${endpoint}`")
  })
})
