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
    // The popovers hold menu entries, not controls, so they are cut out first.
    const row = controls
      .slice(controls.indexOf('data-slot="player.controls"'), controls.indexOf('data-gm-menu-surface'))
      .replace(/data-options-menu[\s\S]*?<!-- Discussion/, '')
      .replace(/\{#if showTracks\}[\s\S]*?\{#if \$subtitleLineNavigation\}/, '')
    const unnamed = buttonTags(row).filter((tag) => tag.includes('aria-label=') && !tag.includes('data-control='))
    expect(unnamed).toEqual([])
  })
})
