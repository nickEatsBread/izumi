import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8')

describe('DiscussAnime embed theming', () => {
  it('loads the official host-side theme bridge on demand instead of at app startup', () => {
    const layout = read('../../routes/+layout.svelte')
    const loader = read('./embed-theme.ts')
    expect(layout).not.toContain('https://discussanime.moe/embed.js')
    expect(loader.match(/https:\/\/discussanime\.moe\/embed\.js/g)).toHaveLength(1)
    expect(loader).toContain("script.type = 'module'")
    expect(loader).toContain("document.getElementById(SCRIPT_ID)")
  })

  it('does not force dark mode through URLs or iframe styles', () => {
    const panel = read('../components/player/CommentsPanel.svelte')
    const mobile = read('./mobile.ts')
    const android = read('../components/player/AndroidWatchDetails.svelte')

    expect(panel).not.toContain('withDark')
    expect(panel).not.toContain("set('theme', 'dark')")
    expect(mobile).not.toContain("set('theme', 'dark')")
    expect(android).not.toContain('style:color-scheme="dark"')
  })

  it('keeps Android comments in the watch page scroll instead of a nested scroller', () => {
    const loader = read('../../../static/disqus-embed.html')
    const android = read('../components/player/AndroidWatchDetails.svelte')

    expect(loader).toContain('html.izumi-expand, html.izumi-expand body { overflow: hidden; }')
    expect(android).toMatch(/title="Episode comments"[^>]*scrolling="no"/)
    expect(android).toContain('style:height={`${disqusHeight}px`}')
    expect(android).not.toContain('min(70dvh')
  })

  it('removes native dark-frame mutation and forced WebView theming', () => {
    const lib = read('../../../src-tauri/src/lib.rs')
    const androidScaffold = read('../../../scripts/ci/android-scaffold.sh')
    expect(lib).not.toContain('DARK_FRAME_SCRIPT')
    expect(lib).not.toContain('COREWEBVIEW2_PREFERRED_COLOR_SCHEME_DARK')
    expect(lib).not.toContain('.theme(Some(tauri::Theme::Dark))')
    expect(androidScaffold).not.toContain('android:isLightTheme')
    expect(lib).toContain('DISQUS_PROFILE_SCRIPT')
  })
})
