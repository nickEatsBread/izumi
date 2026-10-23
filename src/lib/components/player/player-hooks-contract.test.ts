import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const read = (relative: string) => readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8')

/** Every `<button …>` opening tag in `source`, scanned past `{…}` so `=>` never ends a tag early. */
function buttonTags(source: string): string[] {
  const tags: string[] = []
  for (let at = source.indexOf('<button'); at !== -1; at = source.indexOf('<button', at + 1)) {
    let depth = 0
    let end = at
    for (; end < source.length; end++) {
      const c = source[end]
      if (c === '{') depth++
      else if (c === '}') depth--
      else if (c === '>' && depth === 0) break
    }
    tags.push(source.slice(at, end + 1))
  }
  return tags
}

describe('player styling hooks', () => {
  const controls = read('./Controls.svelte')
  // The popovers hold menu entries, not controls, so they are cut out first.
  const rowButtons = () => buttonTags(controls
    .slice(controls.indexOf('data-slot="player.controls"'), controls.indexOf('data-gm-menu-surface'))
    .replace(/data-options-menu[\s\S]*?<!-- Discussion/, '')
    .replace(/\{#if showTracks\}[\s\S]*?\{#if \$subtitleLineNavigation\}/, ''))

  it('hooks the bars, the heading and the row groups', () => {
    for (const part of ['top', 'bottom', 'heading', 'episode', 'row', 'transport', 'actions', 'time', 'volume']) {
      expect(controls).toContain(`data-part="player.${part}"`)
    }
  })

  it('names every control in the row', () => {
    const names = ['back', 'previous', 'play', 'next', 'volume', 'options', 'comments', 'tracks',
      'subtitle-previous', 'subtitle-replay', 'subtitle-next', 'bookmark', 'screenshot', 'pip', 'fullscreen']
    for (const name of names) expect(controls).toContain(`data-control="${name}"`)
    expect(read('./DesktopCastButton.svelte')).toContain('data-control="cast"')
  })

  it('leaves no labelled control unnamed', () => {
    const tags = rowButtons()
    // A renamed anchor must not make the scan pass over nothing.
    expect(tags.length).toBeGreaterThan(10)
    const unnamed = tags.filter((tag) => tag.includes('aria-label=') && !tag.includes('data-control='))
    expect(unnamed).toEqual([])
  })

  it('marks Back and Play as buttons and every other control as a player control', () => {
    const named = rowButtons().filter((tag) => tag.includes('data-control='))
    expect(named.length).toBeGreaterThan(10)
    for (const tag of named) {
      const back = tag.includes('data-control="back"') || tag.includes('data-control="play"')
      expect(tag, tag).toContain(back ? 'data-part="button"' : 'data-part="player.control"')
    }
  })

  it('lets a theme add rewind and forward, show the time left and name the episode', () => {
    for (const needle of [
      "import { resolvePlayerControls } from '$lib/themes/presentation'",
      "import { shellNav, themePresentation } from '$lib/themes/runtime'",
      'const controls = $derived(gm ? resolvePlayerControls(undefined) : resolvePlayerControls($themePresentation))',
      'data-control="rewind"',
      'data-control="forward"',
      'data-part="player.control.step"',
      '{#if controls.seekButtons && !gm}',
      "data-variant={controls.time === 'split' ? 'total' : 'remaining'}",
      `{#if dur > 0}<span data-part="player.time" data-variant={controls.time === 'split' ? 'total' : 'remaining'}`,
      'data-part="player.episode.number"',
      'data-part="player.episode.name"',
      'loadEpisodeMeta(',
      'data-season={episodeMeta?.season || undefined} data-season-episode={episodeMeta?.season ? episodeMeta.seasonEpisode ?? np.episode : undefined}',
    ]) expect(controls).toContain(needle)
  })

  it('hooks the desktop popups and the Android scrim', () => {
    expect(controls).toContain('data-options-menu data-part="player.menu" data-variant="options"')
    expect(controls).toContain('data-part="player.menu" data-variant="tracks"')
    expect(read('./AndroidPlayer.svelte')).toContain('data-part="player.scrim"')
  })

  it('says which player it is', () => {
    expect(controls).toContain(`data-slot="player.controls" data-variant={gm ? 'game' : 'desktop'}`)
    expect(read('./AndroidPlayer.svelte')).toContain('data-android-player class:hidden={overlayHidden} data-slot="player.controls" data-variant="android"')
  })

  it('keeps theme stylesheets out of the Game mode player', () => {
    expect(read('../../themes/css.ts')).toContain('@scope (:root) to ([data-theme-protected], [data-theme-unthemed])')
    expect(controls).toMatch(/data-slot="player.controls"[^>]*data-theme-unthemed=\{gm \|\| undefined\}/)
    expect(read('./PlayerOverlay.svelte')).toMatch(/data-part="player.skip"[^>]*data-theme-unthemed=\{gmMode \|\| undefined\}/)
    expect(read('./UpNextOverlay.svelte')).toContain('data-theme-unthemed={$gameMode || undefined}')
    // The media menu only mounts in Game mode.
    expect(read('./TrackMenu.svelte')).toMatch(/data-gm-menu-surface\s+data-theme-unthemed\s/)
    // Unlike data-theme-protected, the marker carries no styling of its own.
    expect(read('../../../app.css')).not.toContain('data-theme-unthemed')
  })
})
