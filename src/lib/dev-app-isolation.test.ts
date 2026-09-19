import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const read = (relative: string) => readFileSync(new URL(`../../${relative}`, import.meta.url), 'utf8')

const tauriConf = JSON.parse(read('src-tauri/tauri.conf.json'))
const devConf = JSON.parse(read('src-tauri/tauri.dev.conf.json'))
const packageJson = JSON.parse(read('package.json'))
const resetScript = read('scripts/reset-dev-data.mjs')
const desktopWebview = read('src-tauri/src/desktop_webview.rs')
const contributing = read('CONTRIBUTING.md')
const readme = read('README.md')

describe('desktop dev builds do not share the installed release identity', () => {
  it('gives the overlay its own identifier, product name, scheme and vite port', () => {
    expect(devConf.identifier).toBe('com.nicho.izumi.dev')
    expect(devConf.identifier).not.toBe(tauriConf.identifier)
    expect(devConf.identifier.endsWith('.dev')).toBe(true)
    expect(devConf.productName).toBe('izumi-dev')
    expect(devConf.productName).not.toBe(tauriConf.productName)
    expect(devConf.plugins['deep-link'].desktop.schemes).toEqual(['izumi-dev'])
    expect(devConf.build.devUrl).toMatch(/:1430$/)
    expect(tauriConf.build.devUrl).not.toMatch(/:1430$/)
  })

  it('routes npm run tauri dev through the overlay so README and CONTRIBUTING stay safe', () => {
    expect(packageJson.scripts.tauri).toMatch(/scripts\/tauri\.mjs/)
    expect(packageJson.scripts['dev:app']).toMatch(/scripts\/tauri\.mjs/)
    const wrapper = read('scripts/tauri.mjs')
    expect(wrapper).toContain('tauri.dev.conf.json')
    expect(wrapper).toContain("'dev'")
    expect(wrapper).toContain("!args.includes('android')")
    expect(wrapper).toContain("!args.includes('ios')")
    expect(contributing).toContain('npm run dev:app')
    expect(readme).toContain('npm run dev:app')
  })

  it('keeps a stable macOS WKWebView store id for the overlay identifier', () => {
    expect(desktopWebview).toContain('DEV_WKWEBVIEW_STORE')
    expect(desktopWebview).toContain('5C8A1D72-9E44-4F0B-B36A-2CD187F04E19')
    expect(resetScript).toContain('5C8A1D72-9E44-4F0B-B36A-2CD187F04E19')
    expect(resetScript).toContain('izumi-dev')
    expect(resetScript).toContain('WebsiteDataStore')
  })
})
