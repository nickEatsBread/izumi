import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { ambientFromHex, ambientFromPixels, sampleAmbient } from './ambient'

describe('artwork ambient colour', () => {
  it('weights saturated pixels above greys', () => {
    // Two pixels: mid grey and saturated red, both opaque.
    const [r, g, b] = ambientFromPixels([128, 128, 128, 255, 230, 20, 20, 255])!.split(' ').map(Number)
    expect(r).toBeGreaterThan(g + 40)
    expect(g).toBe(b)
  })
  it('ignores transparent pixels and empty input', () => {
    expect(ambientFromPixels([255, 0, 0, 0])).toBeUndefined()
    expect(ambientFromPixels([])).toBeUndefined()
  })
  it('reads a catalog cover colour as r g b', () => {
    expect(ambientFromHex('#e4a15d')).toBe('228 161 93')
    expect(ambientFromHex('#0B0B0F')).toBe('11 11 15')
    for (const bad of [undefined, null, '', '#fff', 'e4a15d0', 'red', '#e4a15g']) expect(ambientFromHex(bad)).toBeUndefined()
  })
  it('uses the colour hint without reading the image, since the catalog CDN blocks canvas reads', async () => {
    // No document here: the pixel path would resolve undefined, so a value proves the hint won.
    await expect(sampleAmbient('https://example.test/banner.jpg', '#43a1e4')).resolves.toBe('67 161 228')
    await expect(sampleAmbient('https://example.test/banner.jpg', undefined)).resolves.toBeUndefined()
  })
  it('passes the hero cover colour as the hint', () => {
    const hero = readFileSync(fileURLToPath(new URL('../components/banner/Hero.svelte', import.meta.url)), 'utf8')
    expect(hero).toContain('sampleAmbient(src, current.coverImage?.color)')
  })
})
