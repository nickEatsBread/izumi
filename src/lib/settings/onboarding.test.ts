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
    expect(onboardingSteps(false, anime, 'tmdb')).toEqual(['watch', 'connect', 'sources', 'playback', 'ready'])
    expect(onboardingSteps(true, anime, 'tmdb')).toEqual(['watch', 'connect', 'sync', 'sources', 'playback', 'ready'])
  })

  it('never asks an anime-only run about film metadata, a TMDB key or a startup library', () => {
    const steps = onboardingSteps(false, anime, 'tmdb')
    expect(steps).not.toContain('metadata')
    expect(steps).not.toContain('access')
    expect(steps).not.toContain('startup')
  })

  it('puts the TMDB key on its own screen straight after choosing TMDB', () => {
    const steps = onboardingSteps(false, films, 'tmdb')
    expect(steps).toEqual(['watch', 'metadata', 'access', 'connect', 'sources', 'playback', 'ready'])
    expect(steps.indexOf('access')).toBe(steps.indexOf('metadata') + 1)
  })

  it('skips the key screen for the keyless metadata option', () => {
    const steps = onboardingSteps(false, films, 'stremio')
    expect(steps).toContain('metadata')
    expect(steps).not.toContain('access')
  })

  it('only asks which library to open when there are two of them', () => {
    expect(onboardingSteps(false, films, 'stremio')).not.toContain('startup')
    expect(onboardingSteps(false, both, 'stremio')).toContain('startup')
  })

  it('skips the playback question once sources are configured', () => {
    // The screen only exists to guarantee a way to play. Someone who imported or picked sources
    // already has one, and the debrid-versus-P2P call is better made at first playback.
    expect(onboardingSteps(false, anime, 'tmdb', false)).toContain('playback')
    expect(onboardingSteps(false, anime, 'tmdb', true)).not.toContain('playback')
  })

  it('still ends on the readiness card when the playback screen is skipped', () => {
    const steps = onboardingSteps(false, anime, 'tmdb', true)
    expect(steps).toEqual(['watch', 'connect', 'sources', 'ready'])
    expect(steps[steps.length - 1]).toBe('ready')
  })

  it('orders the film screens before connecting accounts', () => {
    const steps = onboardingSteps(true, both, 'tmdb')
    expect(steps).toEqual(['watch', 'metadata', 'access', 'startup', 'connect', 'sync', 'sources', 'playback', 'ready'])
  })
})
