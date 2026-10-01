// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'
import { diagnosticsSnapshot } from './diagnostics'

function settings(): Record<string, string | null> {
  return (JSON.parse(diagnosticsSnapshot()) as { settings: Record<string, string | null> }).settings
}

describe('diagnostics settings redaction', () => {
  beforeEach(() => {
    localStorage.clear()
    sessionStorage.clear()
  })

  it('keeps ordinary settings readable', () => {
    localStorage.setItem('ui-scale', '1.2')
    localStorage.setItem('nav-config-v1', '[]')
    expect(settings()).toEqual({ 'ui-scale': '1.2', 'nav-config-v1': '[]' })
  })

  it('still redacts every name the old test matched', () => {
    localStorage.setItem('debrid-provider', '"provider-a"')
    localStorage.setItem('extension-urls', '[]')
    expect(settings()).toEqual({ 'debrid-provider': '[redacted]', 'extension-urls': '[redacted]' })
  })

  it('redacts secret, device and session keys the name test missed', () => {
    localStorage.setItem('mal-refresh', '"refresh-value"')
    localStorage.setItem('izumi-profile:profile-kid:simkl-viewer-name', '"kid"')
    localStorage.setItem('stremio-account-email', '"me@mail.test"')
    localStorage.setItem('cloudflare-sync-config-v1', '{"groupKey":"g"}')
    localStorage.setItem('paired-tizen-companions-v1', '[{"tvToken":"t"}]')
    localStorage.setItem('companion-client-restore-v1', '{"state":"s"}')
    const values = settings()
    expect(Object.keys(values)).toHaveLength(6)
    expect(Object.values(values).every((value) => value === '[redacted]')).toBe(true)
  })

  it('hides the profile roster, which holds the PIN verifiers', () => {
    localStorage.setItem('izumi-profiles-v1', JSON.stringify({ profiles: [{ id: 'default', name: 'Main', pin: { salt: 's', hash: 'h' } }], enabled: true }))
    expect(settings()['izumi-profiles-v1']).toBe('[redacted]')
  })

  it('redacts a setting whose value carries a secret string', () => {
    localStorage.setItem('stremio-addon-urls', JSON.stringify(['https://addon.test/LONGCONFIG0123456789/manifest.json']))
    localStorage.setItem('dead-sources-v6', JSON.stringify({ 'https://addon.test/LONGCONFIG0123456789': 2 }))
    localStorage.setItem('source-outcomes-v2', JSON.stringify({ 'https://addon.test': 1 }))
    const values = settings()
    expect(values['dead-sources-v6']).toBe('[redacted]')
    expect(values['source-outcomes-v2']).toBe('{"https://addon.test":1}')
  })

  it('drops download links and the proxy sign-in but keeps the rest of those values', () => {
    localStorage.setItem('downloads', JSON.stringify({ '1:1': { id: '1:1', title: 'Episode 1', url: 'https://debrid.test/dl/abc' } }))
    localStorage.setItem('torrent-proxy-url', '"socks5://me:hunter22@127.0.0.1:1080"')
    expect(settings()).toEqual({
      downloads: JSON.stringify({ '1:1': { id: '1:1', title: 'Episode 1' } }),
      'torrent-proxy-url': '"socks5://127.0.0.1:1080"',
    })
  })
})
