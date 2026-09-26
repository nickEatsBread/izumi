import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { BUNDLED_FONT_IDS, THEME_FONTS, fontStack, parseThemeFonts } from './font-ids'

describe('theme fonts', () => {
  it('parses known ids per role and rejects unknown roles or fonts', () => {
    expect(parseThemeFonts({ ui: 'poppins', heading: 'poppins', display: 'cinzel' })).toEqual({ ui: 'poppins', heading: 'poppins', display: 'cinzel' })
    expect(() => parseThemeFonts({ ui: 'comic-sans' })).toThrow('font')
    expect(() => parseThemeFonts({ body: 'inter' })).toThrow('font')
    expect(() => parseThemeFonts({ ui: 'constructor' })).toThrow('font')
    expect(() => parseThemeFonts('inter')).toThrow()
  })
  it('builds stacks with the bundled family first and a generic fallback', () => {
    expect(fontStack('poppins')).toBe("'izumi Poppins', sans-serif")
    expect(fontStack('cinzel')).toBe("'izumi Cinzel', Georgia, serif")
    expect(fontStack('system')).toBe("system-ui, -apple-system, 'Segoe UI', sans-serif")
    expect(fontStack('nunito')).toBe("'Nunito Variable', sans-serif")
    expect(fontStack('sansita')).toBe("'izumi Sansita', sans-serif")
    expect(fontStack(undefined)).toBeUndefined()
  })
  it('has a loader entry for every bundled font', () => {
    const loader = readFileSync(fileURLToPath(new URL('./fonts.ts', import.meta.url)), 'utf8')
    for (const id of BUNDLED_FONT_IDS) expect(loader, id).toContain(`'${id}': `)
    expect(Object.keys(THEME_FONTS).length).toBe(BUNDLED_FONT_IDS.length + 4)
  })
  it('loads Sansita as static weights 400 and 700, latin and latin-ext', () => {
    const loader = readFileSync(fileURLToPath(new URL('./fonts.ts', import.meta.url)), 'utf8')
    const start = loader.indexOf("'sansita': [")
    expect(start, 'sansita entry in fonts.ts').toBeGreaterThan(-1)
    const block = loader.slice(start, loader.indexOf('],', start))
    expect(block).toContain("weight: '400'")
    expect(block).toContain("weight: '700'")
    expect(block).toContain('sansita-latin-400-normal.woff2')
    expect(block).toContain('sansita-latin-ext-400-normal.woff2')
    expect(block).toContain('sansita-latin-700-normal.woff2')
    expect(block).toContain('sansita-latin-ext-700-normal.woff2')
  })
})
