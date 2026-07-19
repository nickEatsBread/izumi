import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, it, expect } from 'vitest'

const src = readFileSync(fileURLToPath(new URL('./SettingsNav.svelte', import.meta.url)), 'utf8')

describe('SettingsNav', () => {
  it('imports the Captions icon from lucide', () => {
    expect(src).toContain("import Captions from 'lucide-svelte/icons/captions'")
  })

  it('has a Subtitles nav entry pointing at the subtitles route', () => {
    expect(src).toContain("{ title: 'Subtitles', href: '/app/settings/subtitles', icon: Captions }")
  })

  it('orders Subtitles between Extensions and Downloads', () => {
    const ext = src.indexOf("href: '/app/settings/extensions'")
    const subs = src.indexOf("href: '/app/settings/subtitles'")
    const dl = src.indexOf("href: '/app/settings/downloads'")
    expect(ext).toBeGreaterThan(-1)
    expect(subs).toBeGreaterThan(ext)
    expect(dl).toBeGreaterThan(subs)
  })
})
