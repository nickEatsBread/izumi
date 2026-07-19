import type { SubtitleCandidate, SubProviderId } from '$lib/stremio/subtitles/types'

/** Human label for the source badge pill. */
export function providerBadge(p: SubProviderId): string {
  return p === 'opensubtitles' ? 'OpenSubtitles' : p === 'subdl' ? 'SubDL' : 'Addon'
}

/** Deterministic mpv `sub-add` title — also the key we match a loaded track back to its candidate. */
export function candidateTitle(c: SubtitleCandidate): string {
  return `${c.lang ?? 'und'} · ${c.release ?? c.provider}`
}

/** Stable {#each}/per-row key. Falls back through the identifying fields each provider carries. */
export function candidateKey(c: SubtitleCandidate): string {
  return `${c.provider}:${c.download?.fileId ?? c.download?.zipUrl ?? c.id ?? c.url ?? candidateTitle(c)}`
}

/** A candidate is "loaded" when a selected sub track carries its exact `sub-add` title. */
export function isCandidateLoaded(c: SubtitleCandidate, loadedTitles: string[]): boolean {
  return loadedTitles.includes(candidateTitle(c))
}
