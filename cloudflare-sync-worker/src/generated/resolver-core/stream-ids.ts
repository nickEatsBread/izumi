// GENERATED from src/lib/stremio/stream-ids.ts by scripts/generate-cloudflare-resolver-core.mjs.
// Edit the canonical source, then regenerate; do not edit this vendored copy.
// Which ids to ask each addon for.
//
// Only `kitsu:<id>:<ep>` was ever built, because that is what anime-aware addons index by. The
// cost was invisible: a stream addon configured for IMDb ids — which is most general-purpose ones
// — was still queried with a kitsu id on every single play, always answered nothing, and still
// counted toward the wait before the picker could settle.
//
// Asking with more than one id is only safe when the extra id is CORRECT. An IMDb episode triple
// built from a guess reintroduces precisely the cross-season mismatch the season verifier exists
// to clean up (a kitsu entry's episodes numbered sequentially against TVDB spill into the next
// season), so the triple is emitted only from a mapping that actually named both the season and
// the per-season episode number for the episode being requested.

export interface StreamIdInput {
  type: 'movie' | 'series'
  /** Provider-owned ids (notably a Stremio metadata video's exact id). */
  direct?: string | string[]
  kitsu?: number
  /** The AniList episode being requested. */
  episode?: number
  imdb?: string
  tmdb?: string | number
  /** Mapped season for THIS episode, from the episode-id mapping. */
  season?: number
  /** Mapped per-season episode number for THIS episode. Not the absolute number. */
  imdbEpisode?: number
}

export function buildStreamIds(i: StreamIdInput): string[] {
  const ids: string[] = []
  if (i.direct) ids.push(...(Array.isArray(i.direct) ? i.direct : [i.direct]))
  // Kitsu first: it is the namespace anime addons actually index, so it stays the primary query
  // and the one whose results arrive on the fast path.
  if (i.kitsu != null) ids.push(i.episode != null && i.type === 'series' ? `kitsu:${i.kitsu}:${i.episode}` : `kitsu:${i.kitsu}`)
  if (i.imdb) {
    if (i.type === 'movie') ids.push(i.imdb)
    // Season 0 is the specials bucket; addons do not index anime specials under that triple, and
    // asking produces either nothing or somebody else's episode.
    else if (i.season != null && i.season >= 1 && i.imdbEpisode != null) ids.push(`${i.imdb}:${i.season}:${i.imdbEpisode}`)
  }
  if (i.tmdb != null) {
    const base = `tmdb:${i.tmdb}`
    ids.push(i.type === 'series' && i.season != null && i.imdbEpisode != null
      ? `${base}:${i.season}:${i.imdbEpisode}` : base)
  }
  return [...new Set(ids.filter(Boolean))]
}
