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
})
