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

describe('pad sliders and roving tabs wiring (commit 4)', () => {
  const source = (relative: string) =>
    readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8').replace(/\r\n/g, '\n')
  const nav = source('./index.ts')
  const overlay = source('../components/player/PlayerOverlay.svelte')

  it('steps a focused slider after the landing block and before the named overrides, off TV only', () => {
    const landing = nav.indexOf('const active = document.activeElement as HTMLElement')
    const hook = nav.indexOf('if (isPadEvent(e) && !get(isTv) && padAdjust(active, dir, e.repeat)) {')
    expect(landing).toBeGreaterThan(-1)
    expect(hook).toBeGreaterThan(landing)
    expect(hook).toBeLessThan(nav.indexOf('const explicitName = active.getAttribute('))
    expect(nav.split('padAdjust(').length - 1).toBe(1)
  })

  it('hands a keyboard-focused slider its Left/Right off TV, and a roving tab its own Left/Right', () => {
    // A regex, so commit 8 can add `navArrived` to the same options object.
    expect(nav).toMatch(/fieldOwnsArrow\(field, e\.key as ArrowKey, \{[^}]*rangeOwnsHorizontal: !get\(isTv\)/)
    expect(nav).toContain('rovingTab: isRovingTab(target),')
  })

  it('the subtitle editor steps its slider through the shared pad adapter', () => {
    const start = overlay.indexOf('if (subtitleEditorOpen) {')
    const end = overlay.indexOf('// The track menu captures the pad while open', start)
    const branch = overlay.slice(start, end)
    expect(start).toBeGreaterThan(-1)
    expect(end).toBeGreaterThan(start)
    expect(branch).toContain('if (key) dispatchPadKey(key)')
    expect(branch).not.toContain('stepDown()')
    expect(branch).not.toContain('stepUp()')
    expect(branch).not.toContain('new KeyboardEvent(')
  })
})

describe('native select chooser wiring', () => {
  const source = (relative: string) =>
    readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8').replace(/\r\n/g, '\n')

  it('pad A hands a native select to the chooser before any other activation', () => {
    const controls = source('./pad-controls.ts')
    expect(controls).toContain("import { padOpenPicker } from './native-picker'")
    const activate = controls.slice(controls.indexOf('export function padActivate('))
    expect(activate.indexOf('padOpenPicker(')).toBeGreaterThan(-1)
    expect(activate.indexOf('padOpenPicker(')).toBeLessThan(activate.indexOf('.click()'))
    // One resolution of an omitted argument, shared by the chooser branch and the rules below it.
    expect(activate.indexOf('const target = ')).toBeLessThan(activate.indexOf('padOpenPicker('))
    expect(activate).toContain('if (padOpenPicker(target)) return true')
    expect(controls.match(/document\.activeElement/g)).toHaveLength(1)
  })

  it.each([
    ['PersonalSchedule', '../components/schedule/PersonalSchedule.svelte'],
    ['ScheduleGrid', '../components/schedule/ScheduleGrid.svelte'],
  ])('%s leaves its day bumpers alone while a nav layer is open', (_name, file) => {
    const schedule = source(file)
    const start = schedule.indexOf('return onPadButton(')
    expect(start).toBeGreaterThan(-1)
    // Slice from the arrow body: the parameter list `({ name, pressed })` itself contains `})`.
    const body = schedule.indexOf('=> {', start)
    expect(body).toBeGreaterThan(start)
    const handler = schedule.slice(body, schedule.indexOf('})', body))
    const dayChange = handler.indexOf('selected =')
    expect(dayChange).toBeGreaterThan(-1)
    const layerGuard = handler.search(/if \((topNavLayer\(\)|get\(navLayerOpen\))\) return/)
    if (layerGuard > -1) {
      expect(schedule).toMatch(/import \{[^}]*\b(topNavLayer|navLayerOpen)\b[^}]*\} from '\$lib\/nav\/layers'/)
      expect(layerGuard).toBeLessThan(dayChange)
      return
    }
    // The Themes session's own form (Sidebar.svelte's bumper handler): a visible [data-nav-trap]
    // check, then an early return, before the day changes. The chooser panel is a [data-nav-trap].
    const trapCheck = handler.indexOf('[data-nav-trap]')
    expect(trapCheck, 'the day-bumper handler has no layer or dialog guard').toBeGreaterThan(-1)
    expect(trapCheck).toBeLessThan(dayChange)
    expect(handler.slice(trapCheck, dayChange)).toMatch(/\breturn\b/)
  })
})

