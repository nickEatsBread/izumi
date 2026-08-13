import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { get } from 'svelte/store'
import { incognito, enterIncognito, exitIncognito } from '$lib/stores/incognito'
import { autoIncognitoAdult } from '$lib/settings/ui'
import { playing } from './session'
import { incognitoHistory, recordProgress } from './history'
import { initAutoIncognito, maybeAutoEnterIncognito } from './auto-incognito'
import type { Media } from '$lib/anilist/types'

const adult = (id = 101): Media => ({ id, title: { romaji: 'Secret Show' }, isAdult: true, episodes: 4 })
const sfw = (id = 102): Media => ({ id, title: { romaji: 'Normal Show' }, episodes: 12 })

describe('auto-incognito for adult titles', () => {
  beforeEach(() => {
    initAutoIncognito() // idempotent — first call wires, later calls no-op
    playing.set(false)
    incognito.set(false)
    incognitoHistory.set({})
    autoIncognitoAdult.set(true)
  })
  afterEach(() => {
    playing.set(false)
    incognito.set(false)
    incognitoHistory.set({})
    autoIncognitoAdult.set(false)
  })

  it('enters on adult playback and exits (purging) when the player closes', () => {
    maybeAutoEnterIncognito(adult())
    expect(get(incognito)).toBe(true)
    playing.set(true)
    recordProgress(adult(), 1) // lands in the overlay
    expect(get(incognitoHistory)[101]?.progress).toBe(1)

    playing.set(false)
    expect(get(incognito)).toBe(false)
    expect(get(incognitoHistory)).toEqual({}) // purged with the auto-exit
  })

  it('ignores non-adult media and respects the setting', () => {
    maybeAutoEnterIncognito(sfw())
    expect(get(incognito)).toBe(false)
    autoIncognitoAdult.set(false)
    maybeAutoEnterIncognito(adult())
    expect(get(incognito)).toBe(false)
  })

  it('leaves a manually-entered incognito alone when playback closes', () => {
    enterIncognito()
    maybeAutoEnterIncognito(adult()) // already on — must not adopt the latch
    playing.set(true)
    playing.set(false)
    expect(get(incognito)).toBe(true) // the user turned it on; only the user turns it off
  })

  it('does not fight a manual exit mid-playback', () => {
    maybeAutoEnterIncognito(adult())
    playing.set(true)
    exitIncognito() // user hits "Turn off" during the episode
    enterIncognito() // …and re-arms manually
    playing.set(false)
    expect(get(incognito)).toBe(true) // manual re-arm survives the player closing
  })
})
