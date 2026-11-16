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
    expect(detail).toContain('data-action="more" data-focusable data-nav-scroll-top onclick={openOptions}')
  })

  it('offers the focused episode, the lists, the trackers and the downloads', () => {
    for (const option of ['play-episode', 'download-episode', 'watchlist', 'lists', 'tracker', 'download-season', 'download-all']) {
      expect(detail).toContain(`id: '${option}'`)
    }
    expect(detail).toContain("document.activeElement?.closest<HTMLElement>('[data-part=\"episode\"][data-episode]')")
  })

  it('only queues episodes this device does not have yet', () => {
    // With the Settings → Downloads defaults (quality, audio), as every other download button.
    expect(detail).toContain('startDownload(media, saveable(all).map((video) => video.number), currentDownloadPreferences())')
    expect(detail).toContain('startDownload(media, episode.number, currentDownloadPreferences())')
    expect(detail).toContain("const saveable = (list: MediaVideo[]) => list.filter((video) => !downloadState(video) || downloadState(video) === 'error')")
  })

  it('closes after a choice, focus back on what opened it; only the AniList lookup stays to report', () => {
    // A download turns its own item disabled while focused: left open, the d-pad was stranded.
    const sheet = read('../detail/OptionsSheet.svelte')
    expect(sheet).toContain('option.onselect(); if (!option.keepOpen) onclose()')
    expect(detail.match(/keepOpen: true/g)).toHaveLength(1)
    expect(detail).toContain("id: 'tracker', label: 'Track on AniList / MyAnimeList', detail: trackerNote || undefined, icon: ListChecks, keepOpen: true")
  })

  it('opens the AniList entry the source names for the episode, else finds the title by name', () => {
    expect(detail).toContain('const tracked = (optionsEpisode ?? upNext?.video)?.track ?? videos.find((video) => video.track)?.track')
    expect(detail).toContain('? await fetchMediaById(tracked.anilist).catch(() => null)')
    expect(detail).toContain(': await findAnilistMatch(urql, media).catch(() => null)')
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

describe('catalog title page downloads on each episode', () => {
  const detail = read('./CatalogMediaDetail.svelte')

  it('shows waiting, downloading, paused, saved and failed apart, with progress while it downloads', () => {
    for (const icon of ["state === 'done'}<CircleCheck", "state === 'progress'}<Download", "state === 'paused'}<Pause", "state === 'queued'}<Clock", '{:else}<CircleAlert']) expect(detail).toContain(icon)
    expect(detail).toContain("{#if state === 'progress' || state === 'paused'}")
    expect(detail).toContain('data-part="episode.saved.progress"')
    expect(detail).toContain('style:--download-progress={`${percent}%`}')
  })
})
