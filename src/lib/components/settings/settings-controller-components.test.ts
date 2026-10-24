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
