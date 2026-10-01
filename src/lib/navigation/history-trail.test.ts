// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { HISTORY_INDEX, TRAIL_CAP, TRAIL_STORAGE_KEY, historyIndex, previousPath, recordTrail, resetHistoryTrail, settingsOrigin, stepsBackTo } from './history-trail'

/** Stand in for SvelteKit: put the entry index where its client keeps it, then record the visit. */
function visit(index: number, path: string, type = 'link') {
  history.replaceState({ [HISTORY_INDEX]: index }, '', path)
  recordTrail(path, type)
}
const saved = () => JSON.parse(sessionStorage.getItem(TRAIL_STORAGE_KEY) ?? 'null') as { entries: Record<string, string> } | null

beforeEach(() => {
  resetHistoryTrail()
  sessionStorage.clear()
  history.replaceState(null, '', '/')
})

describe('history trail', () => {
  it('uses the history-state key SvelteKit writes', () => {
    // A cwd-relative path: in a jsdom file Vite rewrites `new URL(…, import.meta.url)` to a web URL.
    const kit = readFileSync('node_modules/@sveltejs/kit/src/runtime/client/constants.js', 'utf8')
    expect(HISTORY_INDEX).toBe('sveltekit:history')
    expect(kit).toContain("export const HISTORY_INDEX = 'sveltekit:history'")
  })

  it('reads the index only when it is a finite number', () => {
    expect(historyIndex({ [HISTORY_INDEX]: 7 })).toBe(7)
    expect(historyIndex({})).toBeNull()
    expect(historyIndex(null)).toBeNull()
    expect(historyIndex({ [HISTORY_INDEX]: 'x' })).toBeNull()
    expect(historyIndex({ [HISTORY_INDEX]: Infinity })).toBeNull()
  })

  it('knows the previous page after pushes, and after a replace', () => {
    visit(1, '/app/home')
    visit(2, '/app/settings/sources?tab=ordering')
    visit(3, '/app/settings/sources/priority')
    expect(previousPath()).toBe('/app/settings/sources?tab=ordering')
    visit(3, '/app/settings/catalog', 'goto') // a replace keeps the index
    expect(previousPath()).toBe('/app/settings/sources?tab=ordering')
  })

  it('walks back and forward on history steps', () => {
    visit(1, '/app/home'); visit(2, '/app/series/9'); visit(3, '/app/watch/9')
    visit(2, '/app/series/9', 'popstate')
    expect(previousPath()).toBe('/app/home')
    visit(3, '/app/watch/9', 'popstate')
    expect(previousPath()).toBe('/app/series/9')
  })

  it('drops the forward entries when a new page is pushed over them', () => {
    visit(1, '/app/home'); visit(2, '/app/series/9'); visit(3, '/app/watch/9'); visit(4, '/app/series/10')
    visit(2, '/app/series/9', 'popstate')
    visit(3, '/app/search')
    expect(saved()?.entries).toEqual({ 1: '/app/home', 2: '/app/series/9', 3: '/app/search' })
  })

  it('counts the steps back to the first page that matches, and stops at a gap', () => {
    visit(1, '/app/home'); visit(2, '/app/settings/player'); visit(3, '/app/settings/sources'); visit(4, '/app/settings/sources/priority')
    expect(stepsBackTo((path) => !path.startsWith('/app/settings'))).toBe(3)
    visit(6, '/app/settings/about') // index 5 was never recorded
    expect(stepsBackTo((path) => !path.startsWith('/app/settings'))).toBeNull()
    expect(previousPath()).toBeNull()
  })

  it('knows nothing while history sits on an entry it did not record (a shallow Back trap)', () => {
    visit(1, '/app/home'); visit(2, '/app/settings/player')
    history.pushState({ [HISTORY_INDEX]: 3 }, '', '/app/settings/player')
    expect(previousPath()).toBeNull()
    expect(stepsBackTo(() => true)).toBeNull()
  })

  it('remembers where Settings was entered from', () => {
    visit(1, '/app/series/9')
    visit(2, '/app/settings/accounts')
    visit(3, '/app/settings/profiles')
    expect(settingsOrigin()).toBe('/app/series/9')
    visit(4, '/app/home'); visit(5, '/app/settings')
    expect(settingsOrigin()).toBe('/app/home')
  })

  it('survives a reload: the trail is read back from sessionStorage', async () => {
    visit(1, '/app/home'); visit(2, '/app/settings/backup')
    expect(sessionStorage.getItem(TRAIL_STORAGE_KEY)).toContain('/app/settings/backup')
    vi.resetModules()
    const fresh = await import('./history-trail')
    expect(fresh.previousPath()).toBe('/app/home')
    expect(fresh.settingsOrigin()).toBe('/app/home')
    expect(fresh.stepsBackTo((path) => path === '/app/home')).toBe(1)
  })

  it('starts fresh from a corrupt saved trail', async () => {
    sessionStorage.setItem(TRAIL_STORAGE_KEY, '{not json')
    vi.resetModules()
    const fresh = await import('./history-trail')
    history.replaceState({ [HISTORY_INDEX]: 1 }, '', '/app/home')
    expect(fresh.previousPath()).toBeNull()
    expect(fresh.settingsOrigin()).toBeNull()
  })

  it('keeps at most TRAIL_CAP entries', () => {
    for (let index = 1; index <= TRAIL_CAP + 20; index++) visit(index, `/app/page/${index}`)
    expect(Object.keys(saved()?.entries ?? {})).toHaveLength(TRAIL_CAP)
    expect(saved()?.entries['1']).toBeUndefined()
    expect(previousPath()).toBe(`/app/page/${TRAIL_CAP + 19}`)
  })
})
