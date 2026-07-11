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

/** Full izumi backup (history + resume positions) as pretty JSON. */
export function exportJson(): string {
  const bundle: ExportBundle = {
    app: 'izumi', kind: 'watch-history', version: 1, exportedAt: Date.now(),
    history: get(localHistory), positions: get(positions),
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

/** Merge an izumi JSON export back into local history + resume positions. Malformed entries are
 *  skipped (never poison the store). Existing entries are kept if they're further along (higher
 *  progress / later timestamp). Returns how many merged. */
export function importJson(text: string): { imported: number } {
  const data = JSON.parse(text) as Partial<ExportBundle>
  if (data.app !== 'izumi' || data.kind !== 'watch-history' || !data.history || typeof data.history !== 'object') {
    throw new Error('Not an izumi watch-history export.')
  }
  const incoming = data.history
  let imported = 0
  localHistory.update((h) => {
    const next = { ...h }
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
      }
      const cur = next[id]
      // Keep whichever is further along; break ties by the newer timestamp.
      if (!cur || e.progress > cur.progress || (e.progress === cur.progress && e.updatedAt > cur.updatedAt)) {
        next[id] = e
        imported++
      }
    }
    return next
  })
  if (data.positions && typeof data.positions === 'object') {
    positions.update((p) => {
      const next = { ...p }
      for (const [k, v] of Object.entries(data.positions!)) {
        // Only accept well-shaped {pos, dur} numbers — a string pos would flow into player_embed.
        if (v && typeof v === 'object' && typeof (v as Pos).pos === 'number' && typeof (v as Pos).dur === 'number' && !next[k]) {
          next[k] = { pos: (v as Pos).pos, dur: (v as Pos).dur }
        }
      }
      return next
    })
  }
  return { imported }
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
