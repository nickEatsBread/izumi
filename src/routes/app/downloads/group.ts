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
 *  only moves when its series gains an episode, never as its download progresses under focus.
 *  Episodes taken off the list by Clear finished stay out unless `cleared` asks for them. */
export function groupDownloads(items: DownloadItem[], filter = '', cleared = false): DownloadGroup[] {
  const query = filter.trim().toLowerCase()
  const groups = new Map<number, DownloadGroup>()
  for (const d of items) {
    if (d.cleared && !cleared) continue
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

/** A pause keeps what has arrived. A protected episode saved through the module or the Shaka store
 *  would start over, so it is only cancelled. */
export const canPause = (d: DownloadItem) => d.kind !== 'drm-local' && d.kind !== 'shaka'

export type PrimaryAction = 'play' | 'pause' | 'resume' | 'retry' | 'options'
export const PRIMARY_LABEL: Record<PrimaryAction, string> = { play: 'Play', pause: 'Pause', resume: 'Resume', retry: 'Retry', options: 'Options' }

/** What A does on a row. A queued episode has nothing to start yet, so A opens its options (Cancel),
 *  as does one downloading that cannot pause. */
export function primaryActionOf(d: DownloadItem): PrimaryAction {
  switch (d.status) {
    case 'done': return 'play'
    case 'downloading': return canPause(d) ? 'pause' : 'options'
    case 'paused': return 'resume'
    case 'error': return 'retry'
    default: return 'options'
  }
}

/** What each bulk action at the top of the page acts on, as ids in the order to act. Queued episodes
 *  come first in Pause all and Cancel all pending, so none starts in the slot a running one frees. A
 *  protected save that would start over keeps running under Pause all (it can only be cancelled). */
export function bulkTargets(items: DownloadItem[]) {
  const ids = (keep: (d: DownloadItem) => boolean) => items.filter(keep).map((d) => d.id)
  const queued = (d: DownloadItem) => d.status === 'queued'
  return {
    pause: [...ids((d) => queued(d) && canPause(d)), ...ids((d) => d.status === 'downloading' && canPause(d))],
    resume: ids((d) => d.status === 'paused'),
    cancel: [...ids(queued), ...ids((d) => d.status !== 'done' && !queued(d))],
    clear: ids((d) => d.status === 'done' && !d.cleared),
    cleared: ids((d) => d.status === 'done' && !!d.cleared).length,
  }
}

/** The row focus moves to when `id` leaves the list: the next one, else the one before, else none
 *  (the empty state). */
export function neighbourOf(groups: DownloadGroup[], id: string): string | null {
  const ids = groups.flatMap((group) => group.items.map((d) => d.id))
  const at = ids.indexOf(id)
  return at < 0 ? null : ids[at + 1] ?? ids[at - 1] ?? null
}

/** Under 2 GB, or 5% of the drive, free reads as low: another episode or two could fill it. */
export const lowOnSpace = ({ free, total }: { free: number, total: number }) => free < 2 * 1024 ** 3 || free < total * 0.05
