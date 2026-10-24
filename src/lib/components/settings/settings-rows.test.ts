import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import type { AST } from 'svelte/compiler'
import {
  attr, childFragments, hasAttr, markupElementsFromSource, parseSvelteSource, staticAttr, type TemplateNode,
} from '../../../test/svelte-markup'

// Vitest has no Svelte plugin, so these read the component source (parsed by the Svelte compiler).
const read = (file: string) => readFileSync(fileURLToPath(new URL(file, import.meta.url)), 'utf8').replace(/\r\n/g, '\n')
const elements = (file: string) => markupElementsFromSource(read(file), file)

/** Element-ancestor names (nearest first) of every template node matching `match`, components included. */
function ancestorsOf(source: string, match: (node: TemplateNode) => boolean): string[][] {
  const found: string[][] = []
  const visit = (fragment: AST.Fragment, ancestors: string[]) => {
    for (const node of fragment.nodes) {
      if (match(node)) found.push(ancestors)
      const next = node.type === 'RegularElement' || node.type === 'SvelteElement' ? [node.name, ...ancestors] : ancestors
      for (const child of childFragments(node)) visit(child, next)
    }
  }
  visit(parseSvelteSource(source).fragment, [])
  return found
}

describe('LearnMore', () => {
  const source = read('./LearnMore.svelte')
  const [button] = elements('./LearnMore.svelte').filter((el) => el.name === 'button')

  it('is one d-pad target that opens on click, tap or A, never on hover', () => {
    expect(staticAttr(button, 'type')).toBe('button')
    expect(hasAttr(button, 'data-focusable')).toBe(true)
    expect(hasAttr(button, 'data-touch-target')).toBe(true)
    expect(attr(button, 'aria-expanded')?.raw).toBe('aria-expanded={open}')
    expect(attr(button, 'onclick')?.raw).toBe('onclick={() => (open = !open)}')
    expect(source).toContain('>Learn more</button>')
    expect(source).not.toMatch(/onmouse|onpointerenter|onpointerover|onfocus/)
    // A bare hover: style sticks after a tap on a touch screen.
    expect(source).toContain('sm:hover:text-foreground')
    expect(source).not.toMatch(/(?<!sm:)hover:/)
  })

  it('names each button after its row and points it at the text it opens', () => {
    expect(attr(button, 'aria-label')?.raw).toBe('aria-label={label ? `Learn more about ${label}` : undefined}')
    expect(attr(button, 'aria-controls')?.raw).toBe('aria-controls={id}')
    // The row owns the id, so its focusable can name the text in controller mode.
    expect(source).toContain('let { text, label, id }: { text: string; label?: string; id: string } = $props()')
    expect(read('./SettingsRow.svelte')).toContain('const learnId = $props.id()')
  })

  it('is no d-pad stop in controller mode: the text shows on row focus and describes the row', () => {
    // Spec §5.1: one-line descriptions, full text on focus. Desktop and phone keep the button.
    expect(source).toContain("import { settingsControllerMode } from '$lib/settings/surface'")
    const controller = source.slice(source.indexOf('{#if $settingsControllerMode}'), source.indexOf('{:else}'))
    // Hidden from browse mode: the row's focusables read it as their description instead.
    expect(controller).toContain('<p {id} aria-hidden="true" class="text-xs text-muted-foreground">{text}</p>')
    expect(controller).not.toMatch(/<button|data-focusable|\shidden=/)
    expect(source.indexOf('>Learn more</button>')).toBeGreaterThan(source.indexOf('{:else}'))
    // The row's wrapper hides the text until the row has focus; aria-describedby reads hidden text.
    const row = read('./SettingsRow.svelte')
    expect(row).toContain('const describedBy = $derived(learnMore && $settingsControllerMode ? learnId : undefined)')
    expect(row.split("data-learn-more={describedBy ? '' : undefined}")).toHaveLength(3)
    // Every root hands the description to the focusables it owns (row-description.test.ts), so a
    // control row's snippet control announces it, not a wrapper that never takes focus.
    expect(row.split('data-setting-row data-setting-key={settingKey} use:describeRowFocusables={describedBy}')).toHaveLength(4)
    expect(row).not.toContain('aria-describedby')
    expect(row).not.toContain('role=')
    const css = read('../../../app.css')
    expect(css).toContain('[data-learn-more] { display: none; }\n:focus-within > [data-learn-more] { display: block; }')
    // The row showing that text takes the ring and fill (settings-row-focus.test.ts).
  })

  it('keeps the muted paragraph in the page, hidden while closed, so aria-controls always resolves', () => {
    expect(source).toContain('<p {id} hidden={!open} class="mt-1 text-xs text-muted-foreground">{text}</p>')
  })

  it('sits above the row button its negative top margin overlaps', () => {
    // The row button is a positioned .ripple-host; a non-positioned Learn more would lose its top strip to it.
    expect(staticAttr(button, 'class')?.split(/\s+/)).toContain('relative')
    expect(read('./SettingsRow.svelte')).toContain(' class="-mt-1.5 ')
  })
})

