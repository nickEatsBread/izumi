import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { parseThemePackage } from './packages'

const demo = JSON.parse(readFileSync(fileURLToPath(new URL('../../../docs/theme-packages/navigator-api8-demo.json', import.meta.url)), 'utf8'))

describe('Theme API 8 demo package (docs/theme-packages)', () => {
  it('installs on this client and uses every API 8 key', () => {
    const pkg = parseThemePackage(demo)
    const presentation = pkg.design.presentation
    expect(pkg.themeApi).toBe(8)
    expect(presentation?.loading?.title?.template).toBeTruthy()
    expect(presentation?.loading?.episode?.template).toBeTruthy()
    expect(presentation?.schedule?.item).toBeTruthy()
    expect(presentation?.layout?.screens?.map((screen) => screen.id)).toEqual(['picks', 'films'])
  })
  it('is refused as a whole by a client that only knows API 7', () => {
    expect(() => parseThemePackage({ ...demo, themeApi: 7 })).toThrow()
  })
})
