import { describe, expect, it } from 'vitest'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import {
  attr, descendantsOf, hasAttr, hasSpread, importClosure, markupElements, markupElementsFromSource,
  parseSvelteSource, readSvelteSource, repoRelative, staticAttr, svelteFilesUnder, walkTemplate,
  type MarkupElement,
} from '../../test/svelte-markup'
import { NON_TEXT_INPUT_TYPES } from './text-field'

// Static reachability contract for Settings (spec §4, §7). Every control a Settings page can show
// must be a d-pad target, every overlay must be closable with B, every scroller the d-pad can
// travel must say so, and every <summary> must take focus. Rules:
//   R1  every interactive element carries data-focusable, or a written exemption; unmarked text
//       fields are counted per file against PENDING_TEXT_FIELDS, which shrinks to empty
//   R2  a static data-focusable never pairs with tabindex="-1" (except a roving role=tab)
//   R3  every data-nav-trap is a navLayer, or has data-nav-escape plus a window-level Escape;
//       no element inside a legacy trap handles Escape itself (a double close)
//   R3b every role dialog/alertdialog/menu/listbox or aria-modal is trapped (or a native <dialog>)
//   R4  an overflow box holding controls carries the scroll marker for its axis
//   R5  a non-native data-focusable has a tabindex
//   R6  every <summary> in src carries data-focusable tabindex="0"

const fromRepo = (path: string) => fileURLToPath(new URL(`../../../${path}`, import.meta.url))

// The Settings routes plus the pieces Settings opens that no Settings file imports statically.
const EXTRAS = [
  'src/lib/components/shell/OnScreenKeyboard.svelte',
  'src/lib/components/profiles/ProfileSwitcher.svelte',
  'src/lib/components/themes/ThemeInstallPreview.svelte',
  'src/lib/components/catalog/HomeEditor.svelte',
  'src/lib/components/catalog/HomeRowFrame.svelte',
  'src/lib/components/settings/ThemeStudio.svelte',
  'src/routes/app/nuvio/+page.svelte',
]
const FILES = importClosure(svelteFilesUnder(fromRepo('src/routes/app/settings')), EXTRAS.map(fromRepo))

/** [T] text fields not marked yet. Commit 8 (A opens the keyboard, trusted arrows pass over a
 *  field) marks them and deletes each entry; this list must end empty. Counts are exact, so marking
 *  a field without lowering its count fails too. */
const PENDING_TEXT_FIELDS: Record<string, number> = {
  'src/lib/components/catalog/HomeEditor.svelte': 1,
  'src/lib/components/catalog/NuvioBrowser.svelte': 1,
  'src/lib/components/catalog/NuvioCloudCollections.svelte': 1,
  'src/lib/components/catalog/NuvioCloudMedia.svelte': 1,
  'src/lib/components/catalog/NuvioCloudSettings.svelte': 3,
  'src/lib/components/catalog/NuvioCloudSources.svelte': 1,
  'src/lib/components/catalog/NuvioConnection.svelte': 2,
  'src/lib/components/settings/SelectMenu.svelte': 1,
  'src/lib/components/settings/SettingsSearch.svelte': 1,
  'src/routes/app/settings/accounts/+page.svelte': 1,
  'src/routes/app/settings/catalog/collections/+page.svelte': 3,
  'src/routes/app/settings/catalog/home/+page.svelte': 5,
  'src/routes/app/settings/scenes/+page.svelte': 1,
}

/** [TD] text fields: inside a native <dialog> the body-portalled keyboard is inert, so these wait
 *  for the keyboard-inside-modal follow-up (spec §3.7 known limit, §4 legend). A text field with
 *  a <dialog> ancestor in its own file is recognised; these components render only inside their
 *  host's <dialog> (verified below). */
const MODAL_ONLY_COMPONENTS: Record<string, string> = {
  'src/lib/components/catalog/NuvioCoverPicker.svelte': 'src/lib/components/catalog/NuvioCloudCollections.svelte',
}

/** Legacy traps whose window Escape lives in the component that renders them. */
const ESCAPE_OWNERS: Record<string, string> = {
  // BlockSettings is rendered only by HomeEditor, whose window keydown closes it first.
  'src/lib/components/home/BlockSettings.svelte': 'src/lib/components/catalog/HomeEditor.svelte',
}

