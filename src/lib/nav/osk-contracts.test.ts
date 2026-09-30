import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

// Source contracts for the on-screen keyboard (settings fix pass commit 6; spec §3.7, §7). Paths
// are relative to src/, and every file is read with CRLF normalised (core.autocrlf=true).
const SRC = fileURLToPath(new URL('../../', import.meta.url))
const read = (fromSrc: string) => readFileSync(join(SRC, fromSrc), 'utf8').replace(/\r\n/g, '\n')

/** Every .svelte/.ts/.css source under src/, minus tests and the generated paraglide output. */
function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return name === 'paraglide' ? [] : sourceFiles(path)
    if (name.endsWith('.test.ts') || !/\.(svelte|ts|css)$/.test(name)) return []
    return [relative(SRC, path).split(sep).join('/')]
  })
}
const FILES = sourceFiles(SRC)
const KEYBOARD = 'lib/components/shell/OnScreenKeyboard.svelte'

describe('the keyboard view (OnScreenKeyboard.svelte)', () => {
  const view = read(KEYBOARD)

  it('is portalled to <body>, marked data-osk and trapped, at z-190 with a 120 ms fade each way', () => {
    expect(view).toContain("import { portal } from '$lib/util/portal'")
    expect(view).toContain('use:portal')
    expect(view).toContain('data-osk')
    expect(view).toContain('data-nav-trap')
    expect(view).toContain('z-[190]')
    expect(view).toContain('in:fade={{ duration: 120 }}')
    expect(view).toContain('out:fade={{ duration: 120 }}')
    expect(view).not.toContain('z-[80]')
  })

  it('is a view over osk.ts: no focus opener, no Steam keyboard call, no zoom math', () => {
    expect(view).toContain('{#if $oskSession}')
    expect(view).toContain('onMount(() => startOsk())')
    expect(view).toContain('beforeNavigate(() => closeOsk({ restore: false }))')
    expect(view).toContain('revealAboveKeyboard(')
    expect(view).toContain('aria-hidden="true"')
    expect(view).not.toContain('focusin')
    expect(view).not.toContain('steam_show_osk')
    expect(view).not.toContain('uiScale')
    expect(view).not.toContain('controllerUi')
  })

  it('keeps the Steam keyboard command for the comments composer', () => {
    expect(read('lib/components/player/CommentsPanel.svelte')).toContain("invoke<boolean>('steam_show_osk'")
  })
})

describe('stacking', () => {
  const Z_LEVEL = /z-\[(\d+)\]|z-index:\s*(\d+)/g
  const levels = (file: string) => [...read(file).matchAll(Z_LEVEL)].map((match) => Number(match[1] ?? match[2]))
  // Drawn above the keyboard on purpose: the first-run ident and the fatal error alert.
  const ABOVE = ['lib/components/onboarding/IntroSequence.svelte', 'routes/+layout.svelte']

  it('puts the keyboard at 190, above every dialog, chooser and prompt', () => {
    expect(Math.max(...levels(KEYBOARD))).toBe(190)
    const offenders = FILES
      .filter((file) => file !== KEYBOARD && !ABOVE.includes(file))
      .flatMap((file) => levels(file).filter((level) => level >= 190).map((level) => `${file}: ${level}`))
    expect(offenders).toEqual([])
  })

  it('leaves only the intro ident and the fatal alert above it', () => {
    for (const file of ABOVE) expect(Math.max(...levels(file)), file).toBe(200)
  })
})

describe('controller buttons while the keyboard is up (gamepad.ts)', () => {
  const pad = read('lib/nav/gamepad.ts')

  it('B stamps the time and closes the keyboard directly; X deletes; Y types a space', () => {
    expect(pad).toContain("import { closeOsk, oskBackspace, oskInsert } from './osk'")
    expect(pad).toContain('oskDismissedAt.set(performance.now())')
    expect(pad).toContain('closeOsk()')
    expect(pad).toContain("else if (name === 'x') oskBackspace()")
    expect(pad).toContain("else if (name === 'y') oskInsert(' ')")
    expect(pad).not.toContain("new Event('osk-close')")
  })
})

describe('outside-press closers', () => {
  const PRESS = /(?:window|document)\.addEventListener\(\s*['"](?:pointerdown|mousedown)['"]|<svelte:(?:window|document)\b[^>]*\bon(?:pointerdown|mousedown)=/
  // Window/document press listeners that are not "close on a press outside" handlers.
  const NOT_CLOSERS = [
    'lib/components/onboarding/IntroSequence.svelte', // any press skips the ident, drawn above the keyboard
    'lib/components/shell/ButtonHints.svelte', // hides the controller prompts on pointer use
    'lib/nav/input.ts', // pointer modality; exempts a touch on the keys itself
    'lib/nav/osk.ts', // the keyboard's own outside-press close
    'lib/player/gm-touch-watchdog.ts', // Game-mode touch survival
  ]
  const NINE = [
    'lib/components/catalog/CatalogSwitcher.svelte',
    'lib/components/detail/EpisodeToolbar.svelte',
    'lib/components/detail/ListEditor.svelte',
    'lib/components/detail/SeasonPicker.svelte',
    'lib/components/player/WatchToolbar.svelte',
    'lib/components/search/MultiSelect.svelte',
    'lib/components/settings/SelectMenu.svelte',
    'lib/components/shell/CategoriesMenu.svelte',
    'routes/app/settings/sources/+page.svelte',
  ]
  const closers = FILES.filter((file) => !NOT_CLOSERS.includes(file) && PRESS.test(read(file)))

  it('finds the nine known closers', () => {
    expect(closers).toEqual(expect.arrayContaining(NINE))
  })

  it('every closer ignores a press on the keyboard (its keys type into what it closes)', () => {
    for (const file of closers) expect(read(file), file).toContain('isOskTarget(')
  })
})

describe('the player and the Steam keyboard warning around the keyboard', () => {
  it('Start cannot open the track menu over the keyboard (raw pad listener and keyboard)', () => {
    const menu = read('lib/components/player/TrackMenu.svelte')
    expect(menu.match(/if \(get\(oskOpen\)\) return/g)).toHaveLength(2)
  })

  it('one B that closed the keyboard never also closes the player', () => {
    const overlay = read('lib/components/player/PlayerOverlay.svelte')
    expect(overlay).toContain("if (e.payload.name === 'b' && e.payload.pressed && performance.now() - get(oskDismissedAt) < 500) return")
    expect(overlay).toContain('performance.now() - get(streamPickerDismissedAt) < 500')
  })

  it('the Steam keyboard warning closes the keyboard and hands focus back when it goes', () => {
    expect(read('lib/nav/osk.ts')).toContain('deckKeyboardWarning.subscribe(')
    const warning = read('lib/components/shell/DeckKeyboardWarning.svelte')
    expect(warning).toContain('const previous = ')
    expect(warning).toContain('previous.focus({ preventScroll: true })')
  })
})

describe('typing-only launchers open the keyboard at once (decision 7)', () => {
  it.each([
    ['lib/components/search/GlobalSearch.svelte', 'openOskForField(input)'],
    ['lib/components/settings/SettingsSearch.svelte', 'if (input) openOskForField(input)'],
    ['lib/components/settings/SelectMenu.svelte', 'if (searchable && searchInput) openOskForField(searchInput)'],
  ])('%s', (file, call) => {
    const source = read(file)
    expect(source).toMatch(/import \{[^}]*\bopenOskForField\b[^}]*\} from '\$lib\/nav\/osk'/)
    expect(source).toContain(call)
  })
})
