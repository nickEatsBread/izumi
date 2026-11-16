import { describe, expect, it } from 'vitest'
import { grantText, parseManifest } from './manifest'
import { checkPluginUrl, isLocalHost } from './network'
import { classifyStorageKey } from '$lib/storage/key-policy'

// A plugin shaped like Jump to a moment (now published in the plugin marketplace): a panel, the
// subtitles, seeking, and a network grant taken from a url setting.
const example = () => ({
  app: 'izumi', kind: 'plugin', schemaVersion: 1, pluginApi: 1,
  id: 'watch.izumi.jump-to-moment', name: 'Jump to a moment', version: '1.0.0', author: 'Izumi',
  description: 'Describe a scene and the player jumps to it.',
  main: { path: 'main.js', sha256: 'a'.repeat(64) },
  permissions: {
    scopes: ['network', 'player.events', 'player.subtitles', 'player.control', 'player.panel'],
    network: { domains: [], fromSetting: 'endpoint', reason: 'Sends your question to the model address you enter.' },
  },
  settings: [
    { id: 'endpoint', type: 'url', label: 'Model address', placeholder: 'http://localhost:11434/v1' },
    { id: 'apiKey', type: 'secret', label: 'API key' },
    { id: 'watchedOnly', type: 'toggle', label: "Only search what I've watched", default: false },
  ],
  panel: { label: 'Jump to a moment', placeholder: 'Describe a moment…' },
})

describe('plugin manifest', () => {
  it('accepts a plugin with a panel and a network grant from a setting', () => {
    const manifest = parseManifest(example())
    expect(manifest.permissions.network).toMatchObject({ domains: [], fromSetting: 'endpoint' })
    expect(manifest.panel?.label).toBe('Jump to a moment')
    expect(manifest.settings.map((setting) => setting.id)).toEqual(['endpoint', 'apiKey', 'watchedOnly'])
  })

  it('refuses what izumi would not run', () => {
    const base = example()
    expect(() => parseManifest({ ...base, pluginApi: 2 })).toThrow('different version')
    expect(() => parseManifest({ ...base, id: 'Bad Id' })).toThrow('id')
    expect(() => parseManifest({ ...base, permissions: { scopes: ['library.write'] } })).toThrow('Unknown plugin permission')
    expect(() => parseManifest({ ...base, permissions: { ...base.permissions, scopes: ['player.panel'] } })).toThrow('network')
    expect(() => parseManifest({ ...base, permissions: { scopes: ['network'], network: { domains: [], reason: 'x' } } })).toThrow('list domains')
    expect(() => parseManifest({ ...base, permissions: { scopes: ['network'], network: { domains: ['http://x'], reason: 'x' } } })).toThrow('not a domain')
    expect(() => parseManifest({ ...base, settings: [...base.settings, { id: 'k', type: 'secret', label: 'K', default: 'x' }] })).toThrow('default')
    expect(() => parseManifest({ ...base, panel: { label: 'x', placeholder: 'y' }, permissions: { scopes: [] } })).toThrow('player.panel')
  })

  it('hashes the grant independently of order, so only a real permission change asks again', () => {
    const a = parseManifest(example())
    const b = parseManifest({ ...example(), permissions: { ...example().permissions, scopes: [...example().permissions.scopes].reverse() } })
    expect(grantText(a)).toBe(grantText(b))
    const c = parseManifest({ ...example(), permissions: { scopes: ['player.panel'] } })
    expect(grantText(c)).not.toBe(grantText(a))
  })
})

describe('plugin network guard', () => {
  it('allows listed https domains only', () => {
    expect(checkPluginUrl('https://api.example.com/v1', ['api.example.com'])).toBeInstanceOf(URL)
    expect(checkPluginUrl('https://x.example.com/', ['*.example.com'])).toBeInstanceOf(URL)
    expect(String(checkPluginUrl('https://example.com/', ['*.example.com']))).toContain('not allowed')
    expect(String(checkPluginUrl('http://api.example.com/', ['api.example.com']))).toContain('https')
    expect(String(checkPluginUrl('https://evil.test/', ['api.example.com']))).toContain('not allowed')
    expect(String(checkPluginUrl('https://u:p@api.example.com/', ['api.example.com']))).toContain('credentials')
  })

  it('refuses local and private addresses unless they are the endpoint the viewer typed', () => {
    for (const host of ['localhost', '127.0.0.1', '10.0.0.2', '192.168.1.5', '172.20.0.1', '169.254.1.1', '[::1]', '[fd00::1]', 'nas.local']) {
      expect(isLocalHost(new URL(`http://${host}/`).hostname)).toBe(true)
      expect(String(checkPluginUrl(`https://${host}/x`, ['example.com']))).toContain('blocked')
    }
    expect(checkPluginUrl('http://localhost:11434/v1/chat/completions', [], 'http://localhost:11434/v1')).toBeInstanceOf(URL)
    expect(String(checkPluginUrl('http://localhost:8080/', [], 'http://localhost:11434/v1'))).toContain('blocked')
    expect(String(checkPluginUrl('http://models.example.com/v1', [], 'http://models.example.com/v1'))).toContain('https')
    expect(checkPluginUrl('https://models.example.com/v1/chat/completions', [], 'https://models.example.com/v1')).toBeInstanceOf(URL)
  })

  it('keeps plugin secrets out of backups without secrets and the list on this device', () => {
    expect(classifyStorageKey('plugin-secret-watch.izumi.jump-to-moment')).toBe('secret')
    expect(classifyStorageKey('installed-plugins-v1')).toBe('device')
    expect(classifyStorageKey('plugins-enabled-v1')).toBe('device')
  })
})
