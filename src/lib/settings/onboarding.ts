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
export type StepId =
  | 'watch'
  | 'metadata'
  | 'access'
  | 'startup'
  | 'connect'
  | 'sync'
  | 'sources'
  | 'playback'
  | 'ready'

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

/**
 * The screens to show, in order.
 *
 * Four are conditional, and each is a screen rather than a block folded into the one before it.
 * An earlier draft nested the metadata choice, the TMDB key and the startup choice underneath the
 * two library checkboxes; that put four unrelated decisions on one screen and read as a wall.
 * One decision per screen costs a click and reads far better, and the conditions mean an
 * anime-only run never sees any of the three film screens.
 */
export function onboardingSteps(
  connected: boolean,
  intent: OnboardingIntent,
  movieMetadata: OnboardingMovieMetadata,
): StepId[] {
  const steps: StepId[] = ['watch']
  if (intent.films) {
    steps.push('metadata')
    // Picking TMDB means supplying a token, which is a screen's worth of work on its own.
    if (movieMetadata === 'tmdb') steps.push('access')
  }
  // Only meaningful when there are two libraries to choose between.
  if (intent.anime && intent.films) steps.push('startup')
  steps.push('connect')
  if (connected) steps.push('sync')
  steps.push('sources', 'playback', 'ready')
  return steps
}

/** Versioned so a future materially different setup flow can be offered without losing history. */
export const onboardingComplete = persisted<boolean>('onboarding-complete-v1', false)

export function finishOnboarding(): void {
  onboardingComplete.set(true)
}

export function restartOnboarding(): void {
  onboardingComplete.set(false)
}
