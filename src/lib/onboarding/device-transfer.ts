/**
 * The stages a new device moves through while an existing one hands over its setup.
 *
 * Kept separate from the screen that draws them because the ordering, the "is something actually
 * happening" flag and the failure handling are the parts worth testing, and none of them need a
 * DOM. The screen only maps a stage to a label and an icon.
 */

export const TRANSFER_STAGES = [
  'waiting',
  'offered',
  'linking',
  'sources',
  'history',
  'accounts',
  'done',
] as const

export type TransferStage = (typeof TRANSFER_STAGES)[number] | 'failed'

/** Stages where the device is doing work rather than waiting on a person. Drives the animation:
 *  a pulsing signal reads as progress, and showing it while we are idle is a lie. */
const WORKING: ReadonlySet<TransferStage> = new Set<TransferStage>([
  'linking', 'sources', 'history', 'accounts',
])

export function isTransferWorking(stage: TransferStage): boolean {
  return WORKING.has(stage)
}

/** 0 to 1, for the progress rail. `offered` deliberately does not advance the bar: nothing has
 *  been transferred yet, and a bar that moves while waiting for a tap implies otherwise. */
export function transferProgress(stage: TransferStage): number {
  if (stage === 'failed') return 0
  const index = TRANSFER_STAGES.indexOf(stage as (typeof TRANSFER_STAGES)[number])
  if (index <= 1) return 0
  return (index - 1) / (TRANSFER_STAGES.length - 2)
}

export interface TransferSteps {
  /** Join the offered room. Resolves once this device is attached to it. */
  link(ticket: string): Promise<void>
  /** Everything the sender's device snapshot carries: sources, extensions, the debrid key and
   *  the synced preferences. One stage because it is one record — splitting the label would
   *  claim two transfers where there is one. Resolves false when the sender published nothing. */
  applySetup(): Promise<boolean>
  /** Watch history, positions and local lists. Resolves with how many records arrived. */
  applyHistory(): Promise<number>
  /** Signed-in trackers, when the sender chose to include them. */
  applyAccounts(): Promise<boolean>
}

export interface TransferOutcome {
  stage: TransferStage
  error?: string
  /** What actually arrived, so the final screen can be honest rather than claiming everything. */
  received: { setup: boolean; history: number; accounts: boolean }
}

/**
 * Run the transfer, reporting each stage as it starts.
 *
 * A failure part-way through is reported but not rolled back: half a setup is still better than
 * none on a device that had nothing, and the wizard stays available for whatever did not arrive.
 */
export async function runDeviceTransfer(
  ticket: string,
  steps: TransferSteps,
  report: (stage: TransferStage) => void,
): Promise<TransferOutcome> {
  const received = { setup: false, history: 0, accounts: false }
  try {
    report('linking')
    await steps.link(ticket)
    report('sources')
    received.setup = await steps.applySetup()
    report('history')
    received.history = await steps.applyHistory()
    report('accounts')
    received.accounts = await steps.applyAccounts()
    report('done')
    return { stage: 'done', received }
  } catch (cause) {
    report('failed')
    return {
      stage: 'failed',
      error: cause instanceof Error ? cause.message : String(cause),
      received,
    }
  }
}

/** The QR the new device shows. Encodes the endpoint id rather than the short code: the short
 *  code only means anything to a device already seeing this one advertise on the same network,
 *  while the endpoint id is routable through the relay from anywhere. */
export function deviceTransferLink(endpointId: string): string {
  return `izumi://device/pair?e=${encodeURIComponent(endpointId)}`
}

/** Parse the other end of {@link deviceTransferLink}. Endpoint ids are 64 hex characters; being
 *  strict here keeps a scanned URL from steering the app at arbitrary text. */
export function parseDeviceTransferLink(raw: string): string | null {
  try {
    const url = new URL(raw)
    if (url.protocol !== 'izumi:') return null
    const parts = [url.hostname, ...url.pathname.split('/').filter(Boolean)]
    if (parts[0] !== 'device' || parts[1] !== 'pair') return null
    const endpoint = url.searchParams.get('e')?.trim() ?? ''
    return /^[0-9a-f]{64}$/i.test(endpoint) ? endpoint.toLowerCase() : null
  } catch {
    return null
  }
}
