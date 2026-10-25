import { describe, expect, it } from 'vitest'
import { compareVersions, localized, parsePack } from './format'

const URL_ = 'https://example.github.io/pack/pack.json'
const STORE = 'https://example.github.io/pack/store.json'

function pack(overrides: Record<string, unknown> = {}) {
  return {
    app: 'izumi', kind: 'pack', schemaVersion: 1,
    id: 'io.github.example.pack', name: 'Example', version: '1.0.0',
    stores: [{ url: STORE }],
    items: [
      { ref: 'source', kind: 'source', from: { store: STORE, id: 'example.source' } },
      { ref: 'look', kind: 'theme', from: { store: STORE, id: 'example-look' }, apply: true },
    ],
    modules: [{ id: 'widevine' }],
    startup: { video: { url: 'intro.mp4', sha256: 'A'.repeat(64), bytes: 3_967_570 } },
    setup: { steps: [{ item: 'source', step: 'settings', title: { en: 'Sign in', fr: 'Connexion' } }] },
    ...overrides,
  }
}

describe('pack format', () => {
  it('reads a complete pack, resolving relative links against the pack', () => {
    const result = parsePack(pack(), URL_, 'fr-FR')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.pack.stores).toEqual([STORE])
    expect(result.pack.items).toEqual([
      { ref: 'source', kind: 'source', store: STORE, id: 'example.source', apply: false },
      { ref: 'look', kind: 'theme', store: STORE, id: 'example-look', apply: true },
    ])
    expect(result.pack.modules).toEqual(['widevine'])
    expect(result.pack.startup).toEqual({ url: 'https://example.github.io/pack/intro.mp4', sha256: 'a'.repeat(64), bytes: 3_967_570 })
    expect(result.pack.steps).toEqual([{ kind: 'source-settings', item: 'source', title: 'Connexion' }])
  })

  it('adds the stores items install from even when the pack does not list them', () => {
    const result = parsePack(pack({ stores: [] }), URL_)
    expect(result.ok && result.pack.stores).toEqual([STORE])
  })

  it('refuses what is not a pack or needs a newer izumi', () => {
    expect(parsePack({ app: 'izumi', kind: 'store' }, URL_)).toEqual({ ok: false, errors: ['That is not an izumi pack.'] })
    expect(parsePack(pack({ schemaVersion: 2 }), URL_)).toEqual({ ok: false, errors: ['This pack needs a newer izumi.'] })
  })

  it('lists every problem at once', () => {
    const result = parsePack(pack({
      id: 'Bad Id',
      version: 'one',
      items: [
        { ref: 'a', kind: 'plugin', from: { store: STORE, id: 'x1' } },
        { ref: 'b', kind: 'source', from: { store: 'http://insecure.example/store.json', id: 'x2' } },
      ],
      startup: { video: { url: 'https://example.com/x.mp4', sha256: 'a'.repeat(64), bytes: 64 << 20 } },
      setup: { steps: [{ item: 'missing', step: 'settings' }, { plugin: 'x', step: 'login' }] },
    }), URL_)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.errors).toEqual([
      'The pack id is missing or invalid.',
      'The pack version must look like 1.0.0.',
      'Item 1: kind must be source or theme.',
      'Item 2: stores must be public HTTPS links.',
      'The startup animation is larger than 16 MB.',
      'Setup step 1: "missing" is not one of the pack\'s sources.',
      'Setup step 2: izumi only knows source settings steps ({"item": "<ref>", "step": "settings"}).',
    ])
  })

  it('keeps module ids to plain names, never URLs', () => {
    const result = parsePack(pack({ modules: [{ id: 'https://evil.example/x.so' }] }), URL_)
    expect(result.ok).toBe(false)
  })

  it('allows only one applied theme and unique refs', () => {
    const twice = parsePack(pack({ items: [
      { ref: 'a', kind: 'theme', from: { store: STORE, id: 'one-look' }, apply: true },
      { ref: 'b', kind: 'theme', from: { store: STORE, id: 'two-look' }, apply: true },
      { ref: 'b', kind: 'source', from: { store: STORE, id: 'src.one' } },
    ], setup: {} }), URL_)
    expect(twice.ok).toBe(false)
    if (!twice.ok) expect(twice.errors).toEqual(['Item 3: ref "b" is used twice.', 'Only one theme can be applied.'])
  })

  it('lets a source add its own screen, one of them opening at startup', () => {
    const on = parsePack(pack({ items: [{ ref: 'source', kind: 'source', from: { store: STORE, id: 'example.source' }, screen: 'default' }] }), URL_)
    expect(on.ok && on.pack.items[0]?.screen).toBe('default')
    const bad = parsePack(pack({ items: [
      { ref: 'a', kind: 'source', from: { store: STORE, id: 'src.one' }, screen: 'default' },
      { ref: 'b', kind: 'source', from: { store: STORE, id: 'src.two' }, screen: 'default' },
      { ref: 'c', kind: 'theme', from: { store: STORE, id: 'one-look' }, screen: true },
    ], setup: {} }), URL_)
    expect(bad.ok).toBe(false)
    if (!bad.ok) expect(bad.errors).toEqual(['Item 3: screen is true or "default", on a source.', 'Only one screen can open at startup.'])
  })

  it('compares versions and picks localized text', () => {
    expect(compareVersions('0.1.75', '0.1.74')).toBe(1)
    expect(compareVersions('0.1.9', '0.1.75')).toBe(-1)
    expect(compareVersions('1.0.0', '1.0.0')).toBe(0)
    expect(localized({ en: 'Hi', 'pt-BR': 'Oi' }, 'pt-BR', 10)).toBe('Oi')
    expect(localized({ en: 'Hi' }, 'de', 10)).toBe('Hi')
    expect(localized('x'.repeat(11), 'en', 10)).toBeUndefined()
  })
})
