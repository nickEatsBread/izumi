import { get } from 'svelte/store'
import { describe, expect, it } from 'vitest'
import { settingsRailMarker } from './rail-marker'

describe('settingsRailMarker', () => {
  it('draws the neutral fill marker while no theme chooses one', () => {
    expect(get(settingsRailMarker)).toBe('fill')
  })
})
