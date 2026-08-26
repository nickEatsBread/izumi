import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

// Settings rows were web-page height with no press feedback. On a phone they should read as
// platform rows: a comfortable target, a subtitle for context, and ink that follows the finger.

const nav = readFileSync(fileURLToPath(new URL('./SettingsNav.svelte', import.meta.url)), 'utf8')
const toggle = readFileSync(fileURLToPath(new URL('./Toggle.svelte', import.meta.url)), 'utf8')
const group = readFileSync(fileURLToPath(new URL('./SettingsGroup.svelte', import.meta.url)), 'utf8')
const row = readFileSync(fileURLToPath(new URL('./SettingsRow.svelte', import.meta.url)), 'utf8')

describe('mobile settings rows', () => {
  it('gives each row a comfortable touch target', () => {
    expect(nav).toContain('min-h-14')
  })

  it('keeps the overview dense enough to scan', () => {
    expect(nav).toContain('space-y-4')
    expect(nav).toContain('px-3 py-2.5')
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

describe('compact settings content', () => {
  it('keeps shared toggle rows compact while preserving a touch-sized row', () => {
    expect(toggle).toContain('min-h-12')
    expect(toggle).toContain('px-3 py-2.5')
    expect(toggle).toContain('text-xs leading-4')
  })

  it('groups related rows with dividers instead of separate floating cards', () => {
    expect(group).toContain('divide-y divide-border/70')
    expect(group).not.toContain('overflow-hidden')
    expect(group).toContain('[&>*:first-child]:rounded-t-[calc(0.75rem-1px)]')
    expect(group).toContain('[&>*:last-child]:rounded-b-[calc(0.75rem-1px)]')
    expect(row).toContain('px-3 py-2.5')
  })

  it('lets wide controls stack without constraining their mobile width', () => {
    expect(row).toContain("controlLayout?: 'inline' | 'stack'")
    expect(row).toContain('flex-col items-stretch sm:flex-row sm:items-center')
    expect(row).toContain('w-full justify-end sm:w-auto')
  })

  it('only allocates space for dependent controls while expanded', () => {
    expect(row).toContain('{#if children && expanded}')
  })

  it('lets switch rows activate from the whole pulsing container', () => {
    expect(row).toContain('onActivate?: () => void')
    expect(row).toContain('use:ripple')
    expect(row).toContain('ripple-host block w-full')
    expect(row).toContain('aria-pressed={pressed}')
  })

  it('keeps expanded controls outside an activating row button', () => {
    expect(row).toContain('aria-expanded={children ? expanded : undefined}')
    expect(row).toContain('mx-3 mb-2.5 border-t')
    expect(row).toContain("children && expanded ? 'rounded-t-[inherit]' : 'rounded-[inherit]'")
  })
})
