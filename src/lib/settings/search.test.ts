import { describe, expect, it } from 'vitest'
import { searchSettings, settingKey } from './search'

describe('settings search', () => {
  it('ranks direct title matches ahead of keyword matches', () => {
    const results = searchSettings('subtitle language')
    expect(results[0]?.title).toBe('Subtitle language')
  })

  it('finds settings through friendly keywords', () => {
    expect(searchSettings('vibration')[0]?.title).toBe('Haptics')
    expect(searchSettings('4k resolution')[0]?.title).toBe('Preferred quality')
  })

  it('hides controls that do not exist in the Android UI', () => {
    expect(searchSettings('player cache', true)).toHaveLength(0)
    expect(searchSettings('title language', true)[0]?.title).toBe('Title language')
  })

  it('hides Android-only controls on desktop', () => {
    expect(searchSettings('continue seeding', false)).toHaveLength(0)
    expect(searchSettings('continue seeding', true)[0]?.title).toBe('Continue seeding after playback')
  })

  it('uses the same stable keys as Toggle rows', () => {
    expect(settingKey('Auto-skip openings & endings')).toBe('auto-skip-openings-endings')
  })
})
