import { describe, expect, it } from 'vitest'
import { parseThemeSettings, settingValue, themeSettingHooks } from './theme-settings'

const settings = [
  { key: 'compact', label: 'Compact rows', type: 'toggle', default: false },
  { key: 'logo', label: 'Logo', description: 'Where the title logo sits', type: 'choice', default: 'left', options: [{ value: 'left', label: 'Left' }, { value: 'center', label: 'Centre' }] },
  { key: 'accent', label: 'Accent', type: 'color', default: '#F47521' },
]

describe('theme settings (API 9)', () => {
  it('parses toggles, choices and colours', () => {
    expect(parseThemeSettings(settings)).toEqual([
      { key: 'compact', label: 'Compact rows', type: 'toggle', default: false },
      { key: 'logo', label: 'Logo', description: 'Where the title logo sits', type: 'choice', default: 'left', options: [{ value: 'left', label: 'Left' }, { value: 'center', label: 'Centre' }] },
      { key: 'accent', label: 'Accent', type: 'color', default: '#f47521' },
    ])
  })

  it('refuses what the client can’t show', () => {
    expect(() => parseThemeSettings({})).toThrow('list')
    expect(() => parseThemeSettings([{ ...settings[0], key: 'Compact' }])).toThrow('key')
    expect(() => parseThemeSettings([settings[0], settings[0]])).toThrow('twice')
    expect(() => parseThemeSettings([{ ...settings[0], default: 'yes' }])).toThrow('toggle')
    expect(() => parseThemeSettings([{ ...settings[1], default: 'right' }])).toThrow('one of its options')
    expect(() => parseThemeSettings([{ ...settings[1], options: [{ value: 'left', label: 'Left' }] }])).toThrow('2 to 8')
    expect(() => parseThemeSettings([{ ...settings[2], default: 'orange' }])).toThrow('#rrggbb')
    expect(() => parseThemeSettings([{ ...settings[0], type: 'range' }])).toThrow('type')
    expect(() => parseThemeSettings([{ ...settings[0], css: 'x' }])).toThrow('unknown field')
    expect(() => parseThemeSettings(Array.from({ length: 17 }, (_, i) => ({ ...settings[0], key: `k${i}` })))).toThrow('16')
  })

  it('falls back to the default for a missing or stale value', () => {
    const [compact, logo, accent] = parseThemeSettings(settings)
    expect(settingValue(compact, true)).toBe(true)
    expect(settingValue(compact, 'on')).toBe(false)
    expect(settingValue(logo, 'right')).toBe('left')
    expect(settingValue(accent, '#00FF00')).toBe('#00ff00')
    expect(settingValue(accent, 'red')).toBe('#f47521')
  })

  it('becomes attributes and custom properties on <html>', () => {
    expect(themeSettingHooks(parseThemeSettings(settings), { compact: true, logo: 'center' })).toEqual({
      attributes: { 'data-theme-setting-compact': 'on', 'data-theme-setting-logo': 'center' },
      properties: { '--theme-setting-accent': '#f47521' },
    })
    expect(themeSettingHooks(undefined, {})).toEqual({ attributes: {}, properties: {} })
  })
})

describe('the API 9 demo package', () => {
  it('installs, declares its three settings and reads each one in its stylesheet', async () => {
    const { readFileSync } = await import('node:fs')
    const { parseThemePackage } = await import('./packages')
    const pkg = parseThemePackage(JSON.parse(readFileSync('docs/theme-packages/theme-settings-demo.json', 'utf8')))
    expect(pkg.themeApi).toBe(9)
    expect(pkg.design.settings?.map((setting) => setting.key)).toEqual(['heading', 'corners', 'card-titles'])
    for (const hook of ['var(--theme-setting-heading)', 'data-theme-setting-corners', 'data-theme-setting-card-titles']) expect(pkg.design.css).toContain(hook)
    expect(() => parseThemePackage({ ...JSON.parse(readFileSync('docs/theme-packages/theme-settings-demo.json', 'utf8')), themeApi: 8 })).toThrow('unsupported')
  })
})
