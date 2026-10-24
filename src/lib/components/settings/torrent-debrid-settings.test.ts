import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const source = readFileSync(fileURLToPath(new URL('./TorrentDebridSettings.svelte', import.meta.url)), 'utf8').replace(/\r\n/g, '\n')

describe('TorrentDebridSettings', () => {
  it('renders torrent playback and the debrid service as value rows', () => {
    expect(source).toContain('settingKey="torrent-playback"')
    expect(source).toContain('settingKey="debrid-service"')
    expect(source).toContain("{ value: 'debrid', label: 'Prefer debrid' }")
    expect(source).toContain("{ value: 'direct', label: 'Direct P2P' }")
    expect(source).toContain("label: `${provider.name}${provider.experimental ? ' (experimental)' : ''}`")
    expect(source).not.toContain('<SelectMenu')
  })

  it('shows the debrid credential as a masked status that opens the editor', () => {
    expect(source).toContain('settingKey="debrid-key"')
    expect(source).toContain("value={$debridKey ? 'Saved · hidden' : 'Not set'}")
    expect(source).toContain('onActivate={() => (keyOpen = !keyOpen)}')
    expect(source).toContain('expanded={keyOpen}')
    expect(source).toContain('<CredentialField bind:value={$debridKey}')
  })

  it('keeps the account check on request and resets it when the service or key changes', () => {
    expect(source).toContain('account = await accountInfo($debridProvider, $debridKey)')
    expect(source).toContain("$effect(() => { void $debridProvider; void $debridKey; account = null; accountError = '' })")
    expect(source).toContain('onRefresh={refreshAccount}')
    expect(source).toContain('role="progressbar"')
    expect(source).toContain('{#if $debridKey}')
  })
})
