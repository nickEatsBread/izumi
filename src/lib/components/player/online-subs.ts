import type { SubtitleCandidate, SubProviderId } from '$lib/stremio/subtitles/types'
import { authError } from '$lib/stremio/debrid/http'

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

/** Map a failed player_add_subtitle error into an actionable menu notice: routes the provider's HTTP
 *  error body through the shared auth classifier so a spent OpenSubtitles quota (401 + quota body) or
 *  an expired/invalid token surfaces its specific message; falls back to a generic line otherwise. */
export function subtitleErrorNotice(provider: SubProviderId, err: unknown): string {
  const msg = typeof err === 'string' ? err : err instanceof Error ? err.message : String(err)
  const status = Number(/\/download (\d+):/.exec(msg)?.[1]) || undefined
  const name = provider === 'subdl' ? 'SubDL' : provider === 'opensubtitles' ? 'OpenSubtitles' : 'Subtitles'
  return authError(name, { status, message: msg }) ?? 'Subtitle download failed'
}
