import { describe, expect, it, vi } from 'vitest'
import {
  deviceTransferLink,
  isTransferWorking,
  parseDeviceTransferLink,
  runDeviceTransfer,
  transferProgress,
  TRANSFER_STAGES,
  type TransferSteps,
} from './device-transfer'

const steps = (overrides: Partial<TransferSteps> = {}): TransferSteps => ({
  link: vi.fn(async () => {}),
  applySetup: vi.fn(async () => true),
  applyHistory: vi.fn(async () => 12),
  applyAccounts: vi.fn(async () => false),
  ...overrides,
})

describe('device transfer stages', () => {
  it('reports every working stage in order and ends on done', async () => {
    const seen: string[] = []
    const outcome = await runDeviceTransfer('ticket', steps(), stage => seen.push(stage))
    expect(seen).toEqual(['linking', 'sources', 'history', 'accounts', 'done'])
    expect(outcome).toEqual({ stage: 'done', received: { setup: true, history: 12, accounts: false } })
  })

  it('keeps whatever already arrived when a later stage fails', async () => {
    const seen: string[] = []
    const outcome = await runDeviceTransfer(
      'ticket',
      steps({ applyHistory: vi.fn(async () => { throw new Error('room went away') }) }),
      stage => seen.push(stage),
    )
    // Sources landed before the failure. Rolling them back would leave a device that had nothing
    // with nothing, which is strictly worse than a partial setup plus the wizard.
    expect(outcome.stage).toBe('failed')
    expect(outcome.error).toBe('room went away')
    expect(outcome.received).toEqual({ setup: true, history: 0, accounts: false })
    expect(seen.at(-1)).toBe('failed')
  })

  it('never starts a later stage once one has thrown', async () => {
    const accounts = vi.fn(async () => true)
    await runDeviceTransfer(
      'ticket',
      steps({ applySetup: vi.fn(async () => { throw new Error('nope') }), applyAccounts: accounts }),
      () => {},
    )
    expect(accounts).not.toHaveBeenCalled()
  })

  it('animates only while the device is working, not while it waits on a person', () => {
    for (const stage of ['waiting', 'offered', 'done'] as const) expect(isTransferWorking(stage)).toBe(false)
    for (const stage of ['linking', 'sources', 'history', 'accounts'] as const) {
      expect(isTransferWorking(stage)).toBe(true)
    }
    expect(isTransferWorking('failed')).toBe(false)
  })

  it('holds the progress rail still until something is actually being transferred', () => {
    expect(transferProgress('waiting')).toBe(0)
    // An offer has arrived but nothing has moved yet; a bar that advances here would claim it had.
    expect(transferProgress('offered')).toBe(0)
    expect(transferProgress('failed')).toBe(0)
    expect(transferProgress('done')).toBe(1)
    const rising = TRANSFER_STAGES.slice(2).map(transferProgress)
    expect(rising).toEqual([...rising].sort((a, b) => a - b))
    expect(new Set(rising).size).toBe(rising.length)
  })
})

describe('device transfer link', () => {
  const endpoint = 'a'.repeat(64)

  it('round trips the endpoint id rather than the short code', () => {
    expect(parseDeviceTransferLink(deviceTransferLink(endpoint))).toBe(endpoint)
  })

  it('uppercases are accepted but normalized, so a scanner cannot produce a second identity', () => {
    expect(parseDeviceTransferLink(`izumi://device/pair?e=${'A'.repeat(64)}`)).toBe(endpoint)
  })

  it('refuses anything that is not an endpoint id', () => {
    for (const raw of [
      'https://izumi.watch/device/pair?e=' + endpoint,
      'izumi://device/pair',
      'izumi://device/pair?e=' + 'a'.repeat(63),
      'izumi://device/pair?e=' + 'a'.repeat(65),
      'izumi://device/pair?e=../../etc/passwd',
      'izumi://companion/pair?e=' + endpoint,
      'not a url',
    ]) {
      expect(parseDeviceTransferLink(raw), raw).toBeNull()
    }
  })
})
