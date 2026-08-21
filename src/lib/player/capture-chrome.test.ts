import { describe, expect, it } from 'vitest'
import { PLAYER_CAPTURE_CLASS, withPlayerChromeHidden } from './capture-chrome'

function fakeRoot() {
  const tokens = new Set<string>()
  return {
    classList: {
      add(token: string) { tokens.add(token) },
      remove(token: string) { tokens.delete(token) },
      contains(token: string) { return tokens.has(token) },
    },
  }
}

describe('withPlayerChromeHidden', () => {
  it('adds the capture class only while the compositor shot runs', async () => {
    const root = fakeRoot()
    let during = false
    await withPlayerChromeHidden(async () => {
      during = root.classList.contains(PLAYER_CAPTURE_CLASS)
    }, root)
    expect(during).toBe(true)
    expect(root.classList.contains(PLAYER_CAPTURE_CLASS)).toBe(false)
  })

  it('restores chrome if capture throws', async () => {
    const root = fakeRoot()
    await expect(withPlayerChromeHidden(async () => {
      throw new Error('cdp failed')
    }, root)).rejects.toThrow('cdp failed')
    expect(root.classList.contains(PLAYER_CAPTURE_CLASS)).toBe(false)
  })
})
