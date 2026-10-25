import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8').replace(/\r\n/g, '\n')

// ☰ on a catalog title page opens the page's own side menu (watchlist, lists, trackers, downloads),
// the way it opens the player's; elsewhere it still opens the drawer navigation.
describe('catalog title page options menu', () => {
  const detail = read('./CatalogMediaDetail.svelte')
  const gamepad = read('../../nav/gamepad.ts')

  it('lets a page claim ☰ before the drawer navigation does', () => {
    const start = gamepad.slice(gamepad.indexOf("case 'start': {"))
    expect(start.indexOf('PAGE_OPTIONS_EVENT')).toBeGreaterThan(-1)
    expect(start.indexOf('PAGE_OPTIONS_EVENT')).toBeLessThan(start.indexOf('drawer'))
    expect(detail).toContain('window.addEventListener(PAGE_OPTIONS_EVENT, claim)')
    expect(detail).toContain('event.preventDefault()\n      openOptions()')
  })

  it('opens from a visible More button too', () => {
    expect(detail).toContain('data-action="more" data-focusable onclick={openOptions}')
  })

  it('offers the focused episode, the lists, the trackers and the downloads', () => {
    for (const option of ['play-episode', 'download-episode', 'watchlist', 'lists', 'tracker', 'download-season', 'download-all']) {
      expect(detail).toContain(`id: '${option}'`)
    }
    expect(detail).toContain("document.activeElement?.closest<HTMLElement>('[data-part=\"episode\"][data-episode]')")
  })

  it('only queues episodes this device does not have yet', () => {
    expect(detail).toContain('enqueueMany(media, saveable(all).map((video) => video.number))')
    expect(detail).toContain("const saveable = (list: MediaVideo[]) => list.filter((video) => !downloadState(video) || downloadState(video) === 'error')")
  })

  it('finds a source title on AniList before opening the list editor', () => {
    expect(detail).toContain('const match = await findAnilistMatch(urql, media)')
    expect(detail).toContain('<MediaListSheet media={trackerMedia}')
  })
})

describe('catalog title page while it loads', () => {
  const detail = read('./CatalogMediaDetail.svelte')

  it('draws the page shape with the opening card\'s art and title', () => {
    expect(detail).toContain('{@const hint = $detailHints[compatibilityMediaId(ref)]}')
    for (const part of ['detail.skeleton.banner', 'detail.skeleton.copy', 'detail.skeleton.title', 'detail.skeleton.line', 'detail.skeleton.button', 'detail.skeleton.episodes', 'detail.skeleton.episode']) {
      expect(detail).toContain(`data-part="${part}"`)
    }
    expect(detail).toContain('data-part="detail.skeleton.title" data-state="known"')
  })
})
