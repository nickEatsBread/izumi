import { get } from 'svelte/store'
import type { SubtitleCandidate, SubProviderId } from '$lib/stremio/subtitles/types'
import { authError } from '$lib/stremio/debrid/http'
import { OPEN_SUBS_API_KEY } from '$lib/stremio/subtitles/opensubtitles'
import { subDlApiKey, jimakuApiKey } from '$lib/settings/ui'

/** Human label for the source badge pill. */
export function providerBadge(p: SubProviderId): string {
  return p === 'opensubtitles' ? 'OpenSubtitles' : p === 'subdl' ? 'SubDL' : p === 'jimaku' ? 'Jimaku' : 'Addon'
}

/** Deterministic mpv `sub-add` title — also the key we match a loaded track back to its candidate. */
export function candidateTitle(c: SubtitleCandidate): string {
  return `${c.lang ?? 'und'} · ${c.release ?? c.provider}`
}

/** Stable {#each}/per-row key. Falls back through the identifying fields each provider carries. */
export function candidateKey(c: SubtitleCandidate): string {
  return `${c.provider}:${c.download?.fileId ?? c.download?.zipUrl ?? c.download?.fileUrl ?? c.id ?? c.url ?? candidateTitle(c)}`
}

/** The URL `player_add_subtitle` fetches for a needsFetch candidate — a SubDL zip or a Jimaku file
 *  (which may itself be an archive; Rust sniffs the bytes rather than trusting the extension).
 *  OpenSubtitles has none: it resolves its own link from the file id. */
export function candidateDownloadUrl(c: SubtitleCandidate): string | undefined {
  return c.download?.zipUrl ?? c.download?.fileUrl
}

/** The credential that provider's download hop needs: the user's own key for the bring-your-own-key
 *  providers, the embedded consumer key for OpenSubtitles. Shared so the three menus that can start
 *  a download can't drift apart as providers are added. */
export function candidateApiKey(p: SubProviderId): string {
  if (p === 'subdl') return get(subDlApiKey)
  if (p === 'jimaku') return get(jimakuApiKey)
  return OPEN_SUBS_API_KEY
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
  const name = provider === 'addon' ? 'Subtitles' : providerBadge(provider)
  return authError(name, { status, message: msg }) ?? 'Subtitle download failed'
}