describe('SettingsRow additions', () => {
  const source = read('./SettingsRow.svelte')
  const rowElements = elements('./SettingsRow.svelte')

  it('documents the row recipes every page builds from', () => {
    for (const recipe of ['Switch row', 'Choice/value row', 'Slider row', 'Link row', 'Action row', 'Credential row']) {
      expect(source, recipe).toContain(`// - ${recipe}:`)
    }
  })

  it('takes a value, a chevron, a Learn more text and a link href', () => {
    for (const prop of ['value?: string', 'chevron?: boolean', 'learnMore?: string', 'href?: string']) expect(source).toContain(prop)
  })

  it('makes a link row one d-pad target across the whole row', () => {
    const links = rowElements.filter((el) => el.name === 'a')
    expect(links).toHaveLength(1)
    expect(attr(links[0], 'href')?.raw).toBe('href={href}')
    expect(hasAttr(links[0], 'data-focusable')).toBe(true)
    expect(attr(links[0].ancestors[0], 'data-setting-key')?.raw).toBe('data-setting-key={settingKey}')
    // The search focus target is the switch/action button only (deviation 6).
    expect(hasAttr(links[0], 'data-row-activate')).toBe(false)
  })

  it('prints the value muted before the control and the chevron after it', () => {
    const value = source.indexOf('{#if value}<span class="max-w-[12rem] truncate text-sm text-muted-foreground">{value}</span>{/if}')
    const control = source.indexOf('{#if control}{@render control()}{/if}')
    const chevron = source.indexOf('{#if chevron}<ChevronRight')
    expect(value).toBeGreaterThan(-1)
    expect(control).toBeGreaterThan(value)
    expect(chevron).toBeGreaterThan(control)
  })

  it('puts Learn more after the row button or link, never inside it', () => {
    const insideControl = (ancestors: string[]) => ancestors.some((name) => name === 'a' || name === 'button')
    const learnMores = ancestorsOf(source, (node) => node.type === 'Component' && node.name === 'LearnMore')
    // A snippet is walked where it is declared, so also check every place `more` is rendered.
    const renders = ancestorsOf(source, (node) => node.type === 'RenderTag' && source.slice(node.start, node.end) === '{@render more()}')
    expect(learnMores).toHaveLength(2)
    expect(renders).toHaveLength(2)
    for (const ancestors of [...learnMores, ...renders]) expect(insideControl(ancestors), ancestors.join(' < ')).toBe(false)
    expect(source.split('<LearnMore text={learnMore} label={title} id={learnId} />')).toHaveLength(3)
  })

  it('marks every root with data-setting-row, keyed or not, for nav and the controller highlight', () => {
    const roots = rowElements.filter((el) => hasAttr(el, 'data-setting-key'))
    expect(roots).toHaveLength(3)
    for (const root of roots) expect(hasAttr(root, 'data-setting-row')).toBe(true)
    expect(rowElements.filter((el) => hasAttr(el, 'data-setting-row'))).toHaveLength(3)
  })

  it('marks its header as one d-pad line, outside the row button and the expanded children', () => {
    // nav `navRect` measures a narrow control on this line by the whole line on Up/Down.
    const lines = rowElements.filter((el) => hasAttr(el, 'data-nav-line'))
    expect(lines).toHaveLength(1)
    expect(source).toContain('{#snippet header()}\n  <div data-nav-line class="flex gap-3 ')
    // A row button or link holds the line, so it keeps its own box; the expanded children sit outside
    // the line, so their stacked fields keep their own boxes too.
    expect(source.slice(source.indexOf('{#snippet header()}'), source.indexOf('{/snippet}'))).not.toContain('children')
  })

  it('keeps the leading icon beside the title when a stacked row drops its controls below', () => {
    // The stacked header is a column below sm, so the icon and title share one inner row.
    expect(source).toContain("controlLayout === 'stack' ? 'flex-col items-stretch")
    expect(source).toMatch(/<div class="flex min-w-0 flex-1 items-center gap-3">\s*\{#if leading\}<span class="shrink-0">\{@render leading\(\)\}<\/span>\{\/if\}\s*<div class="min-w-0 flex-1">\s*<div class="font-bold/)
  })

  it('uses rem text sizes, never 10 or 11 px', () => {
    expect(source).not.toMatch(/text-\[1[01]px\]/)
    expect(source).toContain('<p class="mt-0.5 text-xs leading-4 text-muted-foreground">{description}</p>')
  })
})

const FIELD_TRIGGER = 'flex min-h-11 w-full items-center justify-between gap-3 rounded-md bg-input px-3 py-2.5 text-left text-base sm:min-h-0 sm:py-2 sm:text-sm'
const INLINE_TRIGGER = 'flex min-h-11 max-w-[16rem] items-center justify-end gap-1.5 rounded-md px-2 py-2 text-right text-sm text-muted-foreground transition-colors hover:text-foreground sm:min-h-0 sm:py-1.5'

describe('SelectMenu variants', () => {
  const source = read('./SelectMenu.svelte')

  it('keeps the filled field trigger by default and adds a borderless inline one', () => {
    expect(source).toContain("    variant = 'field',\n")
    expect(source).toContain("variant?: 'field' | 'inline'")
    expect(source).toContain(`? '${INLINE_TRIGGER}'`)
    expect(source).toContain(`: '${FIELD_TRIGGER}'}`)
  })

  it('exposes open for bind:open', () => {
    expect(source).toContain('    open = $bindable(false),\n')
    expect(source).toContain('open?: boolean')
    expect(source).not.toContain('let open = $state(false)')
  })

  it('shows only the label in the inline trigger so a phone row keeps room for its title', () => {
    expect(source).toContain("{#if selected?.description && variant !== 'inline'}")
  })

  it('anchors the inline menu to the right edge of its trigger', () => {
    expect(source).toContain("class=\"absolute {variant === 'inline' ? 'right-0' : 'left-0'} z-[80] min-w-full")
  })

  // The fallback itself is tested in src/lib/settings/controller-picker.test.ts.
  it('opens onto the first enabled option when the current one is disabled', () => {
    expect(source).toContain('openingOption(list, value))?.focus({ preventScroll: true })')
  })
})

describe('SettingsChoiceRow', () => {
  const source = read('./SettingsChoiceRow.svelte')

  it('is a SettingsRow whose control is an inline SelectMenu labelled by the row title', () => {
    expect(source).toContain('<SelectMenu variant="inline" {value} {options} {onChange} {searchable} ariaLabel={ariaLabel ?? title} />')
    expect(source).toContain('<SettingsRow {title} {description} {learnMore} {settingKey} {control} />')
    expect(source).toContain("options: ComponentProps<typeof SelectMenu>['options']")
  })
})
