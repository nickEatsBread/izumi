import type { DownloadItem } from '$lib/downloads/state'

// The Downloads page's pure logic: series groups, what A does on a row, and where focus goes when
// a row leaves. Kept out of the page so it can be tested without a DOM.

export interface DownloadGroup {
  mediaId: number
  title: string
  poster?: string
  items: DownloadItem[]
  /** What the series takes on this device. */
  bytes: number
  /** The newest episode added, which orders the series. */
  latest: number
}

/** Bytes on disk: the whole file once saved, else what has arrived so far. */
export const sizeOnDisk = (d: DownloadItem) => (d.status === 'done' ? d.bytes : d.downloaded) || 0

// enqueue names every item "<series> — E<n>".
export const seriesTitle = (d: DownloadItem) => d.title.replace(/\s+—\s+E\d+$/, '')

/** Downloads by series, the series with the newest episode first, episodes in number order. A row
 *  only moves when its series gains an episode, never as its download progresses under focus. */
export function groupDownloads(items: DownloadItem[], filter = ''): DownloadGroup[] {
  const query = filter.trim().toLowerCase()
  const groups = new Map<number, DownloadGroup>()
  for (const d of items) {
    if (query && !d.title.toLowerCase().includes(query)) continue
    let group = groups.get(d.mediaId)
    if (!group) groups.set(d.mediaId, (group = { mediaId: d.mediaId, title: seriesTitle(d), items: [], bytes: 0, latest: 0 }))
    group.items.push(d)
    group.bytes += sizeOnDisk(d)
    group.latest = Math.max(group.latest, d.addedAt)
    group.poster ??= d.poster
  }
  const list = [...groups.values()].sort((a, b) => b.latest - a.latest)
  for (const group of list) group.items.sort((a, b) => a.episode - b.episode)
  return list
}

export type PrimaryAction = 'play' | 'pause' | 'resume' | 'retry' | 'options'
export const PRIMARY_LABEL: Record<PrimaryAction, string> = { play: 'Play', pause: 'Pause', resume: 'Resume', retry: 'Retry', options: 'Options' }

/** What A does on a row. A queued episode has nothing to start yet, so A opens its options (Cancel). */
export function primaryActionOf(d: DownloadItem): PrimaryAction {
  switch (d.status) {
    case 'done': return 'play'
    case 'downloading': return 'pause'
    case 'paused': return 'resume'
    case 'error': return 'retry'
    default: return 'options'
  }
}

/** The row focus moves to when `id` leaves the list: the next one, else the one before, else none
 *  (the empty state). */
export function neighbourOf(groups: DownloadGroup[], id: string): string | null {
  const ids = groups.flatMap((group) => group.items.map((d) => d.id))
  const at = ids.indexOf(id)
  return at < 0 ? null : ids[at + 1] ?? ids[at - 1] ?? null
}
