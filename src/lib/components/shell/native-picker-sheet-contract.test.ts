import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { parse } from 'svelte/compiler'

// vitest has no Svelte plugin: the chooser's behaviour is tested through native-picker.ts
// (native-picker.test.ts, native-picker-gamepad.test.ts, whose fixture mirrors this component).
// This file pins the component to that fixture: no transitions, a z-175 protected modal panel
// registered as the 'native-picker' nav layer, tall option rows that prompt "Select", untracked
// Game-mode snapshot requests, and the mount point.

const read = (relative: string) =>
  readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8').replace(/\r\n/g, '\n')

interface AstAttribute { type: string; name: string; value: true | Array<{ type: string; data?: string }> | { type: string } }
interface AstNode { type?: string; name?: string; attributes?: AstAttribute[]; [key: string]: unknown }

/** Every node of `type` under `root` (the root included), depth first. */
function nodes(root: unknown, type: string): AstNode[] {
  const found: AstNode[] = []
  const seen = new WeakSet<object>()
  const walk = (value: unknown): void => {
    if (!value || typeof value !== 'object' || seen.has(value)) return
    seen.add(value)
    if (Array.isArray(value)) { value.forEach(walk); return }
    const node = value as AstNode
    if (node.type === type) found.push(node)
    for (const [key, child] of Object.entries(node)) if (key !== 'metadata') walk(child)
  }
  walk(root)
  return found
}

/** An attribute's static text; true when bare; '{…}' when it holds an expression; undefined when absent. */
function attr(element: AstNode, name: string): string | true | undefined {
  const found = element.attributes?.find((item) => item.type === 'Attribute' && item.name === name)
  if (!found) return undefined
  if (found.value === true) return true
  if (Array.isArray(found.value)) return found.value.map((part) => (part.type === 'Text' ? part.data ?? '' : '{…}')).join('')
  return '{…}'
}

const source = read('./NativePickerSheet.svelte')
const layout = read('../../../routes/app/+layout.svelte')
const ast = parse(source, { modern: true })
const elements = nodes(ast.fragment, 'RegularElement')
const byRole = (role: string) => elements.filter((element) => attr(element, 'role') === role)

describe('NativePickerSheet contract', () => {
  it('has no transition or animation directives and is not portalled, so its trap leaves in the same flush', () => {
    expect(nodes(ast.fragment, 'TransitionDirective')).toEqual([])
    expect(nodes(ast.fragment, 'AnimateDirective')).toEqual([])
    expect(source).not.toContain('use:portal')
  })

  it('draws a z-175 backdrop around a theme-protected, trapped modal panel', () => {
    const backdrop = elements.find((element) => String(attr(element, 'class')).includes('fixed inset-0 z-[175]'))
    expect(backdrop).toBeDefined()
    const panels = byRole('dialog')
    expect(panels).toHaveLength(1)
    const [panel] = panels
    expect(attr(panel, 'aria-modal')).toBe('true')
    for (const name of ['data-theme-protected', 'data-nav-trap', 'data-nav-escape', 'data-native-picker']) {
      expect(attr(panel, name), name).toBe(true)
    }
    expect(nodes(backdrop, 'RegularElement')).toContain(panel)
  })

  it('lists the options as tall focusable option buttons in a nav scroll container, plus Cancel', () => {
    const [listbox] = byRole('listbox')
    expect(attr(listbox, 'data-nav-scroll-container')).toBe(true)
    const [row] = byRole('option')
    expect(row.name).toBe('button')
    expect(attr(row, 'type')).toBe('button')
    expect(attr(row, 'data-focusable')).toBe(true)
    expect(attr(row, 'data-picker-row')).toBe(true)
    // The hint bar's A prompt reads data-hint-a; without it the prompt would be the option's text.
    expect(attr(row, 'data-hint-a')).toBe('Select')
    expect(attr(row, 'aria-selected')).toBe('{…}')
    expect(String(attr(row, 'class'))).toContain('min-h-12')
    expect(nodes(listbox, 'RegularElement')).toContain(row)
    expect(source).toContain('>Cancel</button>')
  })

  it('registers as the native-picker nav layer and closes itself on B, backdrop, loss of the select and navigation', () => {
    expect(source).toContain("import { pushNavLayer } from '$lib/nav/layers'")
    expect(source).toContain('pushNavLayer({')
    expect(source).toContain("kind: 'native-picker'")
    expect(source).toContain("restore: 'none'")
    expect(source).toContain("close: (reason) => closeNativePicker({ restore: reason === 'back' })")
    expect(source).toContain('onGone: () => closeNativePicker({ restore: false })')
    expect(source).toMatch(/afterNavigate\(\(\) => \{\n\s+if \(get\(nativePicker\)\) closeNativePicker\(\{ restore: false \}\)/)
    expect(source).toContain('onpointerdown={(event) => { if (event.target === event.currentTarget) closeNativePicker({ restore: true }) }}')
  })

  it('steps its rows from a window capture listener that stands down for the on-screen keyboard', () => {
    const windows = nodes(ast.fragment, 'SvelteWindow')
    expect(windows).toHaveLength(1)
    expect(windows[0].attributes?.map((item) => item.name)).toEqual(['onkeydowncapture'])
    expect(source).toContain('onkeydowncapture={(event) => pickerKeydown(event, panel)}')
    expect(read('../../nav/native-picker.ts')).toContain('if (!get(state) || get(oskOpen)) return false')
  })

  it('asks for Game-mode overlay snapshots only while playing, through untracked reads', () => {
    expect(source.match(/bumpPlayerOverlay\(\)/g)).toHaveLength(1)
    expect(source).toContain('if (get(gameMode) && get(playing)) bumpPlayerOverlay()')
    // A tracked store read inside the per-open effect would re-run it when Game mode or playback
    // changes, and throw focus back to the current value under the user.
    expect(source).not.toContain('$gameMode')
    expect(source).not.toContain('$playing')
    expect(source).toContain("import { tick, untrack } from 'svelte'")
    expect(source).toMatch(/untrack\(\(\) => \{\n\s+focusPickerRow\(node\)\n\s+bump\(\)\n\s+\}\)/)
    for (const call of [
      'onfocusin={bump}',
      'requestAnimationFrame(() => requestAnimationFrame(() => { if (!cancelled) bump() }))',
      'setTimeout(() => { if (!cancelled) bump() }, 120)',
      'requestAnimationFrame(() => bump())',
    ]) expect(source).toContain(call)
  })

  it('is mounted in the app layout on the line after the on-screen keyboard', () => {
    expect(layout).toContain("import NativePickerSheet from '$lib/components/shell/NativePickerSheet.svelte'")
    expect(layout).toContain('<OnScreenKeyboard />\n<NativePickerSheet />')
  })
})
