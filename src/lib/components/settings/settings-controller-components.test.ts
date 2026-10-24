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
    // Above first-run setup (z-160), which hosts a SelectMenu; below the native picker (175) and OSK (190).
    expect(source).toContain('<div use:portal bind:this={backdrop} class="fixed inset-0 z-[165] grid place-items-center bg-black/60 p-4" role="presentation"')
    expect(source).toContain('class="w-[23.333rem] max-w-full rounded-2xl border border-border bg-card p-3 text-card-foreground shadow-2xl"')
    expect(source).toContain('class="max-h-[17.778rem] overflow-y-auto overscroll-contain">')
    expect(source).toContain('data-select-picker')
  })

  it('is a modal dialog whose list is the listbox, not a listbox around a heading', () => {
    const picker = source.slice(source.indexOf('{#if $settingsControllerMode}'), source.indexOf('{:else if $isMobile}'))
    expect(picker).toContain('role="dialog"')
    expect(picker).toContain('aria-modal="true"')
    // The trigger announces what opens: the picker dialog here, the listbox menu elsewhere.
    expect(source).toContain("aria-haspopup={$settingsControllerMode ? 'dialog' : 'listbox'}")
    expect(picker).toContain("<div data-nav-scroll-container role={searchable ? undefined : 'listbox'} aria-label={searchable ? undefined : ariaLabel}")
  })

  it('dismisses from a click on the backdrop, never the pointerdown a touch tap starts with', () => {
    expect(source).toContain('onclick={(event) => { if (event.target === event.currentTarget) open = false }}')
    expect(source).toContain('!backdrop?.contains(event.target as Node)) open = false')
    // A host that closes on outside presses (ListEditor) recognises the portalled picker by this.
    const backdrop = source.slice(source.indexOf('<div use:portal bind:this={backdrop}'), source.indexOf('bind:this={menu}'))
    expect(backdrop).toContain('data-select-picker-backdrop')
  })

  it('skips placement work for the centred picker, which never reads it', () => {
    expect(source).toContain('if (!trigger || $settingsControllerMode) return')
    expect(source).toContain('if (!open || $settingsControllerMode) return')
  })

  // The option lookup, stepping and reveal are tested in src/lib/settings/controller-picker.test.ts.
  it('opens on the current value and walks the open panel, revealing each option in the picker', () => {
    expect(source).toContain('const list: ParentNode = menu ?? root')
    expect(source).toContain('if ($settingsControllerMode) centrePickerValue(list, value)')
    expect(source).toContain("stepMenuOption(menu ?? root, event.key === 'ArrowDown' ? 1 : -1, $settingsControllerMode)")
  })
})
