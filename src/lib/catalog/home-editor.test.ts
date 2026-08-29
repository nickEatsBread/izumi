import { get } from 'svelte/store'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { catalogHomeLayouts, type CatalogHomeLayouts } from './home-layout'
import { hideHomeRow, insertHomeRow, moveHomeRowBefore, moveHomeRowBy } from './home-editor'
import type { CatalogHomeRowOption } from './types'

describe('in-place Home editor layout operations', () => {
  let previous: CatalogHomeLayouts

  beforeEach(() => {
    previous = get(catalogHomeLayouts)
    catalogHomeLayouts.set({ anilist: { order: ['continue', 'season', 'recent'], disabled: ['recent'] } })
  })

  afterEach(() => catalogHomeLayouts.set(previous))

  it('moves a visible section before another without losing hidden sections', () => {
    moveHomeRowBefore('anilist', ['continue', 'season'], 'season', 'continue')
    expect(get(catalogHomeLayouts).anilist).toEqual({
      order: ['season', 'continue', 'recent'],
      disabled: ['recent'],
    })
  })

  it('supports one-step movement for touch and keyboard users', () => {
    moveHomeRowBy('anilist', ['continue', 'season'], 'continue', 1)
    expect(get(catalogHomeLayouts).anilist?.order).toEqual(['season', 'continue', 'recent'])
  })

  it('hides a section without deleting its saved position', () => {
    hideHomeRow('anilist', ['continue', 'season'], 'season')
    expect(get(catalogHomeLayouts).anilist).toEqual({
      order: ['continue', 'season', 'recent'],
      disabled: ['recent', 'season'],
    })
  })

  it('inserts an available section at the requested gap', () => {
    const rows: Array<CatalogHomeRowOption & { enabled: boolean }> = [
      { id: 'continue', title: 'Continue Watching', enabled: true },
      { id: 'season', title: 'Popular This Season', enabled: true },
      { id: 'recent', title: 'Recently Released', enabled: false },
    ]
    insertHomeRow('anilist', rows, 'recent', 'season')
    expect(get(catalogHomeLayouts).anilist).toEqual({
      order: ['continue', 'recent', 'season'],
      disabled: [],
    })
  })
})