/** Deferred with written reasons (spec §4): outside the Settings closure, not scanned. The test
 *  below fails if one of them starts being reachable from Settings, forcing a decision. */
const DEFERRED_OUTSIDE_SETTINGS: Record<string, string> = {
  'src/lib/components/library/LocalListManager.svelte': 'library list manager; its own pass',
  'src/lib/components/library/LocalListPicker.svelte': 'element and window Escape; library pass',
  'src/lib/components/player/UpNextOverlay.svelte': 'player overlay owned by the player chain',
  'src/lib/components/watch/DebridRoomNotice.svelte': 'watch-room notice; player pass',
  'src/lib/components/detail/AnimeDetail.svelte': 'showMore overflow menu (:475); Themes-owned file',
  'src/lib/components/player/Controls.svelte': 'desktop player menus (:938, :1063) get no pad input',
  'src/lib/components/player/DesktopCastButton.svelte': 'desktop cast menu (:333); no pad input',
}

interface Scan { file: string; rel: string; source: string; elements: MarkupElement[] }

function scanFile(file: string): Scan {
  const source = readSvelteSource(file)
  return { file, rel: repoRelative(file), source, elements: markupElementsFromSource(source, file) }
}
function scanSource(source: string, rel: string): Scan {
  return { file: rel, rel, source, elements: markupElementsFromSource(source, rel) }
}
const where = (scan: Scan, el: MarkupElement) => `${scan.rel}:${el.line} <${el.name}>`

const INTERACTIVE_ROLES = [
  'button', 'link', 'tab', 'menuitem', 'menuitemcheckbox', 'menuitemradio', 'option', 'checkbox',
  'switch', 'radio', 'slider', 'spinbutton', 'combobox', 'textbox', 'searchbox', 'treeitem',
]

function isInteractive(el: MarkupElement): boolean {
  if (el.name === 'button' || el.name === 'select' || el.name === 'textarea' || el.name === 'summary') return true
  if (el.name === 'a') return hasAttr(el, 'href')
  if (el.name === 'input') return staticAttr(el, 'type')?.toLowerCase() !== 'hidden'
  if (hasAttr(el, 'contenteditable')) return true
  const role = staticAttr(el, 'role')
  if (role && INTERACTIVE_ROLES.includes(role)) return true
  const tabindex = staticAttr(el, 'tabindex')
  if (tabindex !== undefined && Number(tabindex) >= 0) return true
  if (el.name === 'svelte:element') return hasAttr(el, 'href') || hasAttr(el, 'onclick')
  return false
}

/** Mirrors isTextEntryField (src/lib/nav/text-field.ts) on markup: fields the keyboard types into. */
function isTextEntry(el: MarkupElement): boolean {
  if (hasAttr(el, 'readonly') || hasAttr(el, 'data-clipboard-proxy')) return false
  if (el.name === 'textarea' || hasAttr(el, 'contenteditable')) return true
  if (el.name !== 'input') return false
  const type = attr(el, 'type')
  if (!type || typeof type.value !== 'string') return true // no type, or a text/password toggle
  return !NON_TEXT_INPUT_TYPES.includes(type.value.toLowerCase())
}

/** Why an unmarked interactive element is not a d-pad target on purpose, or null. */
function exemption(el: MarkupElement): string | null {
  if (staticAttr(el, 'tabindex') === '-1') return 'taken out of the focus order (tabindex="-1")'
  if (staticAttr(el, 'aria-hidden') === 'true') return 'aria-hidden'
  if (hasAttr(el, 'hidden')) return 'hidden attribute'
  if (/(^|\s)hidden(\s|$)/.test(staticAttr(el, 'class') ?? '')) return 'display:none proxy (a file input behind a button)'
  if (attr(el, 'disabled')?.value === true) return 'always disabled'
  if (el.ancestors.some((ancestor) => hasAttr(ancestor, 'inert'))) return 'inside an inert preview'
  if (hasSpread(el)) return 'attributes forwarded by a spread'
  return null
}

