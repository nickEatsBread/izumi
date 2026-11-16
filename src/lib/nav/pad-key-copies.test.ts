import { describe, expect, it } from 'vitest'
import { PAD_KEY_COPY_MS, isPadKeyCopy } from './pad-key-copies'

describe("Steam's keyboard copies of controller buttons", () => {
  const steam = { isTrusted: true, key: 'ArrowDown' }
  it('drops a trusted d-pad key in Game mode while a button is held or just after', () => {
    expect(isPadKeyCopy(steam, { gameMode: true, held: 1, sincePadMs: 5 })).toBe(true)
    expect(isPadKeyCopy(steam, { gameMode: true, held: 0, sincePadMs: 110 })).toBe(true)
    expect(isPadKeyCopy({ isTrusted: true, key: 'Escape' }, { gameMode: true, held: 0, sincePadMs: 40 })).toBe(true)
  })
  it("keeps izumi's own keys, a keyboard used on its own, and other modes", () => {
    expect(isPadKeyCopy({ isTrusted: false, key: 'ArrowDown' }, { gameMode: true, held: 1, sincePadMs: 0 })).toBe(false)
    expect(isPadKeyCopy(steam, { gameMode: true, held: 0, sincePadMs: PAD_KEY_COPY_MS + 1 })).toBe(false)
    expect(isPadKeyCopy({ isTrusted: true, key: 'a' }, { gameMode: true, held: 1, sincePadMs: 0 })).toBe(false)
    expect(isPadKeyCopy(steam, { gameMode: false, held: 1, sincePadMs: 0 })).toBe(false)
  })
})
