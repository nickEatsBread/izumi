import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

// Controller-mode wiring in Settings components (spec §5). vitest has no Svelte plugin, so these
// read the source; the behaviour lives in src/lib/settings/*.ts and is tested there.
const read = (relative: string) => readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8').replace(/\r\n/g, '\n')

describe('SettingsSubcategory in controller mode (spec §5.3)', () => {
  const source = read('./SettingsSubcategory.svelte')

  it('folds through the shared rules and remembers per section', () => {
    expect(source).toContain("import { rememberSubcategory, subcategoryFoldable, subcategoryLine, subcategoryStartsCollapsed } from '$lib/settings/subcategory-fold'")
    expect(source).toContain('const foldable = $derived(subcategoryFoldable($settingsControllerMode, collapsible, def?.advanced === true))')
    // `open` stays the bindable source of truth (pages defer work on it); controller mode opens it on arrival.
    expect(source).toContain('if (!untrack(startsCollapsed)) open = true')
    expect(source).toContain('const collapsed = $derived(foldable && !open)')
    expect(source).toContain('rememberSubcategory($settingsControllerMode, section?.id, id, !next)')
    expect(source).toContain("const line = $derived(subcategoryLine(summary, $settingsControllerMode, rows))")
  })

  it('keeps the contract markup and open triggers', () => {
    expect(source).toContain('data-settings-subcategory={id}')
    expect(source).toContain("data-collapsed={collapsed ? '' : undefined}")
    expect(source).toContain('data-subcategory-toggle aria-expanded={!collapsed}')
    expect(source).toContain('data-settings-subcategory-body hidden={collapsed || undefined}')
    expect(source).toContain('node.addEventListener(SUBCATEGORY_OPEN_EVENT, onOpen)')
    // page.url, not afterNavigate: a same-page hash link only updates page.url (no navigation callbacks).
    expect(source).toContain("page.url.hash === `#${id}`")
  })
})

describe('SelectMenu in controller mode (spec §3.5)', () => {
  const source = read('./SelectMenu.svelte')

  it('draws a centred, portalled picker first: 420 px wide, list capped at 320 px', () => {
    const controller = source.indexOf('{#if $settingsControllerMode}')
    expect(controller).toBeGreaterThan(-1)
    expect(source.indexOf('{:else if $isMobile}')).toBeGreaterThan(controller)
    expect(source).toContain('<div use:portal class="fixed inset-0 z-[80] grid place-items-center bg-black/60 p-4" role="presentation">')
    expect(source).toContain('class="w-[23.333rem] max-w-full rounded-2xl border border-border bg-card p-3 text-card-foreground shadow-2xl"')
    expect(source).toContain('<div data-nav-scroll-container class="max-h-[17.778rem] overflow-y-auto overscroll-contain">')
    expect(source).toContain('data-select-picker')
  })

  it('opens on the current value, finds options in the open panel, and keeps taps inside it from closing it', () => {
    expect(source).toContain('const list: ParentNode = menu ?? root')
    expect(source).toContain('if ($settingsControllerMode) centrePickerValue(list, value)')
    expect(source).toContain('[...(menu ?? root).querySelectorAll<HTMLButtonElement>')
    expect(source).toContain('!menu?.contains(event.target as Node)')
  })
})
