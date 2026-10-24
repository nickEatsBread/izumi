import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { compile } from 'svelte/compiler'
import { describe, expect, it } from 'vitest'
import { SETTINGS_GROUPS, SETTINGS_SECTIONS } from '$lib/settings/sections'
import { attr, hasAttr, markupElementsFromSource, staticAttr } from '../../../test/svelte-markup'

const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8').replace(/\r\n/g, '\n')
const nav = read('./SettingsNav.svelte')
const appCss = read('../../../app.css')
const elements = markupElementsFromSource(nav, 'SettingsNav.svelte')
// The desktop rail: the controller-mode rail comes first (settings-nav.test.ts covers it).
const rail = elements.filter((el) => el.name === 'nav' && hasAttr(el, 'data-settings-rail')).at(-1)
const railLinks = elements.filter((el) => el.name === 'a' && hasAttr(el, 'data-section') && el.ancestors.includes(rail!))

describe('desktop Settings rail selection', () => {
  it('draws one indicator, first in the rail, in the marker the theme picks', () => {
    expect(rail).toBeDefined()
    const indicators = elements.filter((el) => staticAttr(el, 'data-part') === 'settings.rail.indicator')
    expect(indicators).toHaveLength(1)
    const [indicator] = indicators
    expect(indicator.ancestors[0]).toBe(rail)
    expect(rail!.node.fragment.nodes.find((node) => node.type === 'RegularElement')).toBe(indicator.node)
    expect(attr(indicator, 'data-marker')?.raw).toBe('data-marker={$settingsRailMarker}')
    expect(staticAttr(indicator, 'aria-hidden')).toBe('true')
    expect(hasAttr(indicator, 'data-focusable')).toBe(false)
    expect(attr(rail!, 'use:railIndicator')?.raw).toBe('use:railIndicator={litSection}')
    expect(nav).toContain("import { settingsRailMarker } from '$lib/settings/rail-marker'")
    expect(nav).toContain("import { railIndicator } from '$lib/settings/rail-indicator'")
    expect(nav).toContain('const litSection = $derived(SETTINGS_SECTIONS.find((section) => active(section.href))?.id ?? null)')
  })

  it('styles all five markers, the accent one as fill plus a 3 px inset bar', () => {
    for (const marker of ['accent', 'fill', 'bar', 'tile', 'dot']) {
      expect(nav).toContain(`.settings-rail-indicator[data-marker='${marker}']`)
    }
    expect(nav).toContain(".settings-rail-indicator[data-marker='accent'] { background: hsl(var(--theme) / 0.16); box-shadow: inset 3px 0 0 hsl(var(--theme)); }")
    expect(nav).toContain(".settings-rail-indicator[data-marker='tile'] ~ div a[aria-current='page'] :global(svg) { color: hsl(var(--background)); }")
  })

  it('slides only when rail-indicator.ts sets data-animate', () => {
    expect(nav).toMatch(/\.settings-rail-indicator \{[^}]*position: absolute[^}]*\}/)
    expect(nav).not.toMatch(/\.settings-rail-indicator \{[^}]*transition[^}]*\}/)
    // data-animate exists only at runtime, so a plain scoped selector would be stripped as unused.
    expect(nav).toContain('.settings-rail-indicator:global([data-animate]) { transition: transform 200ms')
    const unused = compile(nav, { filename: 'SettingsNav.svelte' }).warnings.filter((w) => w.code === 'css_unused_selector')
    expect(unused.map((w) => w.message)).toEqual([])
  })

  it('labels the five groups in registry order, without making labels d-pad stops', () => {
    expect(nav).toContain('{#each SETTINGS_GROUPS as group, index (group.id)}')
    expect(nav).toContain('{#each SETTINGS_SECTIONS.filter((section) => section.group === group.id) as it (it.id)}')
    const groupBox = elements.find((el) => hasAttr(el, 'data-settings-rail-group'))!
    expect(staticAttr(groupBox, 'role')).toBe('group')
    expect(attr(groupBox, 'aria-labelledby')?.raw).toBe('aria-labelledby="settings-rail-group-{group.id}"')
    const label = elements.find((el) => attr(el, 'id')?.raw === 'id="settings-rail-group-{group.id}"')!
    expect(hasAttr(label, 'data-focusable')).toBe(false)
    expect(nav).toContain('{group.label}</div>')
    expect(SETTINGS_GROUPS.map((group) => group.label)).toEqual(['Watch', 'Library', 'Look', 'You', 'System'])
    // Rendering group by group keeps the registry's flat rail order.
    const grouped = SETTINGS_GROUPS.flatMap((group) => SETTINGS_SECTIONS.filter((section) => section.group === group.id))
    expect(grouped.map((section) => section.id)).toEqual(SETTINGS_SECTIONS.map((section) => section.id))
  })

  it('marks each rail link with its section and group, and keeps the keyboard and pad wiring', () => {
    expect(railLinks).toHaveLength(1)
    const [link] = railLinks
    expect(attr(link, 'data-section')?.raw).toBe('data-section={it.id}')
    expect(attr(link, 'data-group')?.raw).toBe('data-group={it.group}')
    expect(attr(link, 'aria-current')?.raw).toBe("aria-current={active(it.href) ? 'page' : undefined}")
    expect(attr(link, 'data-nav-region-default')?.raw).toBe("data-nav-region-default={active(it.href) ? '' : undefined}")
    expect(hasAttr(link, 'data-sveltekit-keepfocus')).toBe(true)
    expect(attr(link, 'onclick')?.raw).toBe('onclick={releasePointerFocus}')
    // The short rail label is printed; hover and screen readers still get the full section title.
    expect(attr(link, 'title')?.raw).toBe('title={it.title}')
    expect(attr(link, 'aria-label')?.raw).toBe('aria-label={it.title}')
  })

  it('keeps selected, hovered and focused apart', () => {
    const classes = attr(railLinks[0], 'class')!.raw
    expect(classes).toContain("'font-medium text-foreground'")
    expect(classes).toContain("'text-muted-foreground hover:bg-foreground/5 hover:text-foreground'")
    expect(classes).toContain('focus-visible:outline-offset-[-2px]')
    expect(classes).not.toMatch(/font-bold|bg-secondary|focus(-visible)?:bg-/)
    expect(nav).toContain(`<Icon size={18} aria-hidden="true" /> {it.railTitle}`)
    // Amendment 1: icons come from section-icons.ts, never from the registry.
    expect(nav).toContain('{@const Icon = sectionIcon(it.id)}')
    expect(nav).toContain("import { sectionIcon } from '$lib/components/settings/section-icons'")
    expect(nav).not.toContain('it.icon')
    // Focus is the global ring alone: no app.css rule fills a desktop rail link. Controller
    // surfaces (Game mode, Android TV, a paired pad, the controller Settings layout) style their own focus.
    for (const [, selectors, body] of appCss.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      if (!/background/.test(body)) continue
      for (const selector of selectors.split(',').map((part) => part.trim())) {
        if (selector.includes('data-settings-rail')) expect(selector).toMatch(/^(html)?(\.(gamemode|tv-mode|controller-mode)\b|\[data-settings-controller\] )/)
      }
    }
    expect(nav).not.toContain('data-nav-sidebar')
  })
})
