import { describe, expect, it } from 'vitest'
import {
  BLOCK_META,
  HOME_BLOCK_TYPES,
  blockAvailable,
  blockType,
  defaultBlock,
  isBlockId,
  nextBlockId,
  parseHomeBlock,
} from './blocks'

describe('home block model', () => {
  it('recognises block ids and their type', () => {
    expect(isBlockId('block:latest-episodes:1')).toBe(true)
    expect(isBlockId('block:nope:1')).toBe(false)
    expect(isBlockId('trending')).toBe(false)
    expect(isBlockId('anilist:trending')).toBe(false)
    expect(blockType('block:ranked-list:12')).toBe('ranked-list')
    expect(blockType('block:ranked-list')).toBeNull()
  })

  it('numbers new blocks after the highest existing instance of that type', () => {
    expect(nextBlockId('genre-chips', [])).toBe('block:genre-chips:1')
    expect(nextBlockId('genre-chips', ['block:genre-chips:1', 'block:genre-chips:4', 'block:ranked-list:9'])).toBe('block:genre-chips:5')
  })

  it('gives every type a default that survives its own parser', () => {
    for (const type of HOME_BLOCK_TYPES) {
      const block = defaultBlock(type, ['season', 'trending', 'popular', 'romance'])
      expect(parseHomeBlock(block)).toEqual(block)
      expect(BLOCK_META[type].title).toBeTruthy()
    }
    expect(defaultBlock('tabbed-grid', ['season', 'trending', 'popular', 'romance'])).toMatchObject({
      tabs: [{ label: 'Popular This Season', role: 'season' }, { label: 'Trending Now', role: 'trending' }, { label: 'All Time Popular', role: 'popular' }],
    })
    expect(defaultBlock('ranked-list', ['trending'])).toMatchObject({ tabs: [{ label: 'Trending Now', role: 'trending' }], limit: 10 })
  })

  it('clamps numbers, drops bad entries and falls back to defaults', () => {
    expect(parseHomeBlock({ type: 'latest-episodes', columns: 40, pageSize: 1, pagination: 'sideways', title: '  Latest  ', area: 'aside', phone: 'yes' })).toEqual({
      type: 'latest-episodes', title: 'Latest', area: 'aside', phone: false, columns: 8, pageSize: 4, pagination: 'numbers',
    })
    expect(parseHomeBlock({
      type: 'tabbed-grid',
      tabs: [{ label: 'New', role: 'season' }, { label: 'New', role: 'trending' }, { label: '', role: 'popular' }, { label: 'Bad', role: 'has space' }, 'x'],
    })).toMatchObject({ tabs: [{ label: 'New', role: 'season' }], columns: 6, pageSize: 18, pagination: 'numbers' })
    expect(parseHomeBlock({ type: 'genre-chips', genres: ['Action', 'action', '', 7] })).toEqual({ type: 'genre-chips', area: 'main', phone: false, genres: ['Action'], all: true })
    expect(parseHomeBlock({ type: 'genre-chips', genres: 'popular' })).toMatchObject({ genres: 'top' })
    expect(parseHomeBlock({ type: 'ranked-list', tabs: [], limit: 99 })).toMatchObject({ tabs: [], limit: 20 })
    expect(parseHomeBlock({ type: 'profile-header', buttons: [{ label: 'Lists', to: 'library' }, { label: 'Bad', to: 'nowhere' }, { label: 'Home', to: 'home' }] }))
      .toMatchObject({ buttons: [{ label: 'Lists', to: 'library' }, { label: 'Home', to: 'home' }] })
  })

  it('rejects values that are not blocks', () => {
    expect(parseHomeBlock(null)).toBeNull()
    expect(parseHomeBlock('block')).toBeNull()
    expect(parseHomeBlock({ type: 'carousel' })).toBeNull()
  })

  it('offers latest episodes only where Home uses AniList', () => {
    expect(blockAvailable('latest-episodes', true)).toBe(true)
    expect(blockAvailable('latest-episodes', false)).toBe(false)
    expect(blockAvailable('genre-chips', false)).toBe(true)
  })
})
