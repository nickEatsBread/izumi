import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const path = (relative: string) => fileURLToPath(new URL(relative, import.meta.url))
const read = (relative: string) => readFileSync(path(relative), 'utf8')

describe('Android TV mode contract', () => {
  const scaffold = read('../../../scripts/ci/android-scaffold.sh')
  const activity = read('../../../src-tauri/android/MainActivity.kt')
  const layout = read('../../routes/app/+layout.svelte')
  const nav = read('../nav/index.ts')
  const player = read('../components/player/AndroidPlayer.svelte')
  const keyboard = read('../components/shell/OnScreenKeyboard.svelte')
  const css = read('../../app.css')

  it('publishes a remote-only-compatible Leanback launcher', () => {
    expect(scaffold).toContain('android.software.leanback')
    expect(scaffold).toContain('android.hardware.touchscreen\" android:required=\"false\"')
    expect(scaffold).toContain('android.intent.category.LEANBACK_LAUNCHER')
    expect(scaffold).toContain('android:banner=\"@drawable/izumi_tv_banner\"')
  })

  it('ships the required 320 by 180 xhdpi home banner', () => {
    const png = readFileSync(path('../../../src-tauri/icons/android/drawable-xhdpi/izumi_tv_banner.png'))
    expect(png.subarray(1, 4).toString('ascii')).toBe('PNG')
    expect(png.readUInt32BE(16)).toBe(320)
    expect(png.readUInt32BE(20)).toBe(180)
  })

  it('marks native televisions and translates remote Back into the web navigation contract', () => {
    expect(activity).toContain('Configuration.UI_MODE_TYPE_TELEVISION')
    expect(activity).toContain('SCREEN_ORIENTATION_LANDSCAPE')
    expect(activity).toContain('IzumiTV/1')
    expect(activity).toContain('KeyEvent.KEYCODE_BACK')
    expect(activity).toContain("new KeyboardEvent('keydown',{key:'Escape'")
  })

  it('makes every interactive TV surface D-pad reachable with strong focus state', () => {
    expect(nav).toContain("'[data-focusable], button, a[href], input, textarea, select, [tabindex]'")
    expect(layout).toContain("classList.toggle('tv-mode', $isTv)")
    expect(layout).toContain('getCurrentWindow().close()')
    expect(css).toContain('.tv-mode .player-shell button:focus')
    expect(keyboard).toContain('const controllerUi = $derived($gameMode || $isTv || $controllerMode)')
  })

  it('keeps playback and modal controls inside a TV focus trap', () => {
    expect(player).toContain('data-nav-trap={$isAndroidTv && controlsShown && !sheet')
    expect(player).toContain('data-tv-primary')
    expect(player).toContain("event.key === 'MediaPlayPause'")
    expect(player).toContain("event.key === 'ArrowLeft') skip(-$seekDuration)")
    expect(player).toContain('setAndroidAutoPip($androidAutoPip && !$isAndroidTv)')
  })
})
