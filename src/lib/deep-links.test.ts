import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { parseDeepLink, resolveDeepLinks } from './deep-link-target'

const tauriConf = JSON.parse(readFileSync(fileURLToPath(new URL('../../src-tauri/tauri.conf.json', import.meta.url)), 'utf8'))
const nativeMain = readFileSync(fileURLToPath(new URL('../../src-tauri/src/lib.rs', import.meta.url)), 'utf8')
const clientDeepLinks = readFileSync(fileURLToPath(new URL('./deep-links.ts', import.meta.url)), 'utf8')
const defaultCapability = JSON.parse(readFileSync(fileURLToPath(new URL('../../src-tauri/capabilities/default.json', import.meta.url)), 'utf8'))

describe('deep links', () => {
  it('routes validated Trakt returns without putting the code in navigation history', () => {
    expect(parseDeepLink(`izumi://auth/trakt#state=${'a'.repeat(64)}&code=private-code`)?.path).toBe('/app/settings/accounts?section=connections')
    expect(parseDeepLink('izumi://auth/trakt#state=invalid&code=private-code')).toBeNull()
  })
  it('routes anime and episode links', () => {
    expect(parseDeepLink('izumi://anime/21')?.path).toBe('/app/anime/21')
    expect(parseDeepLink('izumi://watch/21/1070')?.path).toBe('/app/anime/21?episode=1070')
  })
  it('routes only private-LAN companion pairing links', () => {
    expect(parseDeepLink('izumi://companion/pair?v=1&tv=192.168.1.40&device=0123456789abcdef01234567&challenge=0123456789abcdef0123456789abcdef')?.path)
      .toContain('/app/companion-pair?')
    expect(parseDeepLink('izumi://companion/pair?v=1&tv=example.com&device=0123456789abcdef01234567&challenge=0123456789abcdef0123456789abcdef'))
      .toBeNull()
  })
  it('routes bounded private-Worker companion requests', () => {
    expect(parseDeepLink('izumi://companion/request?worker=https%3A%2F%2Fexample.workers.dev&pairing=abcdefghijklmnopqrstuvwx&request=0123456789abcdefghijklmn')?.path)
      .toContain('/app/companion-request?')
    expect(parseDeepLink('izumi://companion/request?worker=http%3A%2F%2Fevil.example&pairing=abcdefghijklmnopqrstuvwx&request=0123456789abcdefghijklmn'))
      .toBeNull()
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
  it('routes TV restore to its review page and keeps the code exclusively in the fragment', () => {
    const worker = 'https://restore.example.com'
    const code = 'ABCDEFGHJKLMNPQRSTV2'
    const expected = `/app/companion-restore?worker=${encodeURIComponent(worker)}#code=${code}`
    expect(parseDeepLink(`izumi://companion/restore?worker=${encodeURIComponent(worker)}#code=${code}`)?.path).toBe(expected)
    expect(parseDeepLink(`izumi://companion/restore?worker=${encodeURIComponent(worker)}&code=${code}&ignored=secret`)?.path).toBe(expected)
    expect(parseDeepLink(`izumi://companion/restore?worker=${encodeURIComponent(worker)}#code=abcd-efgh+jklm-npqr+stv2`)?.path).toBe(expected)
    expect(parseDeepLink(`izumi://companion/restore?worker=${encodeURIComponent(worker)}&code=22222222222222222222#code=${code}`)).toBeNull()
    expect(parseDeepLink(`izumi://companion/restore?worker=https%3A%2F%2F127.0.0.1#code=${code}`)).toBeNull()
    expect(parseDeepLink(`izumi://companion/restore?worker=${encodeURIComponent(worker)}#code=${code}!`)).toBeNull()
  })

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
    // The scheme is read from the resolved config rather than inlined, so a side-by-side build
    // (tauri.dev.conf.json) claims its own instead of evicting the release's registration. The
    // release config still declares izumi:// — asserted in the sibling test above — and the helper
    // falls back to it, so what actually gets registered here is unchanged.
    expect(setup).toContain('configured_deep_link_scheme(app.config())')
    expect(setup).toContain('deep_link.register(&scheme)')
    expect(nativeMain).toContain('.unwrap_or("izumi")')
    // The failure path logs; propagating it out of `setup` panics the whole app on launch.
    expect(setup).not.toMatch(/deep_link\.register\(&scheme\)\?/)
    // Re-registering on a launch where we already hold the scheme is pure subprocess cost.
    expect(setup).toContain('is_registered(&scheme)')
  })

  it('gives Android the mobile block its intent filters are generated from', () => {
    expect(tauriConf.plugins['deep-link'].mobile).toEqual([
      { scheme: ['izumi'] },
    ])
  })
})
