import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const indicator = readFileSync(fileURLToPath(new URL('./CompanionLinkIndicator.svelte', import.meta.url)), 'utf8')
const titlebar = readFileSync(fileURLToPath(new URL('./Titlebar.svelte', import.meta.url)), 'utf8')
const bottomNav = readFileSync(fileURLToPath(new URL('./BottomNav.svelte', import.meta.url)), 'utf8')

describe('linked TV activity indicator', () => {
  it('stays present for a live link and animates only during communication', () => {
    expect(indicator).toContain('$companionLinkState.connected > 0')
    expect(indicator).toContain('{#if $companionLinkState.active}')
    expect(indicator).toContain('@media (prefers-reduced-motion: reduce)')
  })

  it('sits beside desktop window controls and above Android navigation', () => {
    expect(titlebar).toContain('<CompanionLinkIndicator />')
    expect(titlebar.indexOf('<CompanionLinkIndicator />')).toBeLessThan(titlebar.indexOf('aria-label="Minimize"'))
    expect(bottomNav).toContain('<CompanionLinkIndicator floating />')
  })
})
