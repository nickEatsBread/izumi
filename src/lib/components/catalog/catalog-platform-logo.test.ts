import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const source = readFileSync(fileURLToPath(new URL('./CatalogPlatformLogo.svelte', import.meta.url)), 'utf8')

describe('catalog platform logos', () => {
  it('uses the official provider assets', () => {
    expect(source).toContain('https://anilist.co/img/icons/icon.svg')
    expect(source).toContain('https://avatars.githubusercontent.com/u/7648832')
    expect(source).toContain('/brand/tmdb.svg')
    expect(source).toContain('https://www.stremio.com/website/favicon.ico')
    expect(source).toContain("platform === 'jvm'")
    expect(source).toContain('<Coffee')
  })

  it('distinguishes automatic fallback mode from direct AniList', () => {
    expect(source).toContain("platform === 'auto'")
    expect(source).toContain('<RefreshCw')
  })

  it('keeps every logo on the same square mobile-safe canvas', () => {
    expect(source.match(/size-10 shrink-0/g)).toHaveLength(6)
  })

  it('fits the TMDB lockup inside the shared square canvas', () => {
    expect(source).toContain('class="w-9 object-contain"')
  })

  it('only reveals text fallbacks after image errors', () => {
    expect(source).toContain('let imageFailed = $state(false)')
    expect(source.match(/onerror=\{showFallback\}/g)).toHaveLength(5)
    expect(source.match(/\{#if imageFailed\}/g)).toHaveLength(5)
  })

  it('adds breathing room around the Stremio artwork', () => {
    expect(source).toContain('class="size-8 rounded-lg object-cover"')
  })
})
