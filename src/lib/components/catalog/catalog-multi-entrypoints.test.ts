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
      expect(source).toContain('$catalogProvider = nextCatalog')
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
})
