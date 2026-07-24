import { describe, expect, it } from 'vitest'
import { isEffectiveDebridMode, shouldWarnBeforeHosting } from './debrid-warning'

describe('debrid room warning gate', () => {
  it('treats debrid mode with a key as the effective mode', () => {
    expect(isEffectiveDebridMode('debrid', 'RD-TOKEN')).toBe(true)
  })

  it.each([
    { mode: 'debrid' as const, key: '', why: 'no key — play.ts falls back to the P2P engine' },
    { mode: 'debrid' as const, key: '   ', why: 'whitespace-only key' },
    { mode: 'direct' as const, key: 'RD-TOKEN', why: 'direct mode chosen despite a saved key' },
  ])('is not effective debrid: $why', ({ mode, key }) => {
    expect(isEffectiveDebridMode(mode, key)).toBe(false)
  })

  it('warns a debrid host who has not dismissed the notice', () => {
    expect(shouldWarnBeforeHosting('debrid', 'RD-TOKEN', false)).toBe(true)
  })

  it('stays quiet once the host ticked "Don\'t show this again"', () => {
    expect(shouldWarnBeforeHosting('debrid', 'RD-TOKEN', true)).toBe(false)
  })

  it.each([
    { mode: 'direct' as const, key: 'RD-TOKEN', acked: false },
    { mode: 'debrid' as const, key: '', acked: false },
  ])('never warns when debrid is not the effective mode (%o)', ({ mode, key, acked }) => {
    expect(shouldWarnBeforeHosting(mode, key, acked)).toBe(false)
  })
})
