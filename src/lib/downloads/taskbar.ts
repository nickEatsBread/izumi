import type { DownloadItem } from './state'

export type DownloadTaskbarProgress =
  | { status: 'none' }
  | { status: 'indeterminate' }
  | { status: 'normal'; progress: number }

type ProgressItem = Pick<DownloadItem, 'status' | 'bytes' | 'downloaded'>

/** Aggregate currently active episode downloads into one native taskbar indicator. */
export function downloadTaskbarProgress(items: ProgressItem[]): DownloadTaskbarProgress {
  const active = items.filter((item) => item.status === 'downloading')
  if (!active.length) return { status: 'none' }
  if (active.some((item) => item.bytes <= 0)) return { status: 'indeterminate' }

  const total = active.reduce((sum, item) => sum + item.bytes, 0)
  const received = active.reduce(
    (sum, item) => sum + Math.min(Math.max(0, item.downloaded), item.bytes),
    0,
  )
  // Do not show 100% while a job is still active; completion clears the indicator immediately.
  return { status: 'normal', progress: Math.min(99, Math.floor((received / total) * 100)) }
}
