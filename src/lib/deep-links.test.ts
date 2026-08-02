import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { parseDeepLink, resolveDeepLinks } from './deep-link-target'

const tauriConf = JSON.parse(readFileSync(fileURLToPath(new URL('../../src-tauri/tauri.conf.json', import.meta.url)), 'utf8'))
const nativeMain = readFileSync(fileURLToPath(new URL('../../src-tauri/src/lib.rs', import.meta.url)), 'utf8')
const clientDeepLinks = readFileSync(fileURLToPath(new URL('./deep-links.ts', import.meta.url)), 'utf8')
const defaultCapability = JSON.parse(readFileSync(fileURLToPath(new URL('../../src-tauri/capabilities/default.json', import.meta.url)), 'utf8'))

describe('deep links', () => {
  it('routes anime and episode links', () => {
    expect(parseDeepLink('izumi://anime/21')?.path).toBe('/app/anime/21')
    expect(parseDeepLink('izumi://watch/21/1070')?.path).toBe('/app/anime/21?episode=1070')
  })
  it('routes magnets through search without autoplay', () => {
    expect(parseDeepLink('magnet:?xt=urn:btih:abc&dn=Frieren%2001')?.path).toBe('/app/search?q=Frieren%2001')
  })
  it('rejects unrelated and malformed input', () => {
    expect(parseDeepLink('https://example.com')).toBeNull()
    expect(parseDeepLink('not a url')).toBeNull()
  })
})

describe('deep link dispatch', () => {
  it('does nothing when the launch carried no links', () => {
    expect(resolveDeepLinks(null)).toBeNull()
    expect(resolveDeepLinks([])).toBeNull()
    expect(resolveDeepLinks(['   '])).toBeNull()
  })

  it('navigates on the first understood link and ignores the rest', () => {
    expect(resolveDeepLinks(['izumi://anime/21', 'izumi://anime/99'])?.path).toBe('/app/anime/21')
  })

  it('skips past leading junk instead of giving up on the batch', () => {
    // Behaviour carried over from the old loop, pinned here because the rewrite added an early
    // return: an unreadable first entry must not swallow the real link behind it.
    expect(resolveDeepLinks(['not a url', 'izumi://search?q=frieren'])?.path).toBe('/app/search?q=frieren')
  })

  it('tells the user when a link means nothing to us, instead of silently doing nothing', () => {
    const outcome = resolveDeepLinks(['izumi://nonsense/1'])
    expect(outcome?.path).toBeUndefined()
    expect(outcome?.notice).toBeTruthy()
  })

  it('carries the magnet notice through to the caller so it is not dead text', () => {
    expect(resolveDeepLinks(['magnet:?xt=urn:btih:abc&dn=Frieren%2001'])?.notice).toBe('Magnet opened in search')
  })
})

describe('deep link registration is not user-hostile', () => {
  it('never claims magnet: as part of install or launch', () => {
    // `desktop.schemes` drives the Windows installer and the Linux .desktop MimeType entry, so a
    // magnet entry here takes the association away from the user's chosen app with no opt-in.
    expect(tauriConf.plugins['deep-link'].desktop.schemes).toEqual(['izumi'])
    // register_all() walks that same list on EVERY launch, shelling out to xdg-mime each time.
    expect(nativeMain).not.toContain('register_all')
    // There is no Settings/runtime escape hatch either: Izumi may passively accept a magnet argv,
    // but it cannot ask the OS to make or remove it as the default handler.
    expect(clientDeepLinks).not.toContain("register('magnet')")
    expect(clientDeepLinks).not.toContain("unregister('magnet')")
    expect(defaultCapability.permissions).not.toContain('deep-link:allow-register')
    expect(defaultCapability.permissions).not.toContain('deep-link:allow-unregister')
    expect(defaultCapability.permissions).not.toContain('deep-link:allow-is-registered')
  })

  it('does not abort startup when the OS refuses handler registration', () => {
    const setup = nativeMain.slice(nativeMain.indexOf('builder.setup('), nativeMain.indexOf('sync::initialize_if_configured'))
    expect(setup).toContain('deep_link.register("izumi")')
    // The failure path logs; propagating it out of `setup` panics the whole app on launch.
    expect(setup).not.toMatch(/deep_link\.register\("izumi"\)\?/)
    // Re-registering on a launch where we already hold the scheme is pure subprocess cost.
    expect(setup).toContain('is_registered("izumi")')
  })

  it('gives Android the mobile block its intent filters are generated from', () => {
    expect(tauriConf.plugins['deep-link'].mobile).toEqual([{ scheme: ['izumi'] }])
  })
})
