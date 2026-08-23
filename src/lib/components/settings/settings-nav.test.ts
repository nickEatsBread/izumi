import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, it, expect } from 'vitest'

const src = readFileSync(fileURLToPath(new URL('./SettingsNav.svelte', import.meta.url)), 'utf8')
const layout = readFileSync(fileURLToPath(new URL('../../../routes/app/settings/+layout.svelte', import.meta.url)), 'utf8')
const dpad = readFileSync(fileURLToPath(new URL('../../nav/index.ts', import.meta.url)), 'utf8')

describe('SettingsNav', () => {
  it('imports the Captions icon from lucide', () => {
    expect(src).toContain("import Captions from '@lucide/svelte/icons/captions'")
  })

  it('has a Subtitles nav entry pointing at the subtitles route', () => {
    expect(src).toContain("{ title: 'Subtitles', href: '/app/settings/subtitles', icon: Captions")
  })

  it('groups Subtitles under Playback, ahead of the Content entries', () => {
    const player = src.indexOf("href: '/app/settings/player'")
    const subs = src.indexOf("href: '/app/settings/subtitles'")
    const ext = src.indexOf("href: '/app/settings/extensions'")
    const dl = src.indexOf("href: '/app/settings/downloads'")
    expect(player).toBeGreaterThan(-1)
    expect(subs).toBeGreaterThan(player)
    expect(ext).toBeGreaterThan(subs)
    expect(dl).toBeGreaterThan(ext)
  })

  it('keeps the Source Store inside Sources instead of as a separate navigation item', () => {
    expect(src).not.toContain("{ title: 'Source Store', href: '/app/settings/store'")
  })

  it('drops the Hotkeys category on Android, keyed on $isAndroid rather than $isMobile', () => {
    // A narrow desktop window is $isMobile but still has a keyboard, so the filter must not use it.
    expect(src).toContain("import { isAndroid, isMobile } from '$lib/platform'")
    expect(src).toContain("$isAndroid")
    expect(src).toContain("it.href !== '/app/settings/hotkeys'")
    expect(src).toContain('{#each visibleGroups as g (g.label)}')
  })

  it('scrolls the desktop category rail independently through the off-screen About item', () => {
    expect(layout).toContain('<div class="min-h-0 flex-1"><SettingsNav /></div>')
    expect(src).toContain('data-nav-scroll-container')
    expect(src).toContain('overflow-y-auto overscroll-contain')
    expect(dpad).toContain("closest<HTMLElement>('[data-nav-scroll-container]')")
    expect(dpad).toContain("const behavior: ScrollBehavior = rapid ? 'auto' : 'smooth'")
    expect(dpad).toContain('pane.scrollBy({ top, left, behavior })')
  })
})
