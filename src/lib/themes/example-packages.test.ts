import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { parseThemePackage } from './packages'
import { themeCoverage } from './presentation'

const dir = fileURLToPath(new URL('../../../docs/theme-packages', import.meta.url))
const files = readdirSync(dir).filter((name) => name.endsWith('.json')).sort()

describe('example theme packages', () => {
  it('ships at least one installable package', () => {
    expect(files.length).toBeGreaterThan(0)
  })
  it.each(files)('validates %s as Theme API 1', (name) => {
    const pkg = parseThemePackage(JSON.parse(readFileSync(new URL(`../../../docs/theme-packages/${name}`, import.meta.url), 'utf8')))
    expect(pkg.app).toBe('izumi')
    expect(pkg.themeApi).toBe(1)
    expect(pkg.id).toMatch(/^izumi\.[a-z0-9-]+$/)
    expect(themeCoverage(pkg.design.presentation).length).toBeGreaterThan(0)
  })
  it('recreates Kindling as a featured-banner home and split series page, not a hidden-hero grid', () => {
    const pkg = parseThemePackage(JSON.parse(readFileSync(new URL('../../../docs/theme-packages/izumi.kindling.json', import.meta.url), 'utf8')))
    const presentation = pkg.design.presentation
    expect(presentation?.hero?.hidden).not.toBe(true)
    expect(presentation?.hero?.template?.type).toBe('overlay')
    expect(presentation?.rows?.defaults?.layout).toBe('carousel')
    expect(presentation?.rows?.defaults?.gap).toBe(24)
    expect(presentation?.detail).toMatchObject({ layout: 'split', bannerHidden: false, posterWidth: 230, bannerHeight: 28, bannerScale: 'banner', actionsFirst: true, coverAlign: 'start', episodes: { placement: 'right', arrangement: 'list', hover: 'scale', order: 'flip', search: false } })
    expect(presentation?.shell).toMatchObject({ nav: 'sidebar', compact: false, press: 'sink' })
    expect(presentation?.hero?.height).toBe(40)
    expect(presentation?.hero?.scale).toBe('banner')
    expect(presentation?.detail?.cta).not.toBe('large')
    expect(presentation?.detail?.facts?.type).toBe('stack')
    expect(presentation?.detail?.episodes?.card?.type).toBe('row')
  })
  it('recreates Ledger as a continue-watching banner home and fluid series page', () => {
    const pkg = parseThemePackage(JSON.parse(readFileSync(new URL('../../../docs/theme-packages/izumi.ledger.json', import.meta.url), 'utf8')))
    const presentation = pkg.design.presentation
    expect(presentation?.hero?.hidden).not.toBe(true)
    expect(presentation?.hero?.template?.type).toBe('overlay')
    expect(presentation?.detail).toMatchObject({ layout: 'stack', bannerHidden: false, posterWidth: 230, bannerHeight: 42, cta: 'large', episodes: { placement: 'below', arrangement: 'list', hover: 'scale' } })
    expect(presentation?.shell).toMatchObject({ nav: 'sidebar', compact: true })
    expect(presentation?.detail?.episodes?.card?.type).toBe('row')
    expect(JSON.stringify(presentation?.hero?.template)).toContain('Resume')
    expect(JSON.stringify(presentation?.hero?.template)).toContain('Preview')
    expect(presentation?.hero?.rotate).toBe(true)
    expect(presentation?.hero?.interval).toBe(8)
    expect(presentation?.rows?.byId?.continue?.aspect).toBe('landscape')
  })
  it('recreates Tidal as a full-bleed living-room home and overlay series page', () => {
    const pkg = parseThemePackage(JSON.parse(readFileSync(new URL('../../../docs/theme-packages/izumi.tidal.json', import.meta.url), 'utf8')))
    const presentation = pkg.design.presentation
    expect(presentation?.hero?.hidden).not.toBe(true)
    expect(presentation?.hero?.height).toBeGreaterThanOrEqual(55)
    expect(presentation?.shell?.nav).toBe('top')
    expect(presentation?.detail?.layout).toBe('overlay')
    expect(presentation?.detail?.episodes?.placement).toBe('below')
    expect(presentation?.detail?.episodes?.arrangement).toBe('carousel')
    expect(presentation?.detail?.episodes?.card?.type).toBe('stack')
    expect(presentation?.detail?.episodes?.hover).toBe('scale')
    expect(JSON.stringify(presentation?.detail?.episodes?.card)).toContain('episodeTitle')
    expect(JSON.stringify(presentation?.detail?.episodes?.card)).toContain('description')
    expect(JSON.stringify(presentation?.hero?.template)).toContain('More Info')
    expect(presentation?.detail?.episodes?.search).toBe(false)
  })
  it('recreates Halo as frosted top chrome with overlay series stills', () => {
    const pkg = parseThemePackage(JSON.parse(readFileSync(new URL('../../../docs/theme-packages/izumi.halo.json', import.meta.url), 'utf8')))
    const presentation = pkg.design.presentation
    expect(presentation?.shell?.nav).toBe('top')
    expect(presentation?.detail?.layout).toBe('overlay')
    expect(presentation?.detail?.episodes?.arrangement).toBe('grid')
    expect(presentation?.detail?.episodes?.card?.type).toBe('stack')
    expect(presentation?.hero?.template?.type).toBe('overlay')
  })
  it('recreates Ember as a warm overlay series page with a featured banner', () => {
    const pkg = parseThemePackage(JSON.parse(readFileSync(new URL('../../../docs/theme-packages/izumi.ember.json', import.meta.url), 'utf8')))
    const presentation = pkg.design.presentation
    expect(presentation?.shell?.nav).toBe('sidebar')
    expect(presentation?.detail?.layout).toBe('overlay')
    expect(presentation?.detail?.episodes?.arrangement).toBe('grid')
    expect(presentation?.hero?.template?.type).toBe('overlay')
    expect(presentation?.cards?.poster?.type).toBe('stack')
  })
  it('recreates Orchid as a mesh split series page with overlay posters', () => {
    const pkg = parseThemePackage(JSON.parse(readFileSync(new URL('../../../docs/theme-packages/izumi.orchid.json', import.meta.url), 'utf8')))
    const presentation = pkg.design.presentation
    expect(presentation?.detail?.layout).toBe('split')
    expect(presentation?.detail?.episodes?.arrangement).toBe('list')
    expect(presentation?.hero?.template?.type).toBe('overlay')
    expect(presentation?.cards?.poster?.type).toBe('overlay')
  })
})