interface R1Result { controls: string[]; textEntries: string[]; modalTextEntries: string[] }

function ruleR1(scan: Scan, modalOnly = false): R1Result {
  const result: R1Result = { controls: [], textEntries: [], modalTextEntries: [] }
  for (const el of scan.elements) {
    if (!isInteractive(el) || hasAttr(el, 'data-focusable') || exemption(el)) continue
    if (!isTextEntry(el)) result.controls.push(where(scan, el))
    else if (modalOnly || el.ancestors.some((ancestor) => ancestor.name === 'dialog')) result.modalTextEntries.push(where(scan, el))
    else result.textEntries.push(where(scan, el))
  }
  return result
}

function ruleR2(scan: Scan): string[] {
  return scan.elements
    .filter((el) => {
      const marker = attr(el, 'data-focusable')
      if (!marker || marker.value === null || staticAttr(el, 'tabindex') !== '-1') return false
      const rovingTab = staticAttr(el, 'role') === 'tab'
        && el.ancestors.some((ancestor) => staticAttr(ancestor, 'role') === 'tablist')
      return !rovingTab
    })
    .map((el) => `${where(scan, el)} pairs a static data-focusable with tabindex="-1"`)
}

const WINDOW_KEYDOWN = /<svelte:window\b[^>]*\bonkeydown\s*=|window\.addEventListener\(\s*['"]keydown['"]/
const ESCAPE_KEY = /['"]Escape['"]/

function hasWindowEscape(source: string): boolean {
  return WINDOW_KEYDOWN.test(source) && ESCAPE_KEY.test(source)
}

type Spanned = { start: number; end: number }

/** Source of the instance-script function or const named `name` ('' when there is none). */
function functionSource(source: string, name: string): string {
  const program = parseSvelteSource(source).instance?.content
  for (const statement of program?.body ?? []) {
    if (statement.type === 'FunctionDeclaration' && statement.id?.name === name) {
      const span = statement as unknown as Spanned
      return source.slice(span.start, span.end)
    }
    if (statement.type !== 'VariableDeclaration') continue
    for (const declarator of statement.declarations) {
      if (declarator.id.type === 'Identifier' && declarator.id.name === name && declarator.init) {
        const span = declarator.init as unknown as Spanned
        return source.slice(span.start, span.end)
      }
    }
  }
  return ''
}

/** The keydown handler an element declares, a bare identifier resolved to the function it names. */
function keydownHandlerSource(el: MarkupElement, source: string): string {
  const handler = attr(el, 'onkeydown') ?? attr(el, 'on:keydown')
  if (!handler) return ''
  const name = handler.raw.match(/=\{\s*([A-Za-z_$][\w$]*)\s*\}$/)?.[1]
  return name ? functionSource(source, name) : handler.raw
}

function ruleR3(scan: Scan, ownerSource: string): string[] {
  const problems: string[] = []
  for (const trap of scan.elements.filter((el) => hasAttr(el, 'data-nav-trap'))) {
    // The on-screen keyboard closes through osk.ts (its own Escape/B handling, spec §3.7).
    if (hasAttr(trap, 'data-osk')) continue
    if ([trap, ...trap.ancestors].some((el) => hasAttr(el, 'use:navLayer'))) continue
    if (!hasAttr(trap, 'data-nav-escape')) {
      problems.push(`${where(scan, trap)} is a legacy trap without data-nav-escape (use:navLayer, or data-nav-escape plus a window Escape)`)
    } else if (!hasWindowEscape(ownerSource)) {
      problems.push(`${where(scan, trap)} has data-nav-escape but no window-level Escape listener`)
    }
    for (const el of [trap, ...descendantsOf(trap, scan.elements)]) {
      if (ESCAPE_KEY.test(keydownHandlerSource(el, scan.source))) {
        problems.push(`${where(scan, el)} handles Escape itself inside a legacy trap (the window Escape already closes it: a double close)`)
      }
    }
  }
  return problems
}

const MODAL_ROLES = ['dialog', 'alertdialog', 'menu', 'listbox']
const isTrapOrLayer = (el: MarkupElement) => hasAttr(el, 'data-nav-trap') || hasAttr(el, 'use:navLayer')

function ruleR3b(scan: Scan): string[] {
  return scan.elements
    .filter((el) => {
      const role = staticAttr(el, 'role')
      if (!(role && MODAL_ROLES.includes(role)) && !hasAttr(el, 'aria-modal')) return false
      // A native <dialog> is handled by activeNavTrap() step 3 and cancelModalDialog().
      if (el.name === 'dialog') return false
      return ![el, ...el.ancestors, ...descendantsOf(el, scan.elements)].some(isTrapOrLayer)
    })
    .map((el) => `${where(scan, el)} (role ${staticAttr(el, 'role') ?? 'aria-modal'}) is not a trap or nav layer`)
}

type Axis = 'x' | 'y' | 'both'
const mergeAxis = (current: Axis | null, next: Axis): Axis => (current && current !== next ? 'both' : next)

/** Classes the component's own <style> gives `overflow…: auto | scroll`, with the axis. */
function scopedOverflowClasses(source: string): Map<string, Axis> {
  const classes = new Map<string, Axis>()
  const style = source.match(/<style[^>]*>([\s\S]*?)<\/style>/)?.[1] ?? ''
  for (const rule of style.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const overflow = rule[2].match(/overflow(-[xy])?\s*:\s*(?:auto|scroll)/)
    if (!overflow) continue
    const axis: Axis = overflow[1] === '-x' ? 'x' : overflow[1] === '-y' ? 'y' : 'both'
    for (const selector of rule[1].split(',')) {
      const last = selector.trim().split(/\s+/).pop() ?? ''
      for (const match of last.matchAll(/\.([\w-]+)/g)) classes.set(match[1], mergeAxis(classes.get(match[1]) ?? null, axis))
    }
  }
  return classes
}

const OVERFLOW_UTILITY = /(?:^|[\s"'`{:])overflow(?:-([xy]))?-(?:auto|scroll)(?=$|[\s"'`}])/g

function overflowAxis(el: MarkupElement, scoped: Map<string, Axis>): Axis | null {
  const raw = attr(el, 'class')?.raw ?? ''
  let axis: Axis | null = null
  for (const match of raw.matchAll(OVERFLOW_UTILITY)) axis = mergeAxis(axis, (match[1] as 'x' | 'y' | undefined) ?? 'both')
  for (const token of raw.split(/[\s"'`{}=]+/)) {
    const scopedAxis = scoped.get(token)
    if (scopedAxis) axis = mergeAxis(axis, scopedAxis)
  }
  return axis
}

/** Controls, or a component or snippet that may render them. */
function holdsControls(el: MarkupElement, scan: Scan): boolean {
  if (descendantsOf(el, scan.elements).some((child) => isInteractive(child) || hasAttr(child, 'data-focusable'))) return true
  let found = false
  walkTemplate(el.node.fragment, (node) => {
    if (node.type === 'Component' || node.type === 'SvelteComponent' || node.type === 'RenderTag') found = true
  })
  return found
}

function ruleR4(scan: Scan): string[] {
  const scoped = scopedOverflowClasses(scan.source)
  const problems: string[] = []
  for (const el of scan.elements) {
    const axis = overflowAxis(el, scoped)
    if (!axis || !holdsControls(el, scan)) continue
    const marked = axis === 'x'
      ? hasAttr(el, 'data-nav-scroll-x') || hasAttr(el, 'data-carousel-scroller')
      : hasAttr(el, 'data-nav-scroll-container') || hasAttr(el, 'data-nav-sidebar')
    if (!marked) {
      problems.push(`${where(scan, el)} scrolls (${axis}) around controls without ${axis === 'x' ? 'data-nav-scroll-x' : 'data-nav-scroll-container'}`)
    }
  }
  return problems
}

const NATIVELY_FOCUSABLE = ['button', 'select', 'textarea', 'input', 'summary', 'iframe']

function ruleR5(scan: Scan): string[] {
  return scan.elements
    .filter((el) => hasAttr(el, 'data-focusable')
      && !NATIVELY_FOCUSABLE.includes(el.name)
      && !(el.name === 'a' && hasAttr(el, 'href'))
      && !hasAttr(el, 'tabindex')
      && !hasAttr(el, 'contenteditable'))
    .map((el) => `${where(scan, el)} is data-focusable but not focusable without a tabindex`)
}

function ruleR6(scan: Scan): string[] {
  return scan.elements
    .filter((el) => el.name === 'summary' && !(hasAttr(el, 'data-focusable') && staticAttr(el, 'tabindex') === '0'))
    .map((el) => `${where(scan, el)} needs data-focusable tabindex="0" (WebKitGTK does not reliably focus a bare summary)`)
}

const SCANS = FILES.map(scanFile)
const scanOf = (rel: string) => SCANS.find((scan) => scan.rel === rel) ?? scanFile(fromRepo(rel))

describe('Settings reachability contract (spec §4, §7)', () => {
  it('scans the Settings routes, what they import and the explicit extras', () => {
    const rels = SCANS.map((scan) => scan.rel)
    for (const rel of [
      'src/routes/app/settings/+layout.svelte',
      'src/lib/components/settings/SettingsNav.svelte',
      'src/lib/components/settings/SelectMenu.svelte',
      'src/lib/components/catalog/NuvioCloudSettings.svelte',
      'src/lib/components/shell/OnScreenKeyboard.svelte',
      'src/routes/app/nuvio/+page.svelte',
    ]) expect(rels).toContain(rel)
  })

  it('R1: every non-text control is a d-pad target or carries a written exemption', () => {
    expect(SCANS.flatMap((scan) => ruleR1(scan, scan.rel in MODAL_ONLY_COMPONENTS).controls)).toEqual([])
  })

  it('R1: unmarked text fields match PENDING_TEXT_FIELDS exactly', () => {
    const counts: Record<string, number> = {}
    for (const scan of SCANS) {
      const pending = ruleR1(scan, scan.rel in MODAL_ONLY_COMPONENTS).textEntries.length
      if (pending) counts[scan.rel] = pending
    }
    expect(counts).toEqual(PENDING_TEXT_FIELDS)
  })

  it('R1: a modal-only component renders only inside a native <dialog> of its host', () => {
    const everySvelte = svelteFilesUnder(fromRepo('src'))
    for (const [component, host] of Object.entries(MODAL_ONLY_COMPONENTS)) {
      const name = component.slice(component.lastIndexOf('/') + 1, -'.svelte'.length)
      const importers = everySvelte.filter((file) => readSvelteSource(file).includes(`/${name}.svelte'`)).map(repoRelative)
      expect(importers).toEqual([host])
      const hostSource = readSvelteSource(fromRepo(host))
      const dialogs = markupElementsFromSource(hostSource, host).filter((el) => el.name === 'dialog')
      const uses = [...hostSource.matchAll(new RegExp(`<${name}\\b`, 'g'))].map((match) => match.index ?? -1)
      expect(uses.length).toBeGreaterThan(0)
      for (const offset of uses) {
        expect(dialogs.some((dialog) => dialog.node.start < offset && offset < dialog.node.end)).toBe(true)
      }
    }
  })

  it('R2: no static data-focusable is taken out of the focus order', () => {
    expect(SCANS.flatMap(ruleR2)).toEqual([])
  })

  it('R3: every trap closes with B (a nav layer, or data-nav-escape plus a window Escape)', () => {
    expect(SCANS.flatMap((scan) => {
      const owner = ESCAPE_OWNERS[scan.rel]
      return ruleR3(scan, owner ? readSvelteSource(fromRepo(owner)) : scan.source)
    })).toEqual([])
  })

  it('R3b: every dialog, menu and listbox is trapped', () => {
    expect(SCANS.flatMap(ruleR3b)).toEqual([])
  })

  it('R4: every scroller around controls tells the d-pad which way it scrolls', () => {
    expect(SCANS.flatMap(ruleR4)).toEqual([])
  })

  it('R5: every non-native data-focusable is focusable', () => {
    expect(SCANS.flatMap(ruleR5)).toEqual([])
  })

  it('R6: every <summary> in src takes focus (not only Settings)', () => {
    const withSummary = svelteFilesUnder(fromRepo('src')).filter((file) => readSvelteSource(file).includes('<summary'))
    expect(withSummary.length).toBeGreaterThan(0)
    expect(withSummary.map(scanFile).flatMap(ruleR6)).toEqual([])
  })

  it('keeps the deferred components outside the Settings closure', () => {
    const rels = SCANS.map((scan) => scan.rel)
    for (const rel of Object.keys(DEFERRED_OUTSIDE_SETTINGS)) {
      expect(existsSync(fromRepo(rel))).toBe(true)
      expect(rels).not.toContain(rel)
    }
  })
})

describe('Settings reachability: markers the generic rules cannot infer (spec §4)', () => {
  const elementsOf = (rel: string) => scanOf(rel).elements

  it('gives Theme Studio its own nav region, entered on its current tab', () => {
    const elements = elementsOf('src/lib/components/settings/ThemeStudio.svelte')
    const [panel] = elements.filter((el) => hasAttr(el, 'data-theme-studio'))
    expect(staticAttr(panel, 'data-nav-region')).toBe('theme-studio')
    // After a tap inside the panel, body fallback step 3 returns the first pad press to this tab.
    const defaults = elements.filter((el) => hasAttr(el, 'data-nav-region-default'))
    expect(defaults.map((el) => attr(el, 'data-nav-region-default')?.raw))
      .toEqual([`data-nav-region-default={category === item.id ? '' : undefined}`])
    expect(defaults[0].ancestors.some((el) => staticAttr(el, 'aria-label') === 'Theme controls')).toBe(true)
  })

  it('caps the extensions package list as the one nested scroller in src', () => {
    const nested = elementsOf('src/routes/app/settings/extensions/+page.svelte')
      .filter((el) => staticAttr(el, 'data-nav-scroll-container') === 'nested')
    expect(nested.map((el) => el.name)).toEqual(['ul'])
    const everywhere = svelteFilesUnder(fromRepo('src'))
      .filter((file) => readSvelteSource(file).includes('data-nav-scroll-container="nested"'))
      .map(repoRelative)
    expect(everywhere).toEqual(['src/routes/app/settings/extensions/+page.svelte'])
  })

  it('marks the Nuvio browser as a nav surface', () => {
    const [root] = elementsOf('src/lib/components/catalog/NuvioBrowser.svelte')
    expect(staticAttr(root, 'data-nav-surface')).toBe('nuvio')
  })

  it('takes the three read-only sync secrets out of the d-pad order (their Copy buttons act)', () => {
    const sync = elementsOf('src/routes/app/settings/sync/+page.svelte')
    for (const label of ['Cloudflare setup secret', 'Cloudflare device invite', 'Pairing ticket']) {
      const field = sync.find((el) => staticAttr(el, 'aria-label') === label && hasAttr(el, 'readonly'))
      expect(field, label).toBeDefined()
      expect(staticAttr(field!, 'tabindex'), label).toBe('-1')
      expect(hasAttr(field!, 'data-focusable'), label).toBe(false)
    }
  })

  it('makes read-only lists walkable with controller-only stops', () => {
    for (const rel of [
      'src/routes/app/settings/changelog/+page.svelte',
      'src/routes/app/settings/catalog/collections/+page.svelte',
      'src/lib/components/catalog/NuvioCloudSettings.svelte',
    ]) {
      const scan = scanOf(rel)
      expect(scan.source, rel).toContain('const stops = $derived($gameMode || $controllerMode)')
      const stops = scan.elements.filter((el) => attr(el, 'data-focusable')?.raw === "data-focusable={stops ? '' : undefined}"
        && attr(el, 'tabindex')?.raw === 'tabindex={stops ? 0 : undefined}')
      expect(stops.length, rel).toBe(1)
    }
  })

  it('keeps the Home editor grip pointer-only and its Move buttons focusable at either end', () => {
    const scan = scanOf('src/lib/components/catalog/HomeRowFrame.svelte')
    const grip = scan.elements.find((el) => staticAttr(el, 'title') === 'Drag to reorder')
    expect(grip && staticAttr(grip, 'tabindex')).toBe('-1')
    expect(grip && hasAttr(grip, 'data-focusable')).toBe(false)
    for (const direction of ['up', 'down']) {
      const move = scan.elements.find((el) => staticAttr(el, 'data-row-move') === direction)
      expect(move && hasAttr(move, 'aria-disabled'), direction).toBe(true)
      expect(move && hasAttr(move, 'disabled'), direction).toBe(false)
      expect(move && hasAttr(move, 'data-focusable'), direction).toBe(true)
    }
    expect(scan.source).toContain('await tick()')
    expect(scan.source).toContain('[data-row-move="${button.dataset.rowMove}"]')
    expect(scan.source).toContain('moveHomeRowBy(target, visibleIds, rowId, -1)')
    expect(scan.source).toContain('moveHomeRowBy(target, visibleIds, rowId, 1)')
  })

  it('answers the Anime shader prompt from the pad and hands focus back to Video quality', () => {
    const scan = scanOf('src/routes/app/settings/player/+page.svelte')
    for (const answer of ['answerAnimeConsent(true)', 'answerAnimeConsent(false)']) {
      const button = scan.elements.find((el) => el.name === 'button' && (attr(el, 'onclick')?.raw ?? '').includes(answer))
      expect(button, answer).toBeDefined()
      expect(staticAttr(button!, 'type'), answer).toBe('button')
      expect(hasAttr(button!, 'data-focusable'), answer).toBe(true)
    }
    expect(scan.source).toContain('bind:this={qualityField}')
    expect(scan.source).toContain('if (focusRestoreAllowed()) trigger.focus({ preventScroll: true })')
    expect(scan.source).toContain('else setFocusHint(trigger)')
  })
})

describe('reachability scanner self-tests', () => {
  const fixture = (markup: string) => scanSource(markup, 'fixture.svelte')

  it('R1 walks if/each/snippet blocks, honours exemptions and sorts text fields', () => {
    const scan = fixture(`{#if a}{#each xs as x}<button>go</button>{/each}{/if}
{#snippet row()}<a href="/x">x</a>{/snippet}
<button data-focusable>ok</button>
<button tabindex="-1">scrim</button>
<input type="file" class="hidden" />
<div inert><button>preview</button></div>
<input type="text" />
<dialog><input /></dialog>
<textarea readonly></textarea>
<input type="range" />`)
    expect(ruleR1(scan)).toEqual({
      controls: ['fixture.svelte:1 <button>', 'fixture.svelte:2 <a>', 'fixture.svelte:9 <textarea>', 'fixture.svelte:10 <input>'],
      textEntries: ['fixture.svelte:7 <input>'],
      modalTextEntries: ['fixture.svelte:8 <input>'],
    })
    expect(ruleR1(fixture('<input type="search" />'), true).modalTextEntries).toEqual(['fixture.svelte:1 <input>'])
  })

  it('R2 rejects a static data-focusable with tabindex="-1" except a roving tab', () => {
    const scan = fixture(`<button data-focusable tabindex="-1">a</button>
<div role="tablist"><button role="tab" data-focusable tabindex="-1">b</button></div>
<button data-focusable={on ? '' : undefined} tabindex="-1">c</button>`)
    expect(ruleR2(scan)).toEqual(['fixture.svelte:1 <button> pairs a static data-focusable with tabindex="-1"'])
  })

  it('R3 accepts nav layers, the keyboard and escapable legacy traps, and flags a double Escape', () => {
    const layers = fixture(`<div use:navLayer={{ onClose }} data-nav-trap data-nav-escape><button>x</button></div>
<div data-osk data-nav-trap><button>q</button></div>`)
    expect(ruleR3(layers, layers.source)).toEqual([])
    const scan = fixture(`<script lang="ts">
  function onKey(event: KeyboardEvent) { if (event.key === 'Escape') close() }
</script>
<svelte:window onkeydown={(event) => { if (event.key === 'Escape') close() }} />
<div data-nav-trap data-nav-escape>
  <div role="presentation" onkeydown={onKey}>inner</div>
</div>
<div data-nav-trap>bare</div>`)
    expect(ruleR3(scan, scan.source)).toEqual([
      'fixture.svelte:6 <div> handles Escape itself inside a legacy trap (the window Escape already closes it: a double close)',
      'fixture.svelte:8 <div> is a legacy trap without data-nav-escape (use:navLayer, or data-nav-escape plus a window Escape)',
    ])
    const ownerless = fixture('<div data-nav-trap data-nav-escape></div>')
    expect(ruleR3(ownerless, ownerless.source)).toEqual(['fixture.svelte:1 <div> has data-nav-escape but no window-level Escape listener'])
  })

  it('R3b wants a trap on, above or inside every dialog, menu and listbox', () => {
    const scan = fixture(`<div role="dialog" aria-modal="true"><div data-nav-trap></div></div>
<div role="menu" use:navLayer={{ onClose }}></div>
<dialog aria-modal="true"></dialog>
<div role="listbox"></div>`)
    expect(ruleR3b(scan)).toEqual(['fixture.svelte:4 <div> (role listbox) is not a trap or nav layer'])
  })

  it('R4 wants the scroll marker for the box axis, from utilities or the component style', () => {
    const scan = fixture(`<div class="overflow-y-auto"><button>a</button></div>
<div class="flex overflow-x-auto" data-nav-scroll-x><button>b</button></div>
<ul class="sm:max-h-72 sm:overflow-y-auto" data-nav-scroll-container="nested"><Row /></ul>
<nav class="strip"><button>c</button></nav>
<div class="overflow-y-auto"><p>text only</p></div>
<div class="panel {open ? 'overflow-y-auto' : ''}">{@render items()}</div>
<section class="add"><button>d</button></section>
<style>
  .strip { display: flex; overflow-x: auto; }
  @media (min-width: 640px) { .add { max-height: 88vh; overflow: auto; } }
</style>`)
    expect(ruleR4(scan)).toEqual([
      'fixture.svelte:1 <div> scrolls (y) around controls without data-nav-scroll-container',
      'fixture.svelte:4 <nav> scrolls (x) around controls without data-nav-scroll-x',
      'fixture.svelte:6 <div> scrolls (y) around controls without data-nav-scroll-container',
      'fixture.svelte:7 <section> scrolls (both) around controls without data-nav-scroll-container',
    ])
  })

  it('R5 wants a tabindex on a non-native data-focusable', () => {
    const scan = fixture(`<div data-focusable>a</div>
<li data-focusable={stops ? '' : undefined} tabindex={stops ? 0 : undefined}>b</li>
<a href="/x" data-focusable>c</a>`)
    expect(ruleR5(scan)).toEqual(['fixture.svelte:1 <div> is data-focusable but not focusable without a tabindex'])
  })

  it('R6 wants data-focusable tabindex="0" on every summary', () => {
    const scan = fixture(`<details><summary>a</summary></details>
<details><summary data-focusable>b</summary></details>
<details><summary data-focusable tabindex="0">c</summary></details>`)
    expect(ruleR6(scan)).toEqual([
      'fixture.svelte:1 <summary> needs data-focusable tabindex="0" (WebKitGTK does not reliably focus a bare summary)',
      'fixture.svelte:2 <summary> needs data-focusable tabindex="0" (WebKitGTK does not reliably focus a bare summary)',
    ])
  })

  it('follows .svelte imports through $lib and relative specifiers', () => {
    const closure = importClosure([fromRepo('src/routes/app/settings/+layout.svelte')]).map(repoRelative)
    expect(closure).toContain('src/lib/components/settings/SettingsNav.svelte')
    expect(closure).toContain('src/lib/components/settings/SettingsSearch.svelte')
  })

  it('never counts a spread as the attribute it might carry', () => {
    const [button] = markupElementsFromSource('<button {...rest}>x</button>')
    expect(hasAttr(button, 'data-focusable')).toBe(false)
    expect(hasSpread(button)).toBe(true)
  })

  it('reports the line of each element and its nearest-first ancestors', () => {
    const elements = markupElements(fromRepo('src/lib/components/settings/SettingsNav.svelte'))
    const railLink = elements.find((el) => el.name === 'a' && el.ancestors[0]?.name === 'nav')
    expect(railLink?.ancestors.map((el) => el.name)).toEqual(['nav'])
    expect(railLink && railLink.line).toBeGreaterThan(100)
  })
})
