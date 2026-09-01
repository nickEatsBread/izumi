import { get } from 'svelte/store'
import { save } from '@tauri-apps/plugin-dialog'
import { invoke } from '@tauri-apps/api/core'
import { isAndroid } from '$lib/platform'
import { title } from '$lib/anilist/media'
import type { Media } from '$lib/anilist/types'
import { CATALOG_SELECTIONS, type CatalogSelection } from '$lib/settings/catalog'
// durableHistory/durablePositions, NOT the merged views: an export or device-sync push must never
// carry this session's incognito entries; an import writes straight to the persisted stores.
import { durableHistory, historyEntries, type HistoryEntry } from './history'
import { durablePositions, type Pos } from './progress'
import {
  episodeSourceOrigins,
  mergeEpisodeSourceOrigins,
  mergeSourceOrigins,
  sourceOrigins,
  type RememberedSource,
} from './source-origin'
import { localLibrary, mergeLocalLibrary, type LocalLibraryState } from '$lib/library/local-lists'
import { mediaKey } from '$lib/catalog/identity'
import { mergeSeriesTrackPreferences, seriesTrackPreferences, type SeriesTrackPreferences } from './track-preferences'
import { mergeSceneBookmarkRecords, sceneBookmarkRecords, type SceneBookmarkRecords } from './scene-bookmarks'

// Import / export of the on-device watch history, so it can be backed up, moved between installs,
// or used to seed an AniList/MyAnimeList account (or another tracker). Two export formats:
//   • izumi JSON  — full fidelity (history snapshots + resume positions); re-importable here.
//   • MyAnimeList XML — the de-facto interchange format that AniList, MAL and most trackers import,
//     so "set up my account from what I've watched" actually works.

interface ExportBundle {
  app: 'izumi'
  kind: 'watch-history'
  version: 1
  exportedAt: number
  history: Record<number, HistoryEntry>
  positions: Record<string, Pos>
  /** Bounded, credential-free source preferences; always exported even when a tracker owns progress. */
  origins?: Record<number, RememberedSource>
  /** Exact per-episode source preferences used by the default Continue Watching mode. */
  episodeOrigins?: Record<string, RememberedSource>
  /** Account-free saved lists, smart-list inputs, and manual episode queue. */
  localLibrary?: LocalLibraryState
  /** Stable per-series audio/subtitle identities (never credential-bearing URLs). */
  trackPreferences?: Record<string, SeriesTrackPreferences>
  /** Timestamped scenes and deletion tombstones, so removal also propagates between devices. */
  sceneBookmarks?: SceneBookmarkRecords
}

interface WatchJsonOptions {
  /** Trackers own anime-level episode counts, but never exact resume positions. */
  includeHistory?: boolean
}

/** Full izumi backup (history + resume positions) as pretty JSON. */
export function exportJson(options: WatchJsonOptions = {}): string {
  const bundle: ExportBundle = {
    app: 'izumi', kind: 'watch-history', version: 1, exportedAt: Date.now(),
    history: options.includeHistory === false ? {} : get(durableHistory),
    positions: get(durablePositions),
    origins: get(sourceOrigins),
    episodeOrigins: get(episodeSourceOrigins),
    localLibrary: get(localLibrary),
    trackPreferences: get(seriesTrackPreferences),
    sceneBookmarks: get(sceneBookmarkRecords),
  }
  return JSON.stringify(bundle, null, 2)
}

const xmlEscape = (s: string) => s.replace(/]]>/g, ']]]]><![CDATA[>')

/** MyAnimeList-compatible XML (importable into MAL/AniList). Only entries that carry a MAL id can be
 *  exported — MAL keys anime by that id. Returns the XML plus how many entries were skipped. */
