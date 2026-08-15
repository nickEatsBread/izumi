import { writable } from 'svelte/store'

export interface AniListDegradedState {
  error: string
  since: number
  /** Provider currently answering public catalogue requests. */
  provider?: 'Jikan' | 'Kitsu' | 'AnimeSchedule'
  /** Present only when every applicable backup provider failed too. */
  fallbackError?: string
}

/** Set only when a public AniList catalog request has failed and Jikan has taken over. Account and
 *  tracker failures do not light this banner because they have their own retry/queue behaviour. */
export const anilistDegraded = writable<AniListDegradedState | null>(null)

const PROBE_AFTER_MS = 60_000
let useFallbackUntil = 0

export function markAniListDegraded(error: string): void {
  useFallbackUntil = Date.now() + PROBE_AFTER_MS
  anilistDegraded.update((current) => current?.error === error
    ? current
    : { ...current, error, since: current?.since ?? Date.now() })
}

export function markJikanCatalogUnavailable(error: unknown): void {
  const message = error instanceof Error ? error.message : String(error)
  anilistDegraded.update((current) => current ? { ...current, fallbackError: message } : current)
}

export function markCatalogProvider(provider: AniListDegradedState['provider']): void {
  anilistDegraded.update((current) => current ? { ...current, provider, fallbackError: undefined } : current)
}

export function clearJikanCatalogUnavailable(): void {
  anilistDegraded.update((current) => {
    if (!current?.fallbackError) return current
    const { fallbackError: _fallbackError, ...available } = current
    return available
  })
}

export function clearAniListDegraded(): void {
  useFallbackUntil = 0
  anilistDegraded.set(null)
}

/** Avoid repeatedly hitting a known-disabled AniList endpoint. Once a minute one catalog request is
 *  allowed through as a recovery probe; a healthy response clears the degraded state. */
export const shouldUseJikanCatalog = (): boolean => Date.now() < useFallbackUntil
