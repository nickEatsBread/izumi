import { describe, expect, it } from 'vitest'
import { resolvedThemeTokens } from './theme'

describe('theme presets', () => {
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
})
