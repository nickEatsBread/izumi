import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

// Settings rows were web-page height with no press feedback. On a phone they should read as
// platform rows: a comfortable target, a subtitle for context, and ink that follows the finger.

const nav = readFileSync(fileURLToPath(new URL('./SettingsNav.svelte', import.meta.url)), 'utf8')

describe('mobile settings rows', () => {
  it('gives each row a comfortable touch target', () => {
    expect(nav).toContain('min-h-16')
  })

  it('carries a subtitle under each title', () => {
    expect(nav).toContain('it.subtitle')
  })

  it('uses the shared ripple for press feedback', () => {
    expect(nav).toContain("import { ripple } from '$lib/actions/ripple'")
    expect(nav).toContain('use:ripple')
    expect(nav).toContain('ripple-host')
  })
})
