import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { attr, hasAttr, markupElementsFromSource, staticAttr } from '../../../test/svelte-markup'

// Vitest has no Svelte plugin, so these read the component source (parsed by the Svelte compiler).
const read = (file: string) => readFileSync(fileURLToPath(new URL(file, import.meta.url)), 'utf8').replace(/\r\n/g, '\n')
const elements = (file: string) => markupElementsFromSource(read(file), file)

describe('LearnMore', () => {
  const source = read('./LearnMore.svelte')
  const [button] = elements('./LearnMore.svelte').filter((el) => el.name === 'button')

  it('is one d-pad target that opens on click, tap or A, never on hover', () => {
    expect(staticAttr(button, 'type')).toBe('button')
    expect(hasAttr(button, 'data-focusable')).toBe(true)
    expect(attr(button, 'aria-expanded')?.raw).toBe('aria-expanded={open}')
    expect(attr(button, 'onclick')?.raw).toBe('onclick={() => (open = !open)}')
    expect(source).toContain('>Learn more</button>')
    expect(source).not.toMatch(/onmouse|onpointerenter|onpointerover|onfocus/)
  })

  it('shows the text in a muted paragraph only while open', () => {
    expect(source).toContain('{#if open}<p class="mt-1 text-xs text-muted-foreground">{text}</p>{/if}')
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
    expect(source).toContain('    </a>\n    {@render more()}')
    expect(source).toContain('    </button>\n    {@render more()}')
    expect(source).toContain('{#snippet more()}\n  {#if learnMore}<div class="-mt-1.5 pb-2.5 {large ? \'px-3.5\' : \'px-3\'}"><LearnMore text={learnMore} /></div>{/if}')
  })

  it('uses rem text sizes, never 10 or 11 px', () => {
    expect(source).not.toMatch(/text-\[1[01]px\]/)
    expect(source).toContain('<p class="mt-0.5 text-xs leading-4 text-muted-foreground">{description}</p>')
  })
})
