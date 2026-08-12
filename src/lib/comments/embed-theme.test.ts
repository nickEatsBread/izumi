import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8')

describe('DiscussAnime embed theming', () => {
  it('loads the official host-side theme bridge once at the app root', () => {
    const layout = read('../../routes/+layout.svelte')
    expect(layout.match(/https:\/\/discussanime\.moe\/embed\.js/g)).toHaveLength(1)
    expect(layout).toContain('type="module"')
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
