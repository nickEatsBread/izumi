import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import type { DownloadItem } from '$lib/downloads/state'
import { bulkTargets, groupDownloads, lowOnSpace, neighbourOf, primaryActionOf } from './group'

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

describe('Downloads bulk actions', () => {
  const items = [
    item(1, 1, { status: 'downloading' }),
    item(1, 2, { status: 'queued' }),
    item(1, 3, { status: 'paused' }),
    item(1, 4, { status: 'error' }),
    item(1, 5, { status: 'done' }),
    item(1, 6, { status: 'done', cleared: true }),
    item(2, 1, { status: 'downloading', kind: 'drm-local' }),
    item(2, 2, { status: 'queued', kind: 'shaka' }),
  ]

  it('pauses running and queued episodes, queued first, and leaves a protected save that would restart', () => {
    expect(bulkTargets(items).pause).toEqual(['1:2', '1:1'])
  })

  it('resumes the paused ones', () => {
    expect(bulkTargets(items).resume).toEqual(['1:3'])
  })

  it('cancels everything not yet saved, queued first, protected saves included', () => {
    expect(bulkTargets(items).cancel).toEqual(['1:2', '2:2', '1:1', '1:3', '1:4', '2:1'])
  })

  it('clears saved episodes still on the list, and counts the ones already cleared', () => {
    expect(bulkTargets(items)).toMatchObject({ clear: ['1:5'], cleared: 1 })
  })

  it('has nothing to do on an empty or all-saved list', () => {
    expect(bulkTargets([])).toEqual({ pause: [], resume: [], cancel: [], clear: [], cleared: 0 })
    expect(bulkTargets([item(1, 1)])).toMatchObject({ pause: [], resume: [], cancel: [], clear: ['1:1'] })
  })

  it('keeps cleared episodes off the list until they are asked for', () => {
    const list = [item(1, 1), item(1, 2, { cleared: true })]
    expect(groupDownloads(list)[0].items.map((d) => d.id)).toEqual(['1:1'])
    expect(groupDownloads(list, '', true)[0].items.map((d) => d.id)).toEqual(['1:1', '1:2'])
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

  it('reaches every bulk action with the d-pad and runs it through the per-episode actions', () => {
    const bar = page.slice(page.indexOf('data-part="downloads.bulk"'), page.indexOf('{#if !groups.length}'))
    for (const action of ['pause', 'resume', 'cancel', 'clear', 'show-cleared']) {
      const at = bar.indexOf(`data-bulk="${action}"`)
      expect(at, action).toBeGreaterThan(0)
      expect(bar.slice(bar.lastIndexOf('<button', at), at), action).toContain('data-focusable')
    }
    expect(bar).toContain('aria-disabled={!bulk.pause.length || undefined}')
    expect(bar).toContain('runBulk(bulk.pause, pauseDownload)')
    expect(bar).toContain('runBulk(bulk.resume, resumeDownload)')
    // Cancel asks first: it deletes what each episode has downloaded so far.
    expect(bar).toContain('confirmCancel = true')
    expect(page).toContain('runBulk(bulk.cancel, cancelDownload)')
    expect(page).toContain('if (bulkBusy || starting || !ids.length) return')
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
