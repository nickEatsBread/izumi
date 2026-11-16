import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import type { DownloadItem } from '$lib/downloads/state'
import { groupDownloads, lowOnSpace, neighbourOf, primaryActionOf } from './group'

const item = (mediaId: number, episode: number, patch: Partial<DownloadItem> = {}): DownloadItem => ({
  id: `${mediaId}:${episode}`, mediaId, episode, title: `Show ${mediaId} — E${episode}`,
  bytes: 100, downloaded: 40, status: 'done', addedAt: episode, ...patch,
})

describe('Downloads grouping', () => {
  const items = [
    item(1, 3, { addedAt: 10 }),
    item(2, 1, { addedAt: 5, status: 'downloading', poster: 'p2' }),
    item(1, 1, { addedAt: 2, poster: 'p1' }),
    item(2, 2, { addedAt: 1, status: 'queued', downloaded: 0 }),
  ]

  it('groups by series, newest series first, episodes in order, with the size on disk', () => {
    const groups = groupDownloads(items)
    expect(groups.map((g) => g.title)).toEqual(['Show 1', 'Show 2'])
    expect(groups[0].items.map((d) => d.episode)).toEqual([1, 3])
    expect(groups[0]).toMatchObject({ poster: 'p1', bytes: 200 })
    // A download still running counts what has arrived, not the whole file.
    expect(groups[1].bytes).toBe(40)
  })

  it('filters by title', () => {
    expect(groupDownloads(items, ' show 2 ').map((g) => g.mediaId)).toEqual([2])
    expect(groupDownloads(items, 'nothing')).toEqual([])
  })

  it('gives each state one primary action', () => {
    expect(['done', 'downloading', 'paused', 'error', 'queued'].map((status) => primaryActionOf(item(1, 1, { status: status as DownloadItem['status'] }))))
      .toEqual(['play', 'pause', 'resume', 'retry', 'options'])
  })

  it('offers no pause for a protected save that would start over: it can only be cancelled', () => {
    for (const kind of ['drm-local', 'shaka'] as const) {
      expect(primaryActionOf(item(1, 1, { status: 'downloading', kind }))).toBe('options')
    }
    for (const kind of ['http', 'torrent', 'drm', undefined] as const) {
      expect(primaryActionOf(item(1, 1, { status: 'downloading', kind }))).toBe('pause')
    }
  })

  it('moves focus to the next row, else the one before, else the empty state', () => {
    const groups = groupDownloads(items)
    expect(neighbourOf(groups, '1:3')).toBe('2:1')
    expect(neighbourOf(groups, '2:2')).toBe('2:1')
    expect(neighbourOf(groupDownloads([item(1, 1)]), '1:1')).toBeNull()
  })

  it('warns when under 2 GB or 5% of the drive is free', () => {
    const GB = 1024 ** 3
    expect(lowOnSpace({ free: 1.5 * GB, total: 1000 * GB })).toBe(true)
    expect(lowOnSpace({ free: 10 * GB, total: 500 * GB })).toBe(true)
    expect(lowOnSpace({ free: 10 * GB, total: 100 * GB })).toBe(false)
    expect(lowOnSpace({ free: 3 * GB, total: 50 * GB })).toBe(false)
  })
})

describe('Downloads controller contract', () => {
  const page = readFileSync(fileURLToPath(new URL('./+page.svelte', import.meta.url)), 'utf8')

  it('never disables a row action under focus: aria-disabled plus a guard instead', () => {
    expect(page).not.toMatch(/\sdisabled(=|\s*\/?>)|\{disabled\}/)
    const action = page.slice(page.indexOf('data-part="downloads.action"'), page.indexOf('onclick={() => primary(d)}'))
    expect(action).toContain('aria-disabled={busy || undefined}')
    expect(page).toContain('if (starting) return')
  })

  it('opens the options sheet from ☰ on a row', () => {
    expect(page).toContain('window.addEventListener(PAGE_OPTIONS_EVENT, claim)')
    expect(page).toContain('<OptionsSheet')
  })

  it('shows free space only once the drive could be read', () => {
    expect(page).toContain('{#if space}')
    expect(page).toContain('lowOnSpace(space)')
  })
})
