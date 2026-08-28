import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8')

describe('multi-platform catalog entry points', () => {
  const home = read('../../../routes/app/home/+page.svelte')
  const search = read('../../../routes/app/search/+page.svelte')
  const sidebar = read('../shell/Sidebar.svelte')
  const catalogSettings = read('../../../routes/app/settings/catalog/+page.svelte')
  const catalogStore = read('../../settings/catalog.ts')

  it('removes the horizontal platform tabs from Home and Search', () => {
    expect(home).not.toContain('CatalogProviderTabs')
    expect(search).not.toContain('CatalogProviderTabs')
  })

  it('supports integrated and separate catalog pickers on Home without duplicating one above Search', () => {
    expect(home).toContain("import CatalogSwitcher from '$lib/components/catalog/CatalogSwitcher.svelte'")
    expect(home).toContain('<CatalogSwitcher display="brand" showWordmark />')
    expect(home).toContain('<CatalogSwitcher display="icon" />')
    expect(home).toContain("$catalogSwitcherPlacement === 'integrated'")
    expect(home).toContain("$catalogSwitcherPlacement === 'below'")
    expect(search).not.toContain("import CatalogSwitcher from '$lib/components/catalog/CatalogSwitcher.svelte'")
    expect(search).not.toContain('<CatalogSwitcher')
    expect(sidebar).toContain('<CatalogSwitcher display="brand" bind:open={catalogPickerOpen}')
    expect(sidebar).toContain('<CatalogSwitcher display="rail" bind:open={catalogPickerOpen}')
    expect(sidebar).toContain('expanded={open}')
    expect(sidebar).toContain("catalogPickerOpen ? 'overflow-visible' : 'overflow-hidden'")
  })

  it('persists the user-selected placement and exposes it in Catalog settings', () => {
    expect(catalogStore).toContain("export type CatalogSwitcherPlacement = 'integrated' | 'below'")
    expect(catalogStore).toContain("'catalog-switcher-placement'")
    expect(catalogStore).toContain("'below',")
    expect(catalogSettings).toContain('Integrated into Izumi logo')
    expect(catalogSettings).toContain('Below Izumi logo')
    expect(catalogSettings).toContain('settingKey="catalog-switcher-placement"')
  })

  it('keeps the brand as Home navigation away from Home', () => {
    expect(sidebar).toContain('href="/app/home"')
    expect(sidebar).not.toContain('cycleCatalog')
    expect(sidebar).not.toContain('event.preventDefault()')
    expect(home).not.toContain('onclick={cycleCatalog}')
  })

  it('cycles forward and backward with Control-Tab only on Home', () => {
    expect(home).toContain('<svelte:window onkeydown={handleCatalogKeydown} />')
    expect(home).toContain("findHotkey(event, $hotkeyBindings, 'Home', $isMacOS)")
    expect(home).toContain('$playing || $androidMpvActive || isTypingTarget(event.target)')
    expect(home).toContain("action === 'homePreviousCatalog'")
    expect(home).toContain('previousCatalogProvider')
    expect(home).toContain('nextCatalogProvider')
  })

  it('feeds a featured carousel from every platform home', () => {
    expect(home).toContain('<Hero medias={heroMedias}')
    expect(read('./CatalogHome.svelte')).toContain('<Hero medias={home.hero}')
    for (const provider of ['kitsu', 'tmdb', 'stremio', 'jvm']) {
      expect(read(`../../catalog/providers/${provider}.ts`)).toMatch(/\bhero[:,]/)
    }
  })

  it('keeps provider Home results warm and accepts progressive row updates', () => {
    const catalogHome = read('./CatalogHome.svelte')
    expect(catalogHome).toContain('providerHomeCache')
    expect(catalogHome).toContain('let home = $state.raw<CatalogHome | null>(null)')
    expect(catalogHome).toContain('const initialHome = cached && Date.now() - cached.storedAt < HOME_CACHE_MS ? cached.home : null')
    expect(catalogHome).toContain('loading = !initialHome')
    expect(catalogHome).toContain('cached?.complete && initialHome')
    expect(catalogHome).toContain('provider.home(abort.signal, undefined, publish)')
    expect(catalogHome).toContain('if (result.hero.length || result.sections.length) loading = false')
    expect(catalogHome).toContain("class:deferred-skeleton={$catalogProvider === 'jvm'}")
    expect(catalogHome).toContain("showCatalogSource={$catalogProvider !== 'jvm'}")
    expect(read('./MergedCatalogHome.svelte')).toContain('let homes = $state.raw<Partial<Record<CatalogSelection, CatalogHome>>>({})')
  })

  it('renders TMDB title artwork on detail pages and keeps a text fallback', () => {
    const detail = read('./CatalogMediaDetail.svelte')
    const tmdb = read('../../catalog/providers/tmdb.ts')
    expect(detail).toContain('{#if titleLogo}')
    expect(detail).toContain('src={titleLogo}')
    expect(detail).toContain('{title(media)}</h1>')
    expect(detail).toContain("{#if provider !== 'tmdb' && provider !== 'jvm'}")
    expect(detail).toContain("{provider === 'tmdb' ? 'TMDB' : 'Open provider'}")
    expect(tmdb).toContain("include_image_language: 'en,null'")
    expect(tmdb).toContain('append_to_response: append')
  })

  it('structures rich source descriptions instead of exposing Markdown as one paragraph', () => {
    const detail = read('./CatalogMediaDetail.svelte')
    expect(detail).toContain("import { parseCatalogDescription } from '$lib/catalog/description'")
    expect(detail).toContain('parsedDescription.synopsis')
    expect(detail).toContain('parsedDescription.facts')
    expect(detail).toContain('parsedDescription.alternativeTitles')
    expect(detail).toContain('parsedDescription.links')
    expect(detail).toContain('aria-label="Source information"')
  })

  it('keeps source information dense on desktop without collapsing the mobile facts', () => {
    const detail = read('./CatalogMediaDetail.svelte')
    expect(detail).toContain('lg:flex lg:items-start lg:gap-5')
    expect(detail).toContain('grid-cols-2 gap-x-5 gap-y-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6')
    expect(detail).toContain('lg:flex-row lg:items-start lg:justify-between')
    expect(detail).toContain('px-2.5 py-1.5 text-xs')
  })

  it('gives the cover meaningful desktop presence without squeezing the text column', () => {
    const detail = read('./CatalogMediaDetail.svelte')
    expect(detail).toContain('max-w-6xl items-end gap-8')
    expect(detail).toContain('md:w-48 lg:w-56 xl:w-64')
    expect(detail).toContain('class="min-w-0 flex-1"')
    expect(detail).not.toContain('aspect-[2/3] w-40 rounded-lg')
  })

  it('carries merged JVM source attribution from search into the series page', () => {
    const detail = read('./CatalogMediaDetail.svelte')
    expect(detail).not.toContain("provider === 'jvm' ? 'JVM source'")
    expect(detail).toContain("import { detailHints } from '$lib/anilist/detail-hint'")
    expect(detail).toContain('...(remembered?.catalogAlternatives ?? [])')
    expect(detail).toContain("provider === 'jvm' && attributedMedia?.catalog?.sourceName")
    expect(detail).toContain('<CatalogSourceAttribution media={attributedMedia} iconSize={20} />')
    expect(detail).toContain('Available from')
  })

  it('does not let Browse invalidate its own provider request', () => {
    const browse = read('./CatalogSearchPage.svelte')
    expect(browse).toContain("import { onMount, untrack } from 'svelte'")
    expect(browse).toContain('untrack(() => {')
    expect(browse).toContain('requestAbort?.abort()')
    expect(browse).toContain('signal: abort?.signal')
  })
})
