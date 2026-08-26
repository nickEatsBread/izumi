import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const source = readFileSync(fileURLToPath(new URL('./+page.svelte', import.meta.url)), 'utf8')

describe('catalog settings', () => {
  it('offers every platform as an independently enabled row', () => {
    for (const id of ['auto', 'anilist', 'kitsu', 'tmdb', 'stremio']) expect(source).toContain(`id: '${id}'`)
    expect(source).toContain('CatalogPlatformRow')
    expect(source).toContain('platform={platform.id}')
    expect(source).toContain('onToggle={() => togglePlatform(platform.id)}')
  })

  it('keeps at least one platform enabled and repairs the default and active platforms', () => {
    expect(source).toContain('if (turningOff && current.length === 1) return')
    expect(source).toContain('const nextDefault = next.includes($catalogDefaultProvider)')
    expect(source).toContain('if (!next.includes($catalogProvider)) $catalogProvider = nextDefault')
  })

  it('offers a mobile-friendly default platform selector from enabled choices', () => {
    expect(source).toContain('title="Default platform"')
    expect(source).toContain('options={defaultOptions}')
    expect(source).toContain('onChange={setDefaultPlatform}')
    expect(source).toContain('controlLayout="stack"')
  })

  it('shows provider-specific configuration whenever that provider is enabled', () => {
    expect(source).toContain("{#if hasPlatform('tmdb')}")
    expect(source).toContain("{#if hasPlatform('stremio')}")
  })
})
