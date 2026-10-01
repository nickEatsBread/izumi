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
  const keyboard = read('../nav/osk.ts')
  const css = read('../../app.css')

  it('publishes a remote-only-compatible Leanback launcher', () => {
    expect(scaffold).toContain('android.software.leanback')
    expect(scaffold).toContain('android.hardware.touchscreen\" android:required=\"false\"')
    expect(scaffold).toContain('android.intent.category.LEANBACK_LAUNCHER')
    expect(scaffold).toContain('android:banner=\"@drawable/izumi_tv_banner\"')
    expect(scaffold).toContain('for feature in android.software.leanback android.hardware.touchscreen android.hardware.faketouch; do')
    expect(scaffold).not.toContain("if ! grep -q 'android.software.leanback'")
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
    expect(keyboard).toContain("if (input.isTv) return 'focus-legacy'")
  })

  it('keeps playback and modal controls inside a TV focus trap', () => {
    expect(player).toContain('data-nav-trap={$isAndroidTv && controlsShown && !sheet')
    expect(player).toContain('data-tv-primary')
    expect(player).toContain("event.key === 'MediaPlayPause'")
    expect(player).toContain("event.key === 'ArrowLeft') skip(-$seekDuration)")
    expect(player).toContain('setAndroidAutoPip($androidAutoPip && !$isAndroidTv)')
  })

  it('asks the web layer first on phone system Back and falls through to stock Back', () => {
    const kotlin = activity.replace(/\r\n/g, '\n')
    const bridge = read('../nav/system-back.ts').replace(/\r\n/g, '\n')
    expect(kotlin).toContain('import androidx.activity.OnBackPressedCallback')
    // Only phones and tablets get the callback; TV keeps its KEYCODE_BACK to Escape translation.
    expect(kotlin).toContain('    if (!television) {\n      installSystemBackBridge(webView)\n      return\n    }')
    expect(kotlin.split('installSystemBackBridge(').length - 1).toBe(2)
    expect(kotlin).toContain('object : OnBackPressedCallback(true) {')
    // The back gesture never sends KEYCODE_BACK, so this goes through the dispatcher, not dispatchKeyEvent.
    expect(kotlin).toContain('webView.evaluateJavascript("window.__izumiBack?.()===true") { handled ->')
    expect(kotlin).toContain('if (handled == "true" || isFinishing || isDestroyed) return@evaluateJavascript')
    expect(kotlin).toContain('bridge.isEnabled = false\n          onBackPressedDispatcher.onBackPressed()\n          bridge.isEnabled = true')
    expect(kotlin).toContain('onBackPressedDispatcher.addCallback(this, callback)')
    expect(kotlin).toContain('if (television && event.keyCode == KeyEvent.KEYCODE_BACK) {')
    // The global the activity evaluates is the one the web layer installs.
    expect(bridge).toContain("const bridge = () => handleLayeredBack('system')")
    expect(bridge).toContain('target.__izumiBack = bridge')
  })

  it('scopes phone Back to the full player and closes its settings sheet on a window Escape', () => {
    const shell = player.replace(/\r\n/g, '\n')
    // nav/back.ts limits every lookup to this marker while the full-screen player is up.
    expect(shell).toContain('<div class="player-shell fixed inset-0 z-50 select-none overflow-hidden text-white" data-android-player class:hidden={overlayHidden}')
    // The sheet is a legacy trap that closes on a window Escape, the form phone system Back takes.
    // On a phone it stops being one while it slides closed, so a second Back is not absorbed.
    expect(shell).toContain("  const sheetTrap = $derived(sheetClosing && !$isAndroidTv ? undefined : '')")
    expect(shell).toContain('aria-label="Video settings" tabindex="-1" data-nav-trap={sheetTrap} data-nav-escape={sheetTrap}>')
    expect(shell).toContain([
      '  function onPhoneSheetKeydown(event: KeyboardEvent) {',
      "    if ($isAndroidTv || miniLayout || !sheet || sheetClosing || event.defaultPrevented || event.key !== 'Escape') return",
      '    event.preventDefault()',
      '    dismissSettings()',
      '  }',
    ].join('\n'))
    expect(shell).toContain([
      '  function onWindowKeydown(event: KeyboardEvent) {',
      '    onTvKeydown(event)',
      '    onPhoneSheetKeydown(event)',
      '  }',
    ].join('\n'))
    expect(shell).toContain('<svelte:window onkeydown={onWindowKeydown} />')
    expect(shell.split('<svelte:window').length - 1).toBe(1)
    // TV remote Back keeps its own handler, unchanged (spec §3.11).
    expect(shell).toContain([
      '  function onTvKeydown(event: KeyboardEvent) {',
      '    if (!$isAndroidTv || miniLayout) return',
      '',
      "    if (event.key === 'Escape' || event.key === 'BrowserBack' || event.key === 'GoBack') {",
      '      event.preventDefault()',
      '      if (sheet) dismissSettings()',
      '      else void close()',
      '      return',
      '    }',
    ].join('\n'))
  })
})
