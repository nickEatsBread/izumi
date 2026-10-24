import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { attr, hasAttr, markupElementsFromSource, parseSvelteSource, staticAttr, walkTemplate } from '../../../test/svelte-markup'

const source = readFileSync(fileURLToPath(new URL('./SettingsSection.svelte', import.meta.url)), 'utf8').replace(/\r\n/g, '\n')
const elements = markupElementsFromSource(source, 'SettingsSection.svelte')
const withAttr = (name: string) => elements.filter((el) => hasAttr(el, name))

/** Attribute names on the elements inside `{#if desktop}` and `{#if desktop && …}` blocks. */
function desktopOnlyAttributes(): string[] {
  const names: string[] = []
  walkTemplate(parseSvelteSource(source, 'SettingsSection.svelte').fragment, (node) => {
    if (node.type !== 'IfBlock') return
    const test = node.test
    const desktop = test.type === 'Identifier'
      ? test.name === 'desktop'
      : test.type === 'LogicalExpression' && test.left.type === 'Identifier' && test.left.name === 'desktop'
    if (!desktop) return
    walkTemplate(node.consequent, (inner) => {
      if (inner.type !== 'RegularElement') return
      for (const attribute of inner.attributes) if (attribute.type === 'Attribute') names.push(attribute.name)
    })
  })
  return names
}

describe('SettingsSection on desktop', () => {
  it('keeps the props and the hooks other parts rely on', () => {
    expect(source).toContain('let { section, children }: { section: SettingsSectionId; children: Snippet } = $props()')
    expect(source).toContain('setContext(SETTINGS_SECTION_CONTEXT, def)')
    const [root] = withAttr('data-settings-section')
    expect(attr(root, 'data-settings-section')?.raw).toBe('data-settings-section={def.id}')
    expect(source).toContain('{@render children()}')
    // Amendment 1: the icon comes from section-icons.ts, never from the registry.
    expect(source).toContain("import { sectionIcon } from '$lib/components/settings/section-icons'")
    expect(source).toContain('const Icon = $derived(sectionIcon(def.id))')
    expect(source).not.toContain('def.icon')
  })

  it('draws a 44 px accent icon tile and a large title, with no summary line', () => {
    const [header] = withAttr('data-settings-section-header')
    expect(header.name).toBe('header')
    const tile = elements.find((el) => staticAttr(el, 'data-part') === 'settings.section.icon')!
    expect(tile.ancestors[0]).toBe(header)
    expect(staticAttr(tile, 'class')).toContain('size-11')
    expect(staticAttr(tile, 'class')).toContain('bg-theme/[0.16] text-theme')
    const [title] = withAttr('data-settings-page-title')
    expect(title.name).toBe('h2')
    expect(staticAttr(title, 'class')).toContain('text-2xl')
    // The owner rejected any subtitle or live summary under the title.
    expect(elements.filter((el) => el.ancestors.includes(header)).map((el) => el.name)).toEqual(['span', 'h2'])
  })

  it('renders the chips and the sticky bar on desktop only', () => {
    expect(source).toContain('const desktop = $derived(!$isMobile)')
    const desktopOnly = desktopOnlyAttributes()
    expect(desktopOnly).toContain('data-settings-chips')
    expect(desktopOnly).toContain('data-settings-sticky')
    expect(withAttr('data-settings-chips')).toHaveLength(1)
    expect(withAttr('data-settings-sticky')).toHaveLength(1)
  })

  it('gives one chip per rendered subcategory, lit by the scroll-spy, jumping on click', () => {
    expect(source).toContain('trackSectionScroll(root, header, (state) => { scroll = state })')
    expect(source).toContain('{#each scroll.ids as id (id)}')
    const [chip] = withAttr('data-settings-chip')
    expect(chip.name).toBe('button')
    expect(staticAttr(chip, 'type')).toBe('button')
    expect(staticAttr(chip, 'data-part')).toBe('chip')
    expect(hasAttr(chip, 'data-focusable')).toBe(true)
    expect(attr(chip, 'aria-current')?.raw).toBe("aria-current={scroll.active === id ? 'location' : undefined}")
    expect(attr(chip, 'data-active')?.raw).toBe("data-active={scroll.active === id ? '' : undefined}")
    expect(attr(chip, 'onclick')?.raw).toBe('onclick={() => tracker?.jump(id)}')
  })

  it('labels the chip row with the section title, so it reads as one group of jumps', () => {
    const [chips] = withAttr('data-settings-chips')
    const [title] = withAttr('data-settings-page-title')
    expect(staticAttr(chips, 'role')).toBe('group')
    expect(attr(chips, 'aria-labelledby')?.raw).toBe('aria-labelledby="settings-section-{def.id}-title"')
    expect(attr(title, 'id')?.raw).toBe('id="settings-section-{def.id}-title"')
  })

  it('pins a compact "icon · Section › Subcategory" bar while the header is out of view', () => {
    const [bar] = withAttr('data-settings-sticky')
    expect(attr(bar, 'data-visible')?.raw).toBe("data-visible={scroll.stuck ? '' : undefined}")
    expect(staticAttr(bar, 'aria-hidden')).toBe('true')
    const holder = bar.ancestors[0]
    expect(staticAttr(holder, 'class')).toContain('sticky top-0')
    expect(staticAttr(holder, 'class')).toContain('h-0')
    expect(source).toContain('<span class="font-medium">{def.title}</span>')
    expect(source).toContain('<span class="text-muted-foreground">›</span>')
    expect(source).toContain('{titleOf(scroll.active)}')
    expect(source).toContain('.settings-sticky:not([data-visible]) { visibility: hidden;')
    // The bar clears the titlebar/top-bar band; SettingsSubcategory's scroll margin follows the same variable.
    expect(source).toContain('.settings-sticky { padding-top: calc(var(--theme-shell-top, 2rem) + 0.625rem);')
    // Game mode and TV have no titlebar, so a side or bottom nav leaves no band: the bar drops the empty strip.
    expect(source).toContain(":global(html:is(.gamemode, .tv-mode):not([data-theme-nav='top'])) .settings-sticky { padding-top: 0.625rem; }")
    // Game mode: a CSS transition's end blinks on WebKitGTK and the tween softens the bar's text.
    expect(source).toContain(':global(html.gamemode) .settings-sticky { transition: none; }')
    expect(source).toContain(':global(.settings-child) [data-settings-section-header] { display: none; }')
    // Never IntersectionObserver: CSS zoom makes it misreport (util/near-viewport.ts).
    expect(source).not.toContain('IntersectionObserver')
  })
})
