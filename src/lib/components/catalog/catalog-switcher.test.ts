import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const source = readFileSync(fileURLToPath(new URL('./CatalogSwitcher.svelte', import.meta.url)), 'utf8')

describe('catalog switcher', () => {
  it('supports compact and labelled triggers while exposing the active catalog', () => {
    expect(source).toContain('Catalog: ${activeLabel}. Choose catalog')
    expect(source).toContain("display?: 'brand' | 'icon' | 'value' | 'rail'")
    expect(source).toContain("display === 'icon'")
    expect(source).toContain('size-11 place-items-center overflow-hidden rounded-full')
    expect(source).toContain('scale-110')
    expect(source).toContain('{activeLabel}</span>')
    expect(source).toContain('aria-expanded={open}')
  })

  it('offers both an explicit rail row and a restrained integrated brand trigger', () => {
    expect(source).toContain("display === 'rail'")
    expect(source).toContain('Catalog: {activeLabel}</span>')
    expect(source).toContain("expanded ? 'opacity-100' : 'opacity-0'")
    expect(source).toContain("display === 'brand'")
    expect(source).toContain('<CatalogBrandLogo platform={$catalogScreen} />')
    expect(source).toContain('showWordmark')
    // Integrated mode must keep the mark clean instead of layering another provider badge on it.
    expect(source).not.toContain('CatalogProviderBadge')
  })

  it('does not let positioning utilities push the Home hero down', () => {
    expect(source).toContain('<div bind:this={root} class={className}')
    expect(source).toContain(`relative {display === 'rail' ? 'w-full' : 'w-fit'}`)
    expect(source).not.toContain('class="relative {className}"')
  })

  it('offers enabled catalogs and Merged as peer Home screens', () => {
    expect(source).toContain('const choices = $derived($enabledCatalogScreens)')
    expect(source).toContain('{#each choices as provider (provider)}')
    expect(source).toContain('selectCatalogScreen(provider)')
    expect(source).toContain('aria-selected={provider === $catalogScreen}')
    expect(source).toContain("merged: 'Your custom mix from every catalog'")
  })

  it('adapts the same selection model to a mobile bottom sheet', () => {
    expect(source).toContain("$isMobile ? 'dialog' : undefined")
    expect(source).toContain("'fixed inset-x-0 bottom-0")
    expect(source).toContain('role="listbox"')
  })

  it('keeps catalog configuration one step away', () => {
    expect(source).toContain('href="/app/settings/library"')
    expect(source).toContain('Manage catalogs')
  })

  it('starts in-place Home editing from the picker', () => {
    expect(source).toContain('Edit this Home')
    expect(source).toContain('homeEditorOpen.set(true)')
    expect(source).toContain('<Pencil')
    expect(source).toContain('text-left text-sm font-bold text-muted-foreground transition hover:bg-accent hover:text-foreground')
  })
})

describe('custom screens in the catalog switcher', () => {
  const screensSettings = readFileSync(fileURLToPath(new URL('./CatalogScreensSettings.svelte', import.meta.url)), 'utf8')
  const dialog = readFileSync(fileURLToPath(new URL('./NewScreenDialog.svelte', import.meta.url)), 'utf8')
  const homePage = readFileSync(fileURLToPath(new URL('../../../routes/app/home/+page.svelte', import.meta.url)), 'utf8')

  it('offers New screen and labels custom screens by name', () => {
    expect(source).toContain('onclick={newScreen}')
    expect(source).toContain('New screen…')
    expect(source).toContain('{catalogLabel(provider, $customScreens)}')
    expect(source).toContain("isCustomScreen(provider) ? 'Your own screen' : descriptions[provider]")
    expect(source).toContain('<NewScreenDialog onclose={() => (creatingScreen = false)} />')
  })

  it('creates the screen with its theme, then opens Edit Home on it', () => {
    expect(dialog).toContain('createCustomScreen(name, (theme || null) as ScreenThemeRef | null)')
    expect(dialog).toContain("await goto('/app/home')")
    expect(dialog).toContain('homeEditorOpen.set(true)')
    expect(dialog).toContain('options={screenThemeOptions($studioThemes)}')
  })

  it('gives every screen a theme picker and custom screens rename and delete', () => {
    expect(screensSettings).toContain('catalogScreens($catalogProviders, $customScreens)')
    expect(screensSettings).toContain('setScreenTheme(screen, (value || null) as ScreenThemeRef | null)')
    expect(screensSettings).toContain('renameCustomScreen(renaming, draft)')
    expect(screensSettings).toContain('deleteCustomScreen(screen)')
    expect(screensSettings).toContain('settingKey="catalog-screens"')
  })

  it('renders a custom screen as a Merged Home of its own', () => {
    expect(homePage).toContain('{:else if isMergedScreen($catalogScreen)}')
    expect(homePage).toContain('{#key $catalogScreen}<MergedCatalogHome target={$catalogScreen} anilistHero={heroMedias} />{/key}')
  })
})
