import { describe, expect, it } from 'vitest'
import { normalizeCompanionPairingCode } from './client'

describe('TV Companion pairing code', () => {
  it('normalizes the formatted six-character code', () => {
    expect(normalizeCompanionPairingCode('a82 b04')).toBe('A82B04')
    expect(normalizeCompanionPairingCode(' A8-2_B04 ')).toBe('A82B04')
  })

  it('rejects incomplete or non-hex codes', () => {
    expect(normalizeCompanionPairingCode('A82')).toBeNull()
    expect(normalizeCompanionPairingCode('TVPAIR')).toBeNull()
  })
})
