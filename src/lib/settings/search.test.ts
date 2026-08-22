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

  it('resolves the curated-release row from the words on it and around it', () => {
    // The row's own words, and the ones a user would reach for instead — the setting is useless if
    // it can only be found by scrolling to it.
    expect(searchSettings('mark best releases')[0]?.title).toBe('Mark best releases')
    expect(searchSettings('curated')[0]?.title).toBe('Mark best releases')
  })

  it('hides controls that do not exist in the Android UI', () => {
    expect(searchSettings('player cache', true)).toHaveLength(0)
    expect(searchSettings('discord rpc', true)).toHaveLength(0)
    expect(searchSettings('title language', true)[0]?.title).toBe('Title language')
  })

  it('finds video quality on Android now that embedded libmpv consumes the presets', () => {
    expect(searchSettings('video quality', true)[0]?.title).toBe('Video quality')
  })

  it('finds the desktop Discord toggle by RPC terminology', () => {
    expect(searchSettings('discord rpc')[0]?.title).toBe('Discord Rich Presence')
  })

  it('finds the production inspector on desktop only', () => {
    expect(searchSettings('inspect element')[0]?.title).toBe('Developer tools')
    expect(searchSettings('inspect element', true)).toHaveLength(0)
  })

  it('finds the VPN adapter binding by provider names, desktop only', () => {
    expect(searchSettings('nordlynx')[0]?.title).toBe('VPN adapter binding')
    expect(searchSettings('mullvad')[0]?.title).toBe('VPN adapter binding')
    expect(searchSettings('nordlynx', true)).toHaveLength(0)
  })

  it('hides Android-only controls on desktop', () => {
    expect(searchSettings('continue seeding', false)).toHaveLength(0)
    expect(searchSettings('continue seeding', true)[0]?.title).toBe('Continue seeding after playback')
  })

  it('finds the series-wide numbering toggle now that it left the series page', () => {
    expect(searchSettings('absolute episode numbers')[0]?.title).toBe('Series-wide episode numbers')
    expect(searchSettings('absolute')[0]?.category).toBe('Interface')
  })

  it('uses the same stable keys as Toggle rows', () => {
    expect(settingKey('Auto-skip openings & endings')).toBe('auto-skip-openings-endings')
  })

  it('finds the GIF recorder from the words people actually type', () => {
    expect(searchSettings('gif')[0]?.title).toBe('GIF recorder')
    expect(searchSettings('gif recorder')[0]?.title).toBe('GIF recorder')
    expect(searchSettings('record gif')[0]?.title).toBe('GIF recorder')
    expect(settingKey('GIF recorder')).toBe('gif-recorder')
  })
})
