import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8').replace(/\r\n/g, '\n')

describe('loading screens (API 8) are mounted where each wait happens', () => {
  it('covers a pending series page and a loading catalog title page with the title screen', () => {
    const series = read('../detail/AnimeDetail.svelte')
    expect(series).toContain('<LoadingScreen screen={titleScreen} loading={pending} variant="series" model={titleScreenModel}')
    expect(series).toContain('const titleScreen = $derived($themePresentation?.loading?.title)')
    const catalog = read('../catalog/CatalogMediaDetail.svelte')
    expect(catalog).toContain('<LoadingScreen screen={titleScreen} {loading} variant="catalog"')
  })

  it('draws the episode screen on the opening screen, then on the player cover until the first frame', () => {
    const opening = read('../player/SourceConnecting.svelte')
    const playerBranch = opening.slice(opening.indexOf('data-variant="player"'))
    expect(playerBranch).toContain('<LoadingScreen screen={episodeScreen} episode loading variant="opening"')
    // Under the ring and Back: earlier in the markup.
    expect(playerBranch.indexOf('<LoadingScreen')).toBeLessThan(playerBranch.indexOf('data-part="play.connecting.back"'))
    // The Android watch page and Game mode's mid-playback switch card draw none.
    expect(opening.slice(0, opening.indexOf('data-variant="player"'))).not.toContain('<LoadingScreen')
    const player = read('../player/PlayerOverlay.svelte')
    expect(player).toContain('<LoadingScreen screen={episodeScreen} episode loading={!firstFrame} variant="player"')
    expect(player.indexOf('<LoadingScreen')).toBeLessThan(player.indexOf('<!-- Loading/buffering.'))
    expect(player).toContain('const episodeCover = $derived(!!episodeScreen && !!$nowPlayingMedia && !(gmBitmapMode && $gmFrozenFrame != null))')
    // The loading layers over it stop painting their own black, or the screen would sit under a black box.
    expect(player).toContain('class:bg-black={!firstFrame && !episodeCover}')
    expect(player).toContain('justify-center" class:bg-black={!episodeCover}>')
  })

  it('animates nothing itself and holds the exit with data-state="done"', () => {
    const screen = read('./LoadingScreen.svelte')
    expect(screen).toContain("data-state={phase === 'done' ? 'done' : 'loading'}")
    expect(screen).toContain('style:--loading-elapsed={elapsed}')
    expect(screen).not.toMatch(/transition:|animate:|in:|out:|requestAnimationFrame/)
  })
})