export function exportMalXml(): { xml: string; total: number; skipped: number } {
  type ExportEntry = { media: Media; progress: number; status?: string; score?: number }
  const byMedia = new Map<string, ExportEntry>()
  for (const entry of historyEntries(get(durableHistory))) {
    const total = entry.media.episodes ?? 0
    byMedia.set(mediaKey(entry.media), {
      media: entry.media,
      progress: entry.progress,
      status: total > 0 && entry.progress >= total ? 'COMPLETED' : 'CURRENT',
    })
  }
  for (const entry of Object.values(get(localLibrary).entries ?? {})) {
    const tracking = entry.tracking
    if (!tracking && !entry.listIds.includes('watchlist')) continue
    const key = mediaKey(entry.media)
    const previous = byMedia.get(key)
    byMedia.set(key, {
      media: entry.media,
      progress: Math.max(previous?.progress ?? 0, tracking?.progress ?? 0),
      status: tracking?.status ?? previous?.status ?? 'PLANNING',
      score: tracking?.score ?? previous?.score,
    })
  }
  const entries = [...byMedia.values()]
  const withMal = entries.filter((entry) => entry.media.idMal)
  const malStatus = (status?: string) => ({
    CURRENT: 'Watching', REPEATING: 'Watching', PLANNING: 'Plan to Watch',
    COMPLETED: 'Completed', PAUSED: 'On-Hold', DROPPED: 'Dropped',
  }[status ?? 'CURRENT'] ?? 'Watching')
  const items = withMal.map((entry) => {
    const total = entry.media.episodes ?? 0
    return `  <anime>
    <series_animedb_id>${entry.media.idMal}</series_animedb_id>
    <series_title><![CDATA[${xmlEscape(title(entry.media))}]]></series_title>
    <series_episodes>${total}</series_episodes>
    <my_watched_episodes>${entry.progress}</my_watched_episodes>
    <my_score>${Math.round((entry.score ?? 0) / 10)}</my_score>
    <my_status>${malStatus(entry.status)}</my_status>
    <update_on_import>1</update_on_import>
  </anime>`
  }).join('\n')
  const xml = `<?xml version="1.0" encoding="UTF-8" ?>
<myanimelist>
  <myinfo>
    <user_total_anime>${withMal.length}</user_total_anime>
    <user_export_type>1</user_export_type>
  </myinfo>
${items}
</myanimelist>
`
  return { xml, total: entries.length, skipped: entries.length - withMal.length }
}

const num = (v: unknown, fallback = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : fallback)
const str = (v: unknown) => (typeof v === 'string' && v ? v : undefined)
const validCatalogSelection = (value: unknown): CatalogSelection | undefined =>
  typeof value === 'string' && CATALOG_SELECTIONS.includes(value as CatalogSelection)
    ? value as CatalogSelection
    : undefined
// Carry a well-shaped release hint through import (string group/bingeGroup only), else drop it.
function validRelease(r: unknown): HistoryEntry['release'] {
  if (!r || typeof r !== 'object') return undefined
  const group = str((r as Record<string, unknown>).group)
  const bingeGroup = str((r as Record<string, unknown>).bingeGroup)
  return group || bingeGroup ? { group, bingeGroup } : undefined
}

/** Merge an izumi JSON export back into local history + resume positions. Malformed entries are
 *  skipped (never poison the store). Existing entries are kept if they're further along (higher
 *  progress / later timestamp). Returns how many merged. */
