import { describe, expect, it } from 'vitest'
import { generateRoomCode } from './client'

describe('Watch Together room codes', () => {
  it('generates the six characters required by the join screen', () => {
    const code = generateRoomCode(new Uint8Array([0, 1, 2, 3, 4, 5]))
    expect(code).toBe('ABCDEF')
    expect(code).toMatch(/^[A-HJ-NP-Z2-9]{6}$/)
  })

  it('rejects an undersized random input', () => {
    expect(() => generateRoomCode(new Uint8Array(3))).toThrow('Six random bytes')
  })
})
