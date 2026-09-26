import { get } from 'svelte/store'
import { describe, expect, it } from 'vitest'
import { bottomNavSuppressed, suppressBottomNav } from './chrome'

describe('bottom navigation suppression', () => {
  it('stays hidden until every claim is released', () => {
    const first = suppressBottomNav()
    const second = suppressBottomNav()
    expect(get(bottomNavSuppressed)).toBe(true)
    first()
    first()
    expect(get(bottomNavSuppressed)).toBe(true)
    second()
    expect(get(bottomNavSuppressed)).toBe(false)
  })
})
