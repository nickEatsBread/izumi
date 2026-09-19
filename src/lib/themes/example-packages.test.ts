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
    expect(presentation?.detail).toMatchObject({ layout: 'split', bannerHidden: false, posterWidth: 230, episodes: { placement: 'right', arrangement: 'list', hover: 'scale' } })
    expect(presentation?.detail?.facts?.type).toBe('stack')
    expect(presentation?.detail?.episodes?.card?.type).toBe('row')
    expect(presentation?.shell).toMatchObject({ nav: 'sidebar', compact: true })
  })
  it('recreates Ledger as a continue-watching banner home and fluid series page', () => {
    const pkg = parseThemePackage(JSON.parse(readFileSync(new URL('../../../docs/theme-packages/izumi.ledger.json', import.meta.url), 'utf8')))
    const presentation = pkg.design.presentation
    expect(presentation?.hero?.hidden).not.toBe(true)
    expect(presentation?.hero?.template?.type).toBe('overlay')
    expect(presentation?.detail).toMatchObject({ layout: 'stack', bannerHidden: false, posterWidth: 230, episodes: { placement: 'below' } })
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
  })
})
