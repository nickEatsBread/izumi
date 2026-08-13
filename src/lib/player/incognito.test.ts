import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { get } from 'svelte/store'

// continue-watching pulls in the whole trackers stack for its dismiss side-effect; stub it out.
vi.mock('$lib/trackers', () => ({ setStatus: vi.fn(), getMalListProgressOrThrow: vi.fn() }))

import { enterIncognito, exitIncognito, incognito } from '$lib/stores/incognito'
import { saveLocalHistory, cwDismissAction } from '$lib/settings/ui'
import {
  durableHistory, incognitoHistory, localHistory, sessionProgress,
  recordPlay, recordProgress, setLocalProgress, forgetMedia,
} from './history'
import { durablePositions, incognitoPositions, positions, savePosition, getPosition } from './progress'
import { cwDismissed, incognitoDismissed, dismissContinueWatching } from './continue-watching'
import { exportJson } from './history-io'
import type { Media } from '$lib/anilist/types'

const media = (id = 101): Media => ({ id, idMal: 202, title: { romaji: 'Secret Show' }, episodes: 12 })

const reset = () => {
  incognito.set(false)
  saveLocalHistory.set(true)
  durableHistory.set({})
  incognitoHistory.set({})
  sessionProgress.set({})
  durablePositions.set({})
  incognitoPositions.set({})
  cwDismissed.set({})
  incognitoDismissed.set({})
}

describe('incognito mode', () => {
  beforeEach(reset)
  afterEach(reset)

  it('routes watch history to the in-memory overlay, never the persisted store', () => {
    enterIncognito()
    recordPlay(media(), 3, { group: 'SubsPlease' })
    recordProgress(media(), 3)

    expect(get(durableHistory)).toEqual({})
    expect(get(sessionProgress)).toEqual({}) // feeds the persisted CW snapshot floor — must stay clean
    expect(get(localHistory)[101]).toMatchObject({ episode: 3, progress: 3, release: { group: 'SubsPlease' } })
  })

  it('records the overlay even when saved history is disabled', () => {
    saveLocalHistory.set(false)
    enterIncognito()
    recordProgress(media(), 2)
    expect(get(localHistory)[101]?.progress).toBe(2)
    expect(get(durableHistory)).toEqual({})
  })

  it('purges the overlay when incognito ends, leaving durable history untouched', () => {
    recordProgress(media(202), 5) // normal-mode watch first
    enterIncognito()
    recordProgress(media(101), 3)
    setLocalProgress(media(101), 7)
    exitIncognito()

    expect(get(localHistory)[101]).toBeUndefined()
    expect(get(localHistory)[202]?.progress).toBe(5)
    expect(get(durableHistory)[202]?.progress).toBe(5)
  })

  it('overlays an incognito entry over a durable one for the same show, then reverts on exit', () => {
    recordProgress(media(101), 2)
    enterIncognito()
    recordProgress(media(101), 9)
    expect(get(localHistory)[101]?.progress).toBe(9)
    exitIncognito()
    expect(get(localHistory)[101]?.progress).toBe(2)
  })

  it('keeps resume positions in memory and forgets them on exit', () => {
    enterIncognito()
    savePosition(101, 3, 420, 1400)
    expect(getPosition(101, 3)).toBe(420)
    expect(get(durablePositions)).toEqual({})
    exitIncognito()
    expect(getPosition(101, 3)).toBe(0)
  })

  it('merges incognito resume positions over durable ones only while active', () => {
    savePosition(101, 3, 100, 1400)
    enterIncognito()
    savePosition(101, 3, 900, 1400)
    expect(get(positions)['101:3']?.pos).toBe(900)
    exitIncognito()
    expect(get(positions)['101:3']?.pos).toBe(100)
  })

  it('never exports incognito entries', () => {
    recordProgress(media(202), 5)
    enterIncognito()
    recordProgress(media(101), 3)
    savePosition(101, 3, 420, 1400)

    const bundle = JSON.parse(exportJson()) as { history: Record<string, unknown>; positions: Record<string, unknown> }
    expect(Object.keys(bundle.history)).toEqual(['202'])
    expect(bundle.positions['101:3']).toBeUndefined()
  })

  it('keeps incognito dismissals out of the persisted dismissed floors', () => {
    cwDismissAction.set('none')
    enterIncognito()
    dismissContinueWatching(media(101), 3)
    expect(get(cwDismissed)).toEqual({})
    expect(get(incognitoDismissed)[101]).toBe(3)
    exitIncognito()
    expect(get(incognitoDismissed)).toEqual({})
  })

  it('cleans an incognito entry out via forgetMedia too', () => {
    enterIncognito()
    recordProgress(media(101), 3)
    forgetMedia(101)
    expect(get(localHistory)[101]).toBeUndefined()
  })
})
