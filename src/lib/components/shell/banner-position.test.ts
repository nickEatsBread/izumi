import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const read = (name: string) => readFileSync(fileURLToPath(new URL(name, import.meta.url)), 'utf8')
const online = read('./OnlineBanner.svelte')
const incognito = read('./IncognitoBanner.svelte')
const degraded = read('./AniListDegradedBanner.svelte')

describe('shell alert position', () => {
  it('starts the desktop alert stack at the top edge instead of below the titlebar', () => {
    expect(online).toContain('sm:top-0')
    expect(incognito).toContain("sm:top-0'")
    expect(incognito).toContain('sm:top-7')
    expect(degraded).toContain('sm:top-[var(--banner-offset)]')
    expect(`${online}${incognito}${degraded}`).not.toContain('sm:top-8')
  })

  it('keeps alerts clear of desktop window controls and usable as a drag region', () => {
    for (const component of [online, incognito, degraded]) {
      expect(component).toContain('sm:right-[8.25rem]')
      expect(component).toContain('data-tauri-drag-region')
      expect(component).toContain('z-[60]')
    }
  })
})
