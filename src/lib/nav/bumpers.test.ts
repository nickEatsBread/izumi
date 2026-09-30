import { describe, expect, it } from 'vitest'
import { stepSection } from './bumpers'

const tabs = ['/app/home', '/app/schedule', '/app/search', '/app/library']

describe('stepSection', () => {
  it('moves one tab either way', () => {
    expect(stepSection(tabs, '/app/schedule', 1)).toBe('/app/search')
    expect(stepSection(tabs, '/app/schedule', -1)).toBe('/app/home')
  })
  it('never wraps, so a held bumper stops at either end', () => {
    expect(stepSection(tabs, '/app/home', -1)).toBeNull()
    expect(stepSection(tabs, '/app/library', 1)).toBeNull()
  })
  it('starts from an end when no section is known', () => {
    expect(stepSection(tabs, undefined, 1)).toBe('/app/home')
    expect(stepSection(tabs, '/app/anime/1', -1)).toBe('/app/library')
    expect(stepSection([], undefined, 1)).toBeNull()
  })
})
