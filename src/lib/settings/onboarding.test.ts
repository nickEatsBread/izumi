import { describe, expect, it } from 'vitest'
import { onboardingCatalogPlan, onboardingMovieMetadata, onboardingSteps, type OnboardingIntent } from './onboarding'
import { resolveCatalogScreenStartup } from './catalog'

const anime: OnboardingIntent = { anime: true, films: false }
const films: OnboardingIntent = { anime: false, films: true }
const both: OnboardingIntent = { anime: true, films: true }

describe('first-run catalog profile', () => {
  it('starts an anime-focused client on Automatic anime', () => {
    expect(onboardingCatalogPlan(anime)).toEqual({ providers: ['auto'], defaultProvider: 'auto' })
  })

  it('recommends TMDB for a film and TV client', () => {
    expect(onboardingCatalogPlan(films)).toEqual({ providers: ['tmdb'], defaultProvider: 'tmdb' })
  })

  it('can deliberately choose the more limited Stremio metadata path', () => {
    expect(onboardingCatalogPlan(films, 'stremio')).toEqual({ providers: ['stremio'], defaultProvider: 'stremio' })
  })

  it.each(['tmdb', 'stremio'] as const)('enables anime alongside %s in a merged home', metadata => {
    expect(onboardingCatalogPlan(both, metadata)).toEqual({ providers: ['auto', metadata], defaultProvider: 'merged' })
  })

  it.each(['auto', 'merged', 'movies'] as const)('opens the chosen %s library regardless of the last library', startup => {
    const plan = onboardingCatalogPlan(both, 'tmdb', startup)
    const expected = startup === 'movies' ? 'tmdb' : startup
    expect(plan.providers).toEqual(['auto', 'tmdb'])
    for (const last of ['auto', 'tmdb', 'merged']) {
      expect(resolveCatalogScreenStartup(plan.defaultProvider, last, plan.providers)).toBe(expected)
    }
  })

  it.each(['auto', 'tmdb', 'merged'] as const)('remembers %s when both libraries use Adaptive', last => {
    const plan = onboardingCatalogPlan(both, 'tmdb', 'adaptive')
    expect(plan.defaultProvider).toBe('adaptive')
    expect(resolveCatalogScreenStartup(plan.defaultProvider, last, plan.providers)).toBe(last)
  })

  it('falls back to an enabled library when Adaptive remembers an unavailable catalog', () => {
    const plan = onboardingCatalogPlan(both, 'tmdb', 'adaptive')
    expect(resolveCatalogScreenStartup(plan.defaultProvider, 'kitsu', plan.providers)).toBe('auto')
  })

  it('keeps the film startup choice aligned when metadata changes to Stremio', () => {
    const plan = onboardingCatalogPlan(both, 'stremio', 'movies')
    expect(plan).toEqual({ providers: ['auto', 'stremio'], defaultProvider: 'stremio' })
    expect(resolveCatalogScreenStartup(plan.defaultProvider, 'tmdb', plan.providers)).toBe('stremio')
  })

  it('ignores the both-only startup choice after switching to a single library', () => {
    expect(onboardingCatalogPlan(anime, 'tmdb', 'adaptive').defaultProvider).toBe('auto')
    expect(onboardingCatalogPlan(films, 'tmdb', 'merged').defaultProvider).toBe('tmdb')
  })

  it('treats an empty intent as anime rather than producing no library at all', () => {
    expect(onboardingCatalogPlan({ anime: false, films: false })).toEqual({ providers: ['auto'], defaultProvider: 'auto' })
  })
})

describe('first-run step list', () => {
  it('takes a new user from the start screen to a playable app in four screens', () => {
    expect(onboardingSteps('new')).toEqual(['start', 'watch', 'sources', 'ready'])
  })

  it('adds the sign-in screen only for someone bringing an existing setup', () => {
    expect(onboardingSteps('import')).toEqual(['start', 'watch', 'connect', 'sources', 'ready'])
  })

  it('never routes through the removed film, startup, sync or playback screens', () => {
    for (const path of ['new', 'import'] as const) {
      for (const gone of ['metadata', 'access', 'startup', 'sync', 'playback']) {
        expect(onboardingSteps(path)).not.toContain(gone)
      }
    }
  })
})

describe('film metadata during setup', () => {
  it('uses TMDB only when a token is already available', () => {
    expect(onboardingMovieMetadata(true)).toBe('tmdb')
  })

  it('falls back to the keyless catalog instead of asking for a key', () => {
    expect(onboardingMovieMetadata(false)).toBe('stremio')
  })
})
