// Shared contract for external-subtitle sources. Each provider is a pure async search function
// mapping a SubQuery → SubtitleCandidate[]; no provider touches mpv, the DOM, or Rust. The aggregator
// in ../subtitles.ts fans out over the enabled providers and dedupes. Naming stays service-only.

export type SubProviderId = 'addon' | 'opensubtitles' | 'subdl'

export interface SubQuery {
  imdbId?: string          // series-or-movie imdb, raw 'tt…' (each provider normalizes as it needs)
  parentImdbId?: string    // series parent imdb (OpenSubtitles episode search form A)
  tmdbId?: string
  kitsuId?: string         // addon path only
  type: 'movie' | 'series'
  season?: number
  episode?: number
  filename?: string        // release filename hint — the primary hashless matching signal
  languages: string[]      // normalized lowercase iso-639-1, e.g. ['en']
}

// Superset of the addon subtitle shape (../subtitles.ts ExternalSubtitle), back-compatible.
export interface SubtitleCandidate {
  provider: SubProviderId
  lang?: string            // display / iso code
  release?: string         // release_name / release, for the muted subline
  id?: string
  url?: string             // addon path: a plain .srt/.vtt mpv can load directly
  download?: {             // present ONLY for needsFetch providers (OpenSubtitles / SubDL)
    needsFetch: true
    fileId?: number        // OpenSubtitles files[].file_id
    zipUrl?: string        // SubDL absolute dl.subdl.com/…zip
  }
}

export interface SubtitleProvider {
  id: SubProviderId
  search(q: SubQuery): Promise<SubtitleCandidate[]>   // best-effort, [] on failure
}
