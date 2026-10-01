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

  // The Deck/controller focus ring (app.css --izumi-safe-focus-ring) is a page-coloured gap, a band
  // in --ring, and a hairline of the foreground at partial alpha, so a theme whose ring colour sits
  // close to its background still shows focus. The alpha is read from the stylesheet; the composite
  // must reach 3:1 against the card and the page (WCAG 1.4.11 non-text contrast) in every palette.
  it('keeps the focus-ring hairline and band at 3:1 against the card and the page in every palette', () => {
    const css = readFileSync(fileURLToPath(new URL('../app.css', import.meta.url)), 'utf8').replace(/\r\n/g, '\n')
    const alpha = Number(/--izumi-safe-focus-ring:[^;]*\/\s*([\d.]+)\)\s*;/.exec(css)?.[1])
    expect(alpha, 'hairline alpha in --izumi-safe-focus-ring').toBeGreaterThan(0)
    expect(alpha).toBeLessThanOrEqual(1)
    const linear = (channels: readonly number[]) => channels.map((value) => value <= .03928 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4)
      .reduce((sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index], 0)
    const ratio = (a: readonly number[], b: readonly number[]) => {
      const [lighter, darker] = [linear(a), linear(b)].sort((x, y) => y - x)
      return (lighter + .05) / (darker + .05)
    }
    const over = (top: readonly number[], bottom: readonly number[]) => top.map((value, index) => value * alpha + bottom[index] * (1 - alpha))
    for (const preset of ['izumi', 'midnight', 'sakura', 'ocean', 'light'] as const) {
      const theme = resolvedThemeTokens(preset)
      expect(contrast(theme.foreground, theme.card), `${preset} foreground on card`).toBeGreaterThanOrEqual(3)
      for (const [name, surface] of [['card', theme.card], ['page', theme.background]] as const) {
        expect(ratio(over(rgb(theme.foreground), rgb(surface)), rgb(surface)), `${preset} hairline on ${name}`).toBeGreaterThanOrEqual(3)
        expect(contrast(theme.ring, surface), `${preset} ring band on ${name}`).toBeGreaterThanOrEqual(3)
      }
    }
  })
})
