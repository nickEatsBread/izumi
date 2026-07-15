import { get } from 'svelte/store'
import { save } from '@tauri-apps/plugin-dialog'
import { invoke } from '@tauri-apps/api/core'
import { title } from '$lib/anilist/media'
import { localHistory, historyEntries, type HistoryEntry } from './history'
import { positions, type Pos } from './progress'

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
}

interface WatchJsonOptions {
  /** Trackers own anime-level episode counts, but never exact resume positions. */
  includeHistory?: boolean
}

/** Full izumi backup (history + resume positions) as pretty JSON. */
export function exportJson(options: WatchJsonOptions = {}): string {
  const bundle: ExportBundle = {
    app: 'izumi', kind: 'watch-history', version: 1, exportedAt: Date.now(),
    history: options.includeHistory === false ? {} : get(localHistory),
    positions: get(positions),
  }
  return JSON.stringify(bundle, null, 2)
}

const xmlEscape = (s: string) => s.replace(/]]>/g, ']]]]><![CDATA[>')

/** MyAnimeList-compatible XML (importable into MAL/AniList). Only entries that carry a MAL id can be
 *  exported — MAL keys anime by that id. Returns the XML plus how many entries were skipped. */
export function exportMalXml(): { xml: string; total: number; skipped: number } {
  const entries = historyEntries(get(localHistory))
  const withMal = entries.filter((e) => e.media.idMal)
  const items = withMal.map((e) => {
    const total = e.media.episodes ?? 0
    const done = total > 0 && e.progress >= total
    return `  <anime>
    <series_animedb_id>${e.media.idMal}</series_animedb_id>
    <series_title><![CDATA[${xmlEscape(title(e.media))}]]></series_title>
    <series_episodes>${total}</series_episodes>
    <my_watched_episodes>${e.progress}</my_watched_episodes>
    <my_status>${done ? 'Completed' : 'Watching'}</my_status>
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
export function importJson(text: string, options: WatchJsonOptions = {}): { imported: number; positionsImported: number } {
  const data = JSON.parse(text) as Partial<ExportBundle>
  if (data.app !== 'izumi' || data.kind !== 'watch-history' || !data.history || typeof data.history !== 'object') {
    throw new Error('Not an izumi watch-history export.')
  }
  let imported = 0
  if (options.includeHistory !== false) {
    const incoming = data.history
    const next = { ...get(localHistory) }
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
        release: validRelease((raw as HistoryEntry).release),
      }
      const cur = next[id]
      // Keep whichever is further along; break ties by the newer timestamp.
      if (!cur || e.progress > cur.progress || (e.progress === cur.progress && e.updatedAt > cur.updatedAt)) {
        next[id] = e
        imported++
      }
    }
    if (imported) localHistory.set(next)
  }
  let positionsImported = 0
  if (data.positions && typeof data.positions === 'object') {
    const current = get(positions)
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
    if (positionsImported) positions.set(next)
  }
  return { imported, positionsImported }
}

/** Prompt for a location and write the given text there. Returns false if the user cancelled. */
export async function saveTextFile(defaultName: string, contents: string): Promise<boolean> {
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
