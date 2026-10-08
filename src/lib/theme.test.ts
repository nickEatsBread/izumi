import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { resolvedThemeTokens } from './theme'
import tailwindConfig from '../../tailwind.config'

describe('theme presets', () => {
  it('binds accent utilities to the editable theme token', () => {
    expect(tailwindConfig.theme.extend.colors.theme).toContain('var(--theme,')
    expect(tailwindConfig.theme.extend.colors.theme).toContain('<alpha-value>')
  })
  const rgb = (hsl: string): [number, number, number] => {
    const [h, s0, l0] = hsl.match(/[\d.]+/g)!.map(Number)
    const s = s0 / 100, l = l0 / 100
    const c = (1 - Math.abs(2 * l - 1)) * s, x = c * (1 - Math.abs((h / 60) % 2 - 1)), m = l - c / 2
    const base: [number, number, number] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x]
    return base.map((value) => value + m) as [number, number, number]
  }
  const luminance = (hsl: string) => rgb(hsl).map((value) => value <= .03928 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4)
    .reduce((sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index], 0)
  const contrast = (a: string, b: string) => {
    const [lighter, darker] = [luminance(a), luminance(b)].sort((x, y) => y - x)
    return (lighter + .05) / (darker + .05)
  }
  it('resolves system to a light or dark palette', () => {
    expect(resolvedThemeTokens('system', false).scheme).toBe('light')
    expect(resolvedThemeTokens('system', true).scheme).toBe('dark')
  })

  it('uses validated custom tokens without changing preset fallback behavior', () => {
    const custom = { ...resolvedThemeTokens('izumi'), theme: '120 80% 40%' }
    expect(resolvedThemeTokens('custom', true, custom)).toBe(custom)
    expect(resolvedThemeTokens('custom').scheme).toBe('dark')
  })

  it('keeps every named dark preset dark', () => {
    for (const preset of ['izumi', 'midnight', 'sakura', 'ocean'] as const)
      expect(resolvedThemeTokens(preset).scheme).toBe('dark')
  })

  it('meets WCAG AA for normal and muted text in every palette', () => {
    for (const preset of ['izumi', 'midnight', 'sakura', 'ocean', 'light'] as const) {
      const theme = resolvedThemeTokens(preset)
      expect(contrast(theme.foreground, theme.background), `${preset} foreground`).toBeGreaterThanOrEqual(4.5)
      expect(contrast(theme.mutedForeground, theme.background), `${preset} muted`).toBeGreaterThanOrEqual(4.5)
    }
  })

  // The Deck/controller focus ring (app.css --izumi-safe-focus-ring) is the plain 3px white ring the
  // owner chose back on 2026-10-08. It must reach 3:1 against the card and the page (WCAG 1.4.11
  // non-text contrast) in every dark palette; the light preset never had a visible Deck ring.
  it('keeps the white focus ring at 3:1 against the card and the page in every dark palette', () => {
    const css = readFileSync(fileURLToPath(new URL('../app.css', import.meta.url)), 'utf8').replace(/\r\n/g, '\n')
    expect(css).toContain('--izumi-safe-focus-ring: 0 0 0 3px #fff;')
    for (const preset of ['izumi', 'midnight', 'sakura', 'ocean'] as const) {
      const theme = resolvedThemeTokens(preset)
      for (const [name, surface] of [['card', theme.card], ['page', theme.background]] as const) {
        expect(contrast('0 0% 100%', surface), `${preset} white ring on ${name}`).toBeGreaterThanOrEqual(3)
      }
    }
  })
})
