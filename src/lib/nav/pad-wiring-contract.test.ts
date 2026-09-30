import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

// Source contract for how controller keys are produced and who must ignore them. Behaviour lives in
// pad-delivery.test.ts (nav engine) and hotkeys.test.ts (player hotkey eligibility); this file pins
// the wiring in places a test cannot mount: the gamepad router's call sites, PlayerOverlay and the
// app layout. Commits 2, 4 and 5 extend it.

const read = (relative: string) =>
  readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8').replace(/\r\n/g, '\n')

const gamepad = read('./gamepad.ts')
const overlay = read('../components/player/PlayerOverlay.svelte')
const layout = read('../../routes/app/+layout.svelte')

/** `source` from the first `start` up to the next `end` after it. */
function sliceBetween(source: string, start: string, end: string): string {
  const from = source.indexOf(start)
  expect(from, `missing: ${start}`).toBeGreaterThan(-1)
  const to = source.indexOf(end, from + start.length)
  expect(to, `missing after ${start}: ${end}`).toBeGreaterThan(from)
  return source.slice(from, to)
}

describe('pad key wiring', () => {
  it('delivers every synthetic pad key through dispatchPadKey', () => {
    expect(gamepad).toMatch(/import \{[^}]*\bdispatchPadKey\b[^}]*\} from '\.\/pad-controls'/)
    expect(gamepad).toContain('function keydown(key: string, repeat = false) {\n  dispatchPadKey(key, { repeat })\n}')
    expect(gamepad).not.toContain("new KeyboardEvent('keydown'")
    // continue-dismiss.test.ts pins the X button through the same helper.
    expect(gamepad).toContain("case 'x': keydown('d')")
  })
})

describe('player safety', () => {
  it('asks playerHotkeyEligible before looking up a player hotkey', () => {
    expect(overlay).not.toContain('isTypingTarget')
    const capture = sliceBetween(overlay, 'const onKeyCapture = (e: KeyboardEvent) => {', "window.addEventListener('keydown', onKeyCapture, true)")
    const eligible = capture.indexOf('if (!playerHotkeyEligible(e, { oskOpen: get(oskOpen), layerOpen: ')
    const lookup = capture.indexOf("findHotkey(e, get(hotkeyBindings), 'Player')")
    expect(eligible).toBeGreaterThan(-1)
    expect(lookup).toBeGreaterThan(eligible)
  })

  it('blocks the seek scrubber while Change source or the on-screen keyboard is up', () => {
    const blocked = overlay.match(/blocked: \(\) => ([^\n]*),\n/)?.[1] ?? ''
    expect(blocked).toContain('subtitleEditorOpen')
    expect(blocked).toContain('sourcePickerVisible')
    expect(blocked).toContain('get(oskOpen)')
  })

  it('lets a visible Change source picker take Left/Right during playback', () => {
    expect(gamepad).toMatch(/const picker = get\(streamPicker\)\n\s*const pickerUp = !!picker && !picker\.hidden\n/)
    expect(gamepad).toMatch(/if \(inPlayer\(\) && !get\(commentsOpen\) && !get\(playerMenuOpen\) && !pickerUp\b[^\n]*\(dir === 'left' \|\| dir === 'right'\)\) return/)
  })
})

describe('shell hotkeys', () => {
  it('drops pad keys on the first line of handleShellKeydown', () => {
    expect(layout).toContain("import { isPadEvent } from '$lib/nav/pad-controls'")
    const start = layout.indexOf('function handleShellKeydown(event: KeyboardEvent) {')
    expect(start).toBeGreaterThan(-1)
    const firstLine = layout.slice(start).split('\n')[1].trim()
    expect(firstLine).toMatch(/^if \(isPadEvent\(event\)\) return\b/)
  })
})
