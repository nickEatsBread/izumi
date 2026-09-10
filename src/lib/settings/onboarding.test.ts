import { describe, expect, it } from 'vitest'
import { onboardingCatalogPlan, onboardingSteps, type OnboardingIntent } from './onboarding'
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
  it('adds the sync screen only when an account was connected', () => {
    expect(onboardingSteps(false)).toEqual(['welcome', 'watch', 'connect', 'sources', 'playback', 'ready'])
    expect(onboardingSteps(true)).toEqual(['welcome', 'watch', 'connect', 'sync', 'sources', 'playback', 'ready'])
  })
})
