import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, it, expect } from 'vitest'

const src = readFileSync(fileURLToPath(new URL('./+page.svelte', import.meta.url)), 'utf8')

describe('Subtitles settings page', () => {
  it('imports every subtitle store from settings/ui', () => {
    for (const s of [
      'subtitleProviders',
      'openSubtitlesToken',
      'openSubtitlesExpiry',
      'openSubtitlesUserName',
      'openSubtitlesBaseUrl',
      'openSubtitlesStaySignedIn',
      'openSubtitlesCreds',
      'subDlApiKey',
    ]) {
      expect(src).toContain(s)
    }
  })

  it('renders a provider Toggle for OpenSubtitles and SubDL', () => {
    expect(src).toContain("value={hasProvider('opensubtitles')}")
    expect(src).toContain("value={hasProvider('subdl')}")
  })

  it('connects via the opensubtitles_login command', () => {
    expect(src).toContain("invoke<OpenSubtitlesLogin>('opensubtitles_login'")
  })

  it('gates the connected view on token + username and shows quota + disconnect', () => {
    expect(src).toContain('{#if $openSubtitlesToken && $openSubtitlesUserName}')
    expect(src).toContain('Disconnect')
    expect(src).toContain('Downloads left today')
  })

  it('has a default-off Stay signed in checkbox bound to local state', () => {
    expect(src).toContain('bind:checked={osStay}')
    expect(src).toContain('Stay signed in')
  })

  it('has a SubDL API key secret field', () => {
    expect(src).toContain('bind:value={$subDlApiKey}')
    expect(src).toContain('SubDL API key')
  })

  it('only writes stored credentials when Stay signed in is on', () => {
    expect(src).toContain("$openSubtitlesCreds = osStay ? JSON.stringify({ username, password }) : ''")
  })

  it('marks every input as d-pad focusable', () => {
    const inputs = src.match(/<input[^>]*>/g) ?? []
    expect(inputs.length).toBeGreaterThan(0)
    for (const tag of inputs) expect(tag).toContain('data-focusable')
  })
})
