import { afterEach, describe, expect, it } from 'vitest'
import { get } from 'svelte/store'
import { gameMode } from '$lib/player/session'
import {
  acknowledgeDeckKeyboardWarning,
  deckKeyboardWarning,
  warnBeforeThirdPartyLogin,
} from './keyboard-warning'

afterEach(() => {
  while (get(deckKeyboardWarning)) acknowledgeDeckKeyboardWarning()
  gameMode.set(false)
})

describe('Deck keyboard warning', () => {
  it('does not interrupt desktop login', async () => {
    gameMode.set(false)
    await warnBeforeThirdPartyLogin('AniList')
    expect(get(deckKeyboardWarning)).toBeNull()
  })

  it('blocks a Deck login until acknowledged', async () => {
    gameMode.set(true)
    let continued = false
    const waiting = warnBeforeThirdPartyLogin('MyAnimeList').then(() => { continued = true })

    expect(get(deckKeyboardWarning)).toEqual({ service: 'MyAnimeList' })
    expect(continued).toBe(false)
    acknowledgeDeckKeyboardWarning()
    await waiting
    expect(continued).toBe(true)
  })

  it('queues iframe login popups without losing one', async () => {
    const first = warnBeforeThirdPartyLogin('Disqus', true)
    const second = warnBeforeThirdPartyLogin('Disqus', true)
    expect(get(deckKeyboardWarning)?.service).toBe('Disqus')

    acknowledgeDeckKeyboardWarning()
    await first
    expect(get(deckKeyboardWarning)?.service).toBe('Disqus')

    acknowledgeDeckKeyboardWarning()
    await second
    expect(get(deckKeyboardWarning)).toBeNull()
  })
})
