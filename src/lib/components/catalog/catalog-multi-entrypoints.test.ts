import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8')

describe('multi-platform catalog entry points', () => {
  const home = read('../../../routes/app/home/+page.svelte')
  const search = read('../../../routes/app/search/+page.svelte')
  const sidebar = read('../shell/Sidebar.svelte')

  it('removes the horizontal platform tabs from Home and Search', () => {
    expect(home).not.toContain('CatalogProviderTabs')
    expect(search).not.toContain('CatalogProviderTabs')
  })

  it('uses an explicit catalog picker on both Home and Search', () => {
    expect(home).toContain("import CatalogSwitcher from '$lib/components/catalog/CatalogSwitcher.svelte'")
    expect(home).toContain('<CatalogSwitcher')
    expect(search).toContain("import CatalogSwitcher from '$lib/components/catalog/CatalogSwitcher.svelte'")
    expect(search.match(/<CatalogSwitcher/g)).toHaveLength(2)
  })

  it('keeps the brand as predictable Home navigation', () => {
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

  it('attributes JVM titles to their actual source below the title metadata', () => {
    const detail = read('./CatalogMediaDetail.svelte')
    expect(detail).not.toContain("provider === 'jvm' ? 'JVM source'")
    expect(detail).toContain("provider === 'jvm' && media.catalog?.sourceName")
    expect(detail).toContain('logo={media.catalog.sourceIcon}')
    expect(detail).toContain('{media.catalog.sourceName}</span>')
  })

  it('does not let Browse invalidate its own provider request', () => {
    const browse = read('./CatalogSearchPage.svelte')
    expect(browse).toContain("import { onMount, untrack } from 'svelte'")
    expect(browse).toContain('untrack(() => {')
    expect(browse).toContain('requestAbort?.abort()')
    expect(browse).toContain('signal: abort?.signal')
  })
})
