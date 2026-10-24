import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { attr, hasAttr, markupElementsFromSource, staticAttr } from '../../../test/svelte-markup'

// Vitest has no Svelte plugin (and cannot load Lucide icons), so these read the sources as text.
const read = (file: string) => readFileSync(fileURLToPath(new URL(file, import.meta.url)), 'utf8').replace(/\r\n/g, '\n')
const elements = (file: string) => markupElementsFromSource(read(file), file)

const CARD = 'relative divide-y divide-border/70 rounded-xl border border-border bg-card/25 [&>*:first-child]:rounded-t-[calc(0.75rem-1px)] [&>*:last-child]:rounded-b-[calc(0.75rem-1px)]'

describe('section icons', () => {
  const source = read('./section-icons.ts')

  it('imports one Lucide icon per file and maps every section icon name', () => {
    const icons = [...source.matchAll(/^import \w+ from '@lucide\/svelte\/icons\/([a-z-]+)'$/gm)].map((match) => match[1])
    expect(icons).toEqual(['play', 'captions', 'languages', 'library', 'rss', 'download', 'palette', 'user', 'refresh-cw', 'globe', 'info'])
    expect(source).not.toMatch(/from '@lucide\/svelte'/)
    expect(source).toContain('export const SECTION_ICONS: Record<SettingsSectionIconName, LucideIcon> = {')
    expect(source).toContain('return SECTION_ICONS[settingsSection(id).iconName]')
  })
})

describe('SettingsSection', () => {
  const source = read('./SettingsSection.svelte')
  const sectionElements = elements('./SettingsSection.svelte')

  it('renders the section root, its header, the 40 px icon tile and the page title', () => {
    const [root] = sectionElements
    expect(root.name).toBe('div')
    expect(attr(root, 'data-settings-section')?.raw).toBe('data-settings-section={def.id}')
    expect(staticAttr(root, 'class')).toBe('p-4 sm:p-8')
    const header = sectionElements.find((el) => hasAttr(el, 'data-settings-section-header'))!
    expect(header.name).toBe('header')
    expect(staticAttr(header, 'class')).toBe('mb-6 flex items-center gap-3')
    const tile = sectionElements.find((el) => staticAttr(el, 'data-part') === 'settings.section.icon')!
    expect(tile.ancestors[0]?.name).toBe('header')
    expect(staticAttr(tile, 'class')).toContain('size-10')
    const title = sectionElements.find((el) => hasAttr(el, 'data-settings-page-title'))!
    expect(title.name).toBe('h2')
    expect(title.ancestors[0]?.name).toBe('header')
  })

  it('shares its registry entry with its subcategories and resolves its icon outside the registry', () => {
    expect(source).toContain('const def = untrack(() => settingsSection(section))')
    expect(source).toContain('setContext(SETTINGS_SECTION_CONTEXT, def)')
    expect(source).toContain('const Icon = sectionIcon(def.id)')
  })

  it('caps the content at 880 px', () => {
    expect(source).toContain('<div data-settings-section-body class="max-w-[880px]">')
  })

  it('hides its header in the phone layout, where the back-header names the section', () => {
    expect(source).toContain(':global(.settings-child) [data-settings-section-header] { display: none; }')
    expect(source).not.toContain(':global([data-settings-page-title])')
  })
})

describe('SettingsSubcategory', () => {
  const source = read('./SettingsSubcategory.svelte')
  const subElements = elements('./SettingsSubcategory.svelte')

  it('marks the section element with its id, folded state and heading', () => {
    const [section] = subElements
    expect(section.name).toBe('section')
    expect(attr(section, 'id')?.raw).toBe('id={id}')
    expect(attr(section, 'data-settings-subcategory')?.raw).toBe('data-settings-subcategory={id}')
    expect(attr(section, 'data-collapsed')?.raw).toBe("data-collapsed={collapsed ? '' : undefined}")
    expect(attr(section, 'aria-labelledby')?.raw).toBe('aria-labelledby={`${id}-heading`}')
    expect(staticAttr(section, 'class')).toBe('mb-7 scroll-mt-24')
  })

  it('makes a foldable heading a d-pad toggle and a fixed one a plain heading', () => {
    const toggle = subElements.find((el) => hasAttr(el, 'data-subcategory-toggle'))!
    expect(toggle.name).toBe('button')
    expect(toggle.ancestors[0]?.name).toBe('h3')
    expect(staticAttr(toggle, 'type')).toBe('button')
    expect(hasAttr(toggle, 'data-focusable')).toBe(true)
    expect(attr(toggle, 'aria-expanded')?.raw).toBe('aria-expanded={!collapsed}')
    expect(source).toContain('<h3 id={`${id}-heading`} class="mb-2 px-1 text-sm font-black">{heading}</h3>')
  })

  it('keeps a folded body in the DOM, hidden, in the SettingsGroup card unless plain', () => {
    const body = subElements.find((el) => hasAttr(el, 'data-settings-subcategory-body'))!
    expect(attr(body, 'hidden')?.raw).toBe('hidden={collapsed || undefined}')
    expect(read('./SettingsGroup.svelte')).toContain(CARD)
    expect(attr(body, 'class')?.raw).toBe(`class={plain ? '' : '${CARD}'}`)
  })

  it('folds Advanced by default and unfolds on its hash or the open event', () => {
    expect(source).toContain('const section = getContext<SettingsSectionDef | undefined>(SETTINGS_SECTION_CONTEXT)')
    expect(source).toContain('const folds = $derived(collapsible ?? def?.advanced === true)')
    expect(source).toContain('if (page.url.hash === `#${id}`) open = true')
    expect(source).toContain('el.addEventListener(SUBCATEGORY_OPEN_EVENT, unfold)')
  })

  it('exposes open for bind:open', () => {
    expect(source).toContain('    open = $bindable(false),\n')
    expect(source).toContain('open?: boolean')
    expect(source).not.toContain('let open = $state(false)')
  })
})
