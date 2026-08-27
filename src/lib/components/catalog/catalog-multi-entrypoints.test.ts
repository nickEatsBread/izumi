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

  it('cycles enabled platforms from the Izumi logo on desktop and mobile Home', () => {
    for (const source of [home, sidebar]) {
      expect(source).toContain('nextCatalogProvider')
      expect(source).toContain('function cycleCatalog()')
      expect(source).toContain('selectCatalogProvider(nextCatalog)')
    }
  })

  it('uses the desktop logo as Home navigation away from Home', () => {
    expect(sidebar).toContain('href="/app/home"')
    expect(sidebar).toContain("if (!onHome) { h.tap(); return }")
    expect(sidebar).toContain('event.preventDefault()')
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
    for (const provider of ['kitsu', 'tmdb', 'stremio']) {
      expect(read(`../../catalog/providers/${provider}.ts`)).toContain('hero:')
    }
  })

  it('renders TMDB title artwork on detail pages and keeps a text fallback', () => {
    const detail = read('./CatalogMediaDetail.svelte')
    const tmdb = read('../../catalog/providers/tmdb.ts')
    expect(detail).toContain('{#if titleLogo}')
    expect(detail).toContain('src={titleLogo}')
    expect(detail).toContain('{title(media)}</h1>')
    expect(detail).toContain("{#if provider !== 'tmdb'}")
    expect(detail).toContain("{provider === 'tmdb' ? 'TMDB' : 'Open provider'}")
    expect(tmdb).toContain("include_image_language: 'en,null'")
    expect(tmdb).toContain('append_to_response: append')
  })

  it('does not let Browse invalidate its own provider request', () => {
    const browse = read('./CatalogSearchPage.svelte')
    expect(browse).toContain("import { onMount, untrack } from 'svelte'")
    expect(browse).toContain('untrack(() => {')
    expect(browse).toContain('requestAbort?.abort()')
    expect(browse).toContain('signal: abort?.signal')
  })
})
