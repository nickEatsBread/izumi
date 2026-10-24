import { get } from 'svelte/store'
import { afterEach, describe, expect, it } from 'vitest'
import { isTv } from '$lib/platform'
import { gameMode } from '$lib/player/session'
import { SETTINGS_SEARCH_INDEX, type SettingSearchItem } from './search'
import { controllerHides, controllerSurfaces, settingsControllerMode } from './surface'

afterEach(() => {
  isTv.set(false)
  gameMode.set(false)
})

describe('settingsControllerMode (spec §5)', () => {
  it('is on for Android TV and for Steam Deck Game mode, off elsewhere', () => {
    expect(get(settingsControllerMode)).toBe(false)
    isTv.set(true)
    expect(get(settingsControllerMode)).toBe(true)
    isTv.set(false)
    gameMode.set(true)
    expect(get(settingsControllerMode)).toBe(true)
  })

  it('names the controller surfaces a row can be hidden on', () => {
    gameMode.set(true)
    expect(get(controllerSurfaces)).toEqual({ tv: false, gamemode: true })
  })
})

describe('controllerHides (spec §5.6)', () => {
  // Built from a real entry, so the fixture satisfies whatever fields P1 made required.
  const base = SETTINGS_SEARCH_INDEX[0]
  const row = (key: string, hideOn?: SettingSearchItem['hideOn']): SettingSearchItem => ({ ...base, key, hideOn })
  const index = [
    row('tv-only', ['tv']),
    row('game-only', ['gamemode', 'lite']),
    row('shared', ['tv']),
    row('shared'),
    row('lite-only', ['lite']),
  ]

  it('hides a row on the surface its entry names, and only there', () => {
    expect(controllerHides('tv-only', { tv: true, gamemode: false }, index)).toBe(true)
    expect(controllerHides('tv-only', { tv: false, gamemode: true }, index)).toBe(false)
    expect(controllerHides('game-only', { tv: false, gamemode: true }, index)).toBe(true)
  })

  it('never hides on desktop or phone, for other tags, unknown keys or no key', () => {
    expect(controllerHides('tv-only', { tv: false, gamemode: false }, index)).toBe(false)
    expect(controllerHides('lite-only', { tv: true, gamemode: true }, index)).toBe(false)
    expect(controllerHides('missing', { tv: true, gamemode: true }, index)).toBe(false)
    expect(controllerHides(undefined, { tv: true, gamemode: true }, index)).toBe(false)
  })

  it('keeps a row that one of its entries still shows', () => {
    expect(controllerHides('shared', { tv: true, gamemode: false }, index)).toBe(false)
  })
})
