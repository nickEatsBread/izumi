import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const source = readFileSync(fileURLToPath(new URL('./CatalogBrandLogo.svelte', import.meta.url)), 'utf8')

describe('catalog-themed Izumi mark', () => {
  it('keeps Automatic and AniList on the normal Izumi gradient', () => {
    expect(source).toContain("auto: ['#5CEAD8', '#1FA6F0', '#4E63F5']")
    expect(source).toContain("anilist: ['#5CEAD8', '#1FA6F0', '#4E63F5']")
  })

  it('maps every other provider to a distinct three-stop brand palette', () => {
    for (const provider of ['kitsu', 'tmdb', 'stremio', 'jvm']) {
      expect(source).toContain(`${provider}: [`)
    }
    expect(source).toContain("tmdb: ['#90CEA1', '#3CBEC9', '#00B3E5']")
  })

  it('uses the original Izumi silhouette as a mask', () => {
    expect(source).toContain("mask: url('/brand/izumi-mark-color.svg')")
    expect(source).toContain('linear-gradient(135deg')
  })
})