describe('keyboard arrow landing (commit 8)', () => {
  const source = (relative: string) =>
    readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8').replace(/\r\n/g, '\n')
  /** Source without comments, so a comment that names a function is not counted as a call. */
  const code = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  /** The function declared at `declaration`, up to its closing brace at column 0. */
  const fn = (text: string, declaration: string) => {
    const at = text.indexOf(declaration)
    return at < 0 ? '' : text.slice(at, text.indexOf('\n}\n', at))
  }
  const nav = source('./index.ts')
  const body = fn(nav, 'export function focusByNav(')
  // revealRegionEntry is the reveal for a region's default item (it reveals through revealFocused
  // itself); focusByNav picks it for a move that enters a region on its default.
  const regionEntry = fn(nav, 'function revealRegionEntry(')
  const rest = code(nav.replace(body, ''))
  const outside = code(nav.replace(body, '').replace(regionEntry, ''))

  it('reveals only inside focusByNav, so every arrow move lands through one place', () => {
    expect(body).not.toBe('')
    expect(regionEntry).not.toBe('')
    expect(body).toContain('el.focus({ preventScroll: true })')
    expect(body).toContain('markNavArrived(el)')
    expect(body).toContain('recordLastNav(el)')
    expect(body).toContain('revealFocused(el, vertical, rapid)')
    expect(body).toContain('revealRegionEntry(el, vertical, rapid)')
    // Outside the two, the one match left is revealFocused's own declaration, and nothing else
    // calls revealRegionEntry.
    expect(outside.match(/\brevealFocused\(/g)).toHaveLength(1)
    expect(outside).toContain('function revealFocused(')
    expect(outside).not.toMatch(/\brevealRegionEntry\(/)
  })

  it('lands through focusByNav at every landing site, the side rail included', () => {
    for (const call of [
      'focusByNav(first, vertical, e.repeat)',
      'focusByNav(hinted, vertical, e.repeat)',
      'focusByNav(regionDefault, vertical, e.repeat, true)',
      'focusByNav(railPick, vertical, e.repeat)',
    ]) expect(rest, call).toContain(call)
    // Commit 4's explicit and row picks; the generic pick also reveals a region's default entry.
    expect(rest.split('focusByNav(target, vertical, e.repeat)').length - 1).toBe(2)
    expect(rest).toContain('focusByNav(target, vertical, e.repeat, entersRegionDefault)')
    expect(nav).not.toContain('railPick.focus(')
  })

  it('hands the landing to fieldOwnsArrow next to the slider option', () => {
    expect(nav).toMatch(/fieldOwnsArrow\(field, e\.key as ArrowKey, \{ rangeOwnsHorizontal: !get\(isTv\), navArrived: isNavArrived\(e\.target\) \}\)/)
  })

  it('lets a landed keyboard arrow walk past a dropdown trigger instead of opening it', () => {
    expect(nav).toContain("|| (el instanceof HTMLButtonElement && el.getAttribute('aria-haspopup') === 'listbox')")
    for (const file of ['../components/settings/SelectMenu.svelte', '../components/catalog/CatalogSwitcher.svelte']) {
      const markup = source(file)
      expect(markup, file).toContain("import { isNavArrived } from '$lib/nav'")
      const handler = markup.slice(markup.indexOf('function onTriggerKeydown('))
      const guard = handler.indexOf("if ((event.key === 'ArrowDown' || event.key === 'ArrowUp') && isNavArrived(event.currentTarget)) return")
      expect(guard, file).toBeGreaterThan(-1)
      expect(guard, file).toBeLessThan(handler.indexOf("if (['Enter', ' ', 'ArrowDown', 'ArrowUp'].includes(event.key)) {"))
    }
  })

  it('records an arrow move without reading the control’s identity (it runs on every d-pad step)', () => {
    const at = nav.indexOf('function recordLastNav(')
    expect(at).toBeGreaterThan(-1)
    const record = nav.slice(at, nav.indexOf('\n}\n', at))
    expect(record).toContain("el.closest<HTMLElement>('[data-nav-surface]')")
    expect(record).not.toMatch(/describeFocus|controlLabel|querySelectorAll|textContent|focusables\(/)
  })

  it('tries focus-loss recovery after the focus hint and before the region default', () => {
    const hint = nav.indexOf('const hinted = takeFocusHint(root)')
    const recovered = nav.indexOf('const recovered = recoverLostFocus(root, active)')
    const region = nav.indexOf('const regionDefault = regionReturnTarget(root)')
    expect(hint).toBeGreaterThan(-1)
    expect(recovered).toBeGreaterThan(hint)
    expect(region).toBeGreaterThan(recovered)
    expect(rest).toContain('focusByNav(recovered, vertical, e.repeat)')
  })
})
