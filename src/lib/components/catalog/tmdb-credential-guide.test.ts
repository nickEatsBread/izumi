import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const source = readFileSync(fileURLToPath(new URL('./TmdbCredentialGuide.svelte', import.meta.url)), 'utf8')

describe('TMDB credential guide', () => {
  it('guides users to the credential accepted by the client', () => {
    expect(source).toContain('Get your free TMDB token')
    expect(source).toContain('For Application URL, use Izumi’s project page')
    expect(source).toContain('https://github.com/nickEatsBread/izumi')
    expect(source).toContain('API Read Access Token')
    expect(source).toContain('not the short API Key (v3 auth)')
    expect(source).toContain('Paste it into Izumi')
  })

  it('opens the official API settings and provides accessible dismissal', () => {
    expect(source).toContain("const apiSettingsUrl = 'https://www.themoviedb.org/settings/api'")
    expect(source).toContain('aria-modal="true"')
    expect(source).toContain("event.key === 'Escape'")
    expect(source).toContain('onClose()')
  })

  it('offers an accurate keyless catalog alternative', () => {
    expect(source).toContain('Cinemeta’s free IMDb-ID movie and TV catalog')
    expect(source).toContain('It needs no API key')
    expect(source).toContain('onUseKeyless')
    expect(source).toContain('Use keyless catalog')
  })
})
