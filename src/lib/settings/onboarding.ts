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
export type StepId = 'start' | 'watch' | 'connect' | 'sources' | 'ready'

/** The route chosen on the start screen. Device transfer is not a path: it replaces the wizard
 *  outright, so it never reaches the step list. */
export type OnboardingPath = 'new' | 'import'

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
 * Everything that used to be asked about films — provider, TMDB key, startup library — is now
 * derived instead, and import progress shows inside each sign-in tile, so the only difference
 * between the paths is the sign-in screen itself.
 */
export function onboardingSteps(path: OnboardingPath): StepId[] {
  return path === 'import'
    ? ['start', 'watch', 'connect', 'sources', 'ready']
    : ['start', 'watch', 'sources', 'ready']
}

/** Setup never asks for an API key. TMDB is used only when a token is already available (saved on
 *  an earlier run or built into a private build); otherwise the keyless catalog. */
export function onboardingMovieMetadata(hasTmdbToken: boolean): OnboardingMovieMetadata {
  return hasTmdbToken ? 'tmdb' : 'stremio'
}

/** Versioned so a future materially different setup flow can be offered without losing history. */
export const onboardingComplete = persisted<boolean>('onboarding-complete-v1', false)

export function finishOnboarding(): void {
  onboardingComplete.set(true)
}

export function restartOnboarding(): void {
  onboardingComplete.set(false)
}