export function importJson(text: string, options: WatchJsonOptions = {}): {
  imported: number
  positionsImported: number
  originsImported: number
  episodeOriginsImported: number
  sceneBookmarksImported: number
} {
  const data = JSON.parse(text) as Partial<ExportBundle>
  if (data.app !== 'izumi' || data.kind !== 'watch-history' || !data.history || typeof data.history !== 'object') {
    throw new Error('Not an izumi watch-history export.')
  }
  let imported = 0
  if (options.includeHistory !== false) {
    const incoming = data.history
    const next = { ...get(durableHistory) }
    for (const [k, raw] of Object.entries(incoming)) {
      const id = Number(k)
      // Reject non-numeric keys, mismatched ids, and non-object entries — a hostile/corrupt file
      // must not create a `NaN` bucket or a card with `Ep NaN` / an "Invalid Date" row.
      if (!Number.isInteger(id) || !raw || typeof raw !== 'object' || (raw as HistoryEntry).media?.id !== id) continue
      const e: HistoryEntry = {
        media: (raw as HistoryEntry).media,
        episode: Math.max(0, Math.trunc(num((raw as HistoryEntry).episode))),
        progress: Math.max(0, Math.trunc(num((raw as HistoryEntry).progress))),
        updatedAt: num((raw as HistoryEntry).updatedAt),
        catalogSelection: validCatalogSelection((raw as HistoryEntry).catalogSelection),
        release: validRelease((raw as HistoryEntry).release),
      }
      const cur = next[id]
      // Keep whichever is further along; break ties by the newer timestamp.
      if (!cur || e.progress > cur.progress || (e.progress === cur.progress && e.updatedAt > cur.updatedAt)) {
        next[id] = e
        imported++
      }
    }
    if (imported) durableHistory.set(next)
  }
  let positionsImported = 0
  if (data.positions && typeof data.positions === 'object') {
    const current = get(durablePositions)
    const next = { ...current }
    for (const [k, v] of Object.entries(data.positions)) {
      // Only accept well-shaped {pos, dur} numbers — a string pos would flow into player_embed.
      if (v && typeof v === 'object' && typeof (v as Pos).pos === 'number' && typeof (v as Pos).dur === 'number') {
        const incomingAt = num((v as Pos).updatedAt)
        const currentAt = num(current[k]?.updatedAt)
        // Timestamped records are last-write-wins per episode. Legacy backups
        // had no timestamp, so retain their fill-empty-only behavior.
        if (!current[k] || (incomingAt > 0 && incomingAt > currentAt)) {
          next[k] = {
            pos: (v as Pos).pos,
            dur: (v as Pos).dur,
            ...(incomingAt > 0 ? { updatedAt: incomingAt } : {}),
            ...((v as Pos).cleared === true ? { cleared: true as const } : {}),
          }
          positionsImported++
        }
      }
    }
    if (positionsImported) durablePositions.set(next)
  }
  const originsImported = mergeSourceOrigins(data.origins)
  const episodeOriginsImported = mergeEpisodeSourceOrigins(data.episodeOrigins)
  if (data.localLibrary && typeof data.localLibrary === 'object' && Array.isArray(data.localLibrary.lists) && data.localLibrary.entries && typeof data.localLibrary.entries === 'object') {
    localLibrary.update((current) => {
      const merged = mergeLocalLibrary(current, data.localLibrary!)
      // Preserve the store identity when a peer only echoed our latest snapshot. This prevents
      // the sync subscriber from scheduling an otherwise endless push/pull feedback loop.
      return JSON.stringify(merged) === JSON.stringify(current) ? current : merged
    })
  }
  mergeSeriesTrackPreferences(data.trackPreferences)
  const sceneBookmarksImported = mergeSceneBookmarkRecords(data.sceneBookmarks)
  return { imported, positionsImported, originsImported, episodeOriginsImported, sceneBookmarksImported }
}

/** Tauri rejects with a plain STRING — permission denials, IO errors, everything — never an Error.
 *  Call sites that tested `error instanceof Error` therefore threw away the only useful part of
 *  every backend failure and printed their generic fallback instead. That is how a capability file
 *  missing `dialog:allow-save` surfaced as "Backup failed." with nothing to act on. */
export function ioErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) return error.message
  const text = typeof error === 'string' ? error.trim() : ''
  return text || fallback
}

/** Prompt for a location and write the given text there. Returns false if the user cancelled.
 *
 *  Android cannot split picker + write: `dialog.save()` returns a `content://` URI, and
 *  writing it from Rust via JNI against the Activity pointer crashes the process. The
 *  native `save_text_file` command opens ACTION_CREATE_DOCUMENT and copies a cache file
 *  in the activity result, so the document is written even if the picker recreates us. */
export async function saveTextFile(defaultName: string, contents: string): Promise<boolean> {
  if (get(isAndroid)) {
    const mime = defaultName.endsWith('.xml') ? 'text/xml' : 'application/json'
    const result = await invoke<{ saved: boolean }>('plugin:extplayer|save_text_file', {
      payload: { fileName: defaultName, mime, contents },
    })
    return !!result?.saved
  }
  const path = await save({
    defaultPath: defaultName,
    filters: defaultName.endsWith('.xml')
      ? [{ name: 'XML', extensions: ['xml'] }]
      : [{ name: 'JSON', extensions: ['json'] }],
  })
  if (!path) return false
  await invoke('write_text_file', { path, contents })
  return true
}
