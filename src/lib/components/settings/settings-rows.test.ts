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
    expect(source).toContain('const id = $props.id()')
  })

  it('keeps the muted paragraph in the page, hidden while closed, so aria-controls always resolves', () => {
    expect(source).toContain('<p {id} hidden={!open} class="mt-1 text-xs text-muted-foreground">{text}</p>')
  })

  it('sits above the row button its negative top margin overlaps', () => {
    // The row button is a positioned .ripple-host; a non-positioned Learn more would lose its top strip to it.
    expect(staticAttr(button, 'class')?.split(/\s+/)).toContain('relative')
    expect(read('./SettingsRow.svelte')).toContain('<div class="-mt-1.5 ')
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
    expect(source.split('<LearnMore text={learnMore} label={title} />')).toHaveLength(3)
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
})

describe('SettingsChoiceRow', () => {
  const source = read('./SettingsChoiceRow.svelte')

  it('is a SettingsRow whose control is an inline SelectMenu labelled by the row title', () => {
    expect(source).toContain('<SelectMenu variant="inline" {value} {options} {onChange} {searchable} ariaLabel={ariaLabel ?? title} />')
    expect(source).toContain('<SettingsRow {title} {description} {learnMore} {settingKey} {control} />')
    expect(source).toContain("options: ComponentProps<typeof SelectMenu>['options']")
  })
})
