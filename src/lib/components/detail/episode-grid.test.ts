import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { get } from 'svelte/store'
import { episodeLayout } from '$lib/settings/ui'

const list = readFileSync(fileURLToPath(new URL('./EpisodeList.svelte', import.meta.url)), 'utf8')
const ui = readFileSync(fileURLToPath(new URL('../../settings/ui.ts', import.meta.url)), 'utf8')

describe('episode number grid', () => {
  it('extends the existing layout preference instead of adding a second one', () => {
    expect(ui).toContain("export type EpisodeLayout = 'cards' | 'compact' | 'grid'")
    expect(get(episodeLayout)).toBe('cards')
  })

  it('offers a layout switch on the episode controls row', () => {
    expect(list).toContain('aria-label="Episode layout"')
    expect(list).toContain("setLayout('list')")
    expect(list).toContain("setLayout('grid')")
  })

  it('renders tiles from the tested state helper', () => {
    expect(list).toContain("import { episodeTileState } from './episode-tile'")
    expect(list).toContain("$episodeLayout === 'grid'")
    expect(list).toContain('minmax(3.25rem,1fr)')
  })

  it('restores the remembered non-grid layout instead of overwriting compact', () => {
    expect(list).toContain('let lastNonGrid')
    expect(list).toContain("const target = next === 'grid' ? 'grid' : lastNonGrid")
  })

  it('shows selection state in the grid, like the other layouts', () => {
    expect(list).toContain("selecting && selected.has(ep) ? 'ring-2 ring-primary' : ''")
  })
})
