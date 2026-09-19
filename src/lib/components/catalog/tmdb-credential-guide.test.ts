import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const source = readFileSync(fileURLToPath(new URL('./TmdbCredentialGuide.svelte', import.meta.url)), 'utf8')

describe('TMDB credential guide', () => {
  it('names the credential the client accepts, and leaves the steps to the maintained guide', () => {
    expect(source).toContain('Get your free TMDB token')
    // The one thing this dialog must say itself rather than link to: which of TMDB's two
    // credentials izumi takes. Pasting the v3 key is the usual way this goes wrong.
    expect(source).toContain('API Read Access Token')
    expect(source).toContain('not the short v3 API key')
    expect(source).toContain('stored only on this device')
    // The steps are deliberately not duplicated here — they live in the walkthrough that gets
    // updated when TMDB moves its UI, which is why the old inline copy was removed.
    expect(source).toContain("const guideUrl = 'https://duckkota.gitlab.io/guides/tmdb/'")
    expect(source).not.toContain('For Application URL')
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
