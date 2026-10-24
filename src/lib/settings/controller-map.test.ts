import { describe, expect, it } from 'vitest'
import { glyphFor } from '$lib/nav/glyphs'
import { CONTROLLER_MAP, MAP_KEY_LABEL, isGlyphKey } from './controller-map'

describe('Game-mode controller map (spec §5.5)', () => {
  it('covers browsing and watching, and every button can be drawn', () => {
    expect(CONTROLLER_MAP.map((group) => group.title)).toEqual(['Browsing', 'Watching'])
    for (const group of CONTROLLER_MAP) {
      expect(group.rows.length).toBeGreaterThan(0)
      for (const row of group.rows) {
        for (const key of row.keys) {
          if (isGlyphKey(key)) expect(glyphFor('deck', key).text).toBeTruthy()
          else expect(MAP_KEY_LABEL[key]).toBeTruthy()
        }
      }
    }
  })

  it('names the Settings buttons this pass adds', () => {
    const browsing = CONTROLLER_MAP[0].rows
    expect(browsing.find((row) => row.keys.includes('y'))?.action).toBe('Search settings')
    expect(browsing.find((row) => row.keys.includes('l1'))?.action).toContain('sections in Settings')
  })
})
