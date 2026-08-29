import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const source = readFileSync(fileURLToPath(new URL('./+page.svelte', import.meta.url)), 'utf8')

describe('catalog settings', () => {
  it('treats Merged as a Home destination instead of a global experience mode', () => {
    expect(source).toContain("label: id === 'merged' ? 'Merged'")
    expect(source).toContain("selectCatalogScreen('merged')")
    expect(source).not.toContain('onChange={setCatalogMode}')
    expect(source).not.toContain('settingKey="catalog-mode"')
  })

  it('puts provider connections before catalog behaviour controls', () => {
    expect(source.indexOf('<CatalogPlatformRow')).toBeLessThan(source.indexOf('settingKey="default-catalog-platform"'))
    expect(source).toContain('title="Browsing" desc="Choose how Home opens and where its catalog picker appears."')
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
    expect(source).toContain('const fallback = resolveCatalogStartup(nextDefault')
    expect(source).toContain('if (!nextScreens.includes($catalogScreen)) selectCatalogProvider(fallback)')
  })

  it('offers a mobile-friendly default platform selector from enabled choices', () => {
    expect(source).toContain('title="Default Home"')
    expect(source).toContain('options={defaultOptions}')
    expect(source).toContain('onChange={setDefaultPlatform}')
    expect(source).toContain('controlLayout="stack"')
    expect(source).toContain("{ value: 'adaptive', label: 'Adaptive · last selected' }")
    expect(source).toContain("if (value === 'adaptive')")
    expect(source).toContain("if (value === 'merged'")
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

  it('opens an in-client guide for obtaining the TMDB read access token', () => {
    expect(source).toContain('How to get a free token')
    expect(source).toContain('showTmdbGuide = true')
    expect(source).toContain('<TmdbCredentialGuide')
  })

  it('can switch from TMDB to a keyless IMDb-ID catalog', () => {
    expect(source).toContain('function useKeylessCatalog()')
    expect(source).toContain('replaceAddonBase($addonUrls, undefined, CINEMETA_BASE)')
    expect(source).toContain("provider !== 'tmdb' && provider !== 'stremio'")
    expect(source).toContain("selectCatalogProvider('stremio')")
    expect(source).toContain('onUseKeyless={useKeylessCatalog}')
  })

  it('offers optional critic-rating enrichment without making it part of catalog identity', () => {
    expect(source).toContain('Optional review ratings')
    expect(source).toContain('Rotten Tomatoes, Metacritic, IMDb vote counts')
    expect(source).toContain('https://www.omdbapi.com/apikey.aspx')
    expect(source).toContain('bind:value={$omdbApiKey}')
  })

  it('filters JVM catalog providers independently with their source artwork', () => {
    expect(source).toContain('installedJvmCatalogSources')
    expect(source).toContain('JvmCatalogSourceRow')
    expect(source).toContain('isJvmCatalogSourceEnabled(source.id, $jvmCatalogSourceOverrides)')
    expect(source).toContain('onToggle={() => toggleJvmSource(source.id)}')
    expect(source).toContain('onSettings={() => (configuringJvmSource = source)}')
    expect(source).toContain('<JvmSourcePreferences')
  })
})
