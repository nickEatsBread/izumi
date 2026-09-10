import { persisted } from 'svelte-persisted-store'
import type { CatalogSelection, CatalogDefaultSelection } from './catalog'

/** What the user said they watch. Both flags may be true; the UI refuses to leave both false. */
export interface OnboardingIntent {
  anime: boolean
  films: boolean
}
export type OnboardingMovieMetadata = 'tmdb' | 'stremio'
export type OnboardingStartupLibrary = 'movies' | 'auto' | 'merged' | 'adaptive'
/** Named so the footer, the artwork and the tests stop depending on step numbers. */
export type StepId = 'welcome' | 'watch' | 'connect' | 'sync' | 'sources' | 'playback' | 'ready'

export interface OnboardingCatalogPlan {
  providers: CatalogSelection[]
  defaultProvider: CatalogDefaultSelection
}

/** Convert the first-run intent into the same catalog settings used by the rest of Izumi. Keeping
 * this pure makes rerunning the assistant predictable and prevents a second onboarding-only config. */
export function onboardingCatalogPlan(
  intent: OnboardingIntent,
  movieMetadata: OnboardingMovieMetadata = 'tmdb',
  startupLibrary: OnboardingStartupLibrary = 'merged',
): OnboardingCatalogPlan {
  if (intent.anime && intent.films) return {
    providers: ['auto', movieMetadata],
    defaultProvider: startupLibrary === 'movies' ? movieMetadata : startupLibrary,
  }
  // An empty intent cannot be reached through the UI, but a stored profile could still hold one.
  // Answering with the anime library beats answering with no library at all.
  const defaultProvider: CatalogSelection = intent.films ? movieMetadata : 'auto'
  return { providers: [defaultProvider], defaultProvider }
}

/** The screens to show, in order. Only the sync screen is conditional: it has nothing to report
 * unless an account was connected on the screen before it. */
export function onboardingSteps(connected: boolean): StepId[] {
  return connected
    ? ['welcome', 'watch', 'connect', 'sync', 'sources', 'playback', 'ready']
    : ['welcome', 'watch', 'connect', 'sources', 'playback', 'ready']
}

/** Versioned so a future materially different setup flow can be offered without losing history. */
export const onboardingComplete = persisted<boolean>('onboarding-complete-v1', false)

export function finishOnboarding(): void {
  onboardingComplete.set(true)
}

export function restartOnboarding(): void {
  onboardingComplete.set(false)
}
