import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const source = readFileSync(fileURLToPath(new URL('./+page.svelte', import.meta.url)), 'utf8')

describe('catalog settings', () => {
  it('offers separate and merged catalog experiences', () => {
    expect(source).toContain("{ value: 'separate', label: 'Separate catalogs' }")
    expect(source).toContain("{ value: 'merged', label: 'Merged Home and Search' }")
    expect(source).toContain('value={$catalogMode}')
    expect(source).toContain('onChange={setCatalogMode}')
    expect(source).toContain("$catalogMode === 'merged'")
  })

  it('offers every platform as an independently enabled row', () => {
    for (const id of ['auto', 'anilist', 'kitsu', 'tmdb', 'stremio', 'jvm']) expect(source).toContain(`id: '${id}'`)
    expect(source).toContain('CatalogPlatformRow')
    expect(source).toContain('platform={platform.id}')
    expect(source).toContain('onToggle={() => togglePlatform(platform.id)}')
  })

  it('keeps at least one platform enabled and repairs the default and active platforms', () => {
    expect(source).toContain('if (turningOff && current.length === 1) return')
    expect(source).toContain("$catalogDefaultProvider === 'adaptive'")
    expect(source).toContain('selectCatalogProvider(resolveCatalogStartup(nextDefault')
  })

  it('offers a mobile-friendly default platform selector from enabled choices', () => {
    expect(source).toContain('title="Default platform"')
    expect(source).toContain('options={defaultOptions}')
    expect(source).toContain('onChange={setDefaultPlatform}')
    expect(source).toContain('controlLayout="stack"')
    expect(source).toContain("{ value: 'adaptive', label: 'Adaptive · last selected' }")
    expect(source).toContain("if (value === 'adaptive')")
  })

  it('lets Continue Watching stay provider-specific or combine every platform', () => {
    expect(source).toContain('title="Continue Watching"')
    expect(source).toContain("{ value: 'provider', label: 'Current platform only' }")
    expect(source).toContain("{ value: 'all', label: 'All platforms' }")
    expect(source).toContain('value={$continueWatchingCatalogScope}')
    expect(source).toContain('onChange={setContinueWatchingScope}')
  })

  it('shows provider-specific configuration whenever that provider is enabled', () => {
    expect(source).toContain("{#if hasPlatform('tmdb')}")
    expect(source).toContain("{#if hasPlatform('stremio')}")
    expect(source).toContain("{#if hasPlatform('jvm')}")
  })

  it('filters JVM catalog providers independently with their source artwork', () => {
    expect(source).toContain('installedJvmCatalogSources')
    expect(source).toContain('JvmCatalogSourceRow')
    expect(source).toContain('isJvmCatalogSourceEnabled(source.id, $jvmCatalogSourceOverrides)')
    expect(source).toContain('onToggle={() => toggleJvmSource(source.id)}')
  })
})
