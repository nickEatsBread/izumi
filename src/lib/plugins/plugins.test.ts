import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { grantText, parseManifest } from './manifest'
import { checkPluginUrl, isLocalHost } from './network'
import { classifyStorageKey } from '$lib/storage/key-policy'

// Loaded by URL so the type checker leaves the plugin's plain JavaScript alone.
const pluginPath = '../../../plugins/jump-to-moment/main.js'
const { parseMatches, pickLines } = (await import(/* @vite-ignore */ pluginPath)) as {
  parseMatches: (content: string) => { line: number; reason?: string }[]
  pickLines: (cues: { start: number; end: number; text: string }[], query: string) => number[]
}

const exampleDir = new URL('../../../plugins/jump-to-moment/', import.meta.url)
const example = () => JSON.parse(readFileSync(new URL('plugin.json', exampleDir), 'utf8'))

describe('plugin manifest', () => {
  it('accepts the example plugin and pins its code', () => {
    const manifest = parseManifest(example())
    expect(manifest.permissions.network).toMatchObject({ domains: [], fromSetting: 'endpoint' })
    expect(manifest.panel?.label).toBe('Jump to a moment')
    const code = readFileSync(new URL(manifest.main.path, exampleDir), 'utf8')
    expect(createHash('sha256').update(code, 'utf8').digest('hex')).toBe(manifest.main.sha256)
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

describe('jump to a moment', () => {
  const cues = Array.from({ length: 60 }, (_, i) => ({ start: i * 10, end: i * 10 + 5, text: i === 30 ? 'This soup tastes incredible!' : `line ${i}` }))

  it('sends the windows around keyword hits, or everything when nothing matches', () => {
    expect(pickLines(cues, 'where he tastes the soup')).toEqual(Array.from({ length: 11 }, (_, i) => 25 + i))
    expect(pickLines(cues, 'the quiet bit')).toHaveLength(60)
  })

  it('reads line numbers out of a reply and drops anything else', () => {
    expect(parseMatches('```json\n{"matches":[{"line":31,"reason":"he tastes it"},{"line":"x"}]}\n```')).toEqual([{ line: 31, reason: 'he tastes it' }])
    expect(parseMatches('no idea')).toEqual([])
    expect(parseMatches('{"matches": []}')).toEqual([])
  })
})
