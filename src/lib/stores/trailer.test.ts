import { get } from 'svelte/store'
import { afterEach, describe, expect, it } from 'vitest'
import { isMobile, isTv } from '$lib/platform'
import { gameMode } from '$lib/player/session'
import { controllerMode } from '$lib/nav/input'
import { trailerOpenMode } from '$lib/settings/ui'
import { closeTrailerPopup, openTrailerPopup, trailerOpensIn, trailerPopup } from './trailer'

const desktop = { setting: 'player', tv: false, gameMode: false, controller: false, mobile: false } as const

describe('trailerOpensIn', () => {
  it('follows the setting on a desktop with mouse and keyboard, the player by default', () => {
    expect(trailerOpensIn(desktop)).toBe('player')
    expect(trailerOpensIn({ ...desktop, setting: 'popup' })).toBe('popup')
  })

  it('always opens the player on TV, in Game mode and with a controller on desktop', () => {
    for (const surface of [{ tv: true }, { gameMode: true }, { controller: true }]) {
      expect(trailerOpensIn({ ...desktop, setting: 'popup', ...surface }), JSON.stringify(surface)).toBe('player')
    }
  })

  it('keeps the popup on phones whatever the setting or input', () => {
    expect(trailerOpensIn({ ...desktop, mobile: true })).toBe('popup')
    expect(trailerOpensIn({ ...desktop, mobile: true, controller: true })).toBe('popup')
  })
})

describe('openTrailerPopup', () => {
  afterEach(() => {
    closeTrailerPopup()
    trailerOpenMode.set('player')
    for (const store of [isTv, isMobile, gameMode, controllerMode]) store.set(false)
  })

  it('decides the mode once, when it opens', () => {
    openTrailerPopup('abc', 'Show')
    expect(get(trailerPopup)).toEqual({ id: 'abc', title: 'Show', mode: 'player' })
    trailerOpenMode.set('popup')
    expect(get(trailerPopup)?.mode).toBe('player')
    openTrailerPopup('abc', 'Show')
    expect(get(trailerPopup)?.mode).toBe('popup')
    controllerMode.set(true)
    openTrailerPopup('abc')
    expect(get(trailerPopup)).toEqual({ id: 'abc', title: 'Trailer', mode: 'player' })
    closeTrailerPopup()
    expect(get(trailerPopup)).toBeNull()
  })
})
