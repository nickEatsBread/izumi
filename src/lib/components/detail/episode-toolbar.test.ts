import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const src = readFileSync(fileURLToPath(new URL('./EpisodeList.svelte', import.meta.url)), 'utf8')

describe('mobile episode toolbar', () => {
  it('does not expose the old progress-tools clutter', () => {
    expect(src).not.toContain('Progress tools')
    expect(src).not.toContain('progressTarget')
  })

  it('puts search beside the mobile layout controls and gates the field', () => {
    expect(src).toContain('aria-label="Search episodes"')
    expect(src).toContain('{#if $isMobile && searchOpen}')
    expect(src).toContain('{#if !$isMobile}')
  })
})
