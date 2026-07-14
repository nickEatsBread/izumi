import { afterEach, describe, expect, it } from 'vitest'
import { get } from 'svelte/store'
import { gameMode } from '$lib/player/session'
import {
  acknowledgeDeckKeyboardWarning,
  deckKeyboardWarning,
  dismissDeckKeyboardWarning,
  warnBeforeThirdPartyLogin,
} from './keyboard-warning'

afterEach(() => {
  while (get(deckKeyboardWarning)) acknowledgeDeckKeyboardWarning()
  gameMode.set(false)
})

describe('Deck keyboard warning', () => {
  it('does not interrupt desktop login', async () => {
    gameMode.set(false)
    expect(await warnBeforeThirdPartyLogin('AniList')).toBe(true)
    expect(get(deckKeyboardWarning)).toBeNull()
  })

  it('blocks a Deck login until acknowledged', async () => {
    gameMode.set(true)
    let result: boolean | undefined
    const waiting = warnBeforeThirdPartyLogin('MyAnimeList').then((proceed) => { result = proceed })

    expect(get(deckKeyboardWarning)).toEqual({ service: 'MyAnimeList' })
    expect(result).toBeUndefined()
    acknowledgeDeckKeyboardWarning()
    await waiting
    expect(result).toBe(true)
  })

  it('cancels a Deck login when dismissed', async () => {
    gameMode.set(true)
    const waiting = warnBeforeThirdPartyLogin('AniList')

    dismissDeckKeyboardWarning()
    await expect(waiting).resolves.toBe(false)
    expect(get(deckKeyboardWarning)).toBeNull()
  })

  it('queues iframe login popups without losing one', async () => {
    const first = warnBeforeThirdPartyLogin('Disqus', true)
    const second = warnBeforeThirdPartyLogin('Disqus', true)
    expect(get(deckKeyboardWarning)?.service).toBe('Disqus')

    acknowledgeDeckKeyboardWarning()
    await expect(first).resolves.toBe(true)
    expect(get(deckKeyboardWarning)?.service).toBe('Disqus')

    acknowledgeDeckKeyboardWarning()
    await expect(second).resolves.toBe(true)
    expect(get(deckKeyboardWarning)).toBeNull()
  })
})
