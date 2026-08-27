import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8')
const page = read('./+page.svelte')
const legacy = read('../extensions/+page.ts')
const communitySources = read('../extensions/+page.svelte')
const priority = read('./priority/+page.svelte')
const search = read('../../../../lib/settings/search.ts')

describe('unified Sources settings', () => {
  it('organises all source controls by task on one screen', () => {
    expect(page).toContain("{ id: 'manage', label: 'My sources'")
    expect(page).toContain("{ id: 'playback', label: 'Playback'")
    expect(page).toContain("{ id: 'ordering', label: 'Ordering'")
    expect(page).toMatch(/<CommunitySources\s+[\s\S]*?section="manage"/)
    expect(page).toContain('<CommunitySources section="community-results" />')
    expect(page).toContain('<CommunitySources section="torrent-debrid" />')
    expect(page.indexOf('section="community-results"')).toBeLessThan(page.indexOf('section="torrent-debrid"'))
    expect(page.indexOf('section="torrent-debrid"')).toBeLessThan(page.indexOf('automatic-selection-heading'))
    expect(communitySources).not.toContain('Community sources run third-party code')
  })

  it('uses one paste field and one list on My sources', () => {
    expect(page).toContain('URL, GitHub repo, or catalog')
    expect(page).toContain("import { classifySourceSpec")
    expect(page).toContain('Nothing here yet')
    expect(page).not.toMatch(/<h[1-6][^>]*>Stremio add-ons<\/h[1-6]>/)
    expect(page).not.toContain('source connections configured')
    expect(communitySources).not.toContain('Source repositories')
    expect(communitySources).not.toContain('Installed sources')
    expect(communitySources).not.toContain('placeholder="gh:owner/anime-extensions')
    expect(communitySources).not.toContain('No community sources added.')
    expect(page.indexOf('ADD-ON')).toBeLessThan(page.indexOf('section="manage"'))
  })

  it('filters the merged source list by status and source type', () => {
    expect(page).toContain('aria-label="Filter sources"')
    expect(page).toContain('aria-label="Source filters"')
    expect(page).toContain('manageFilterCount')
    expect(page).toContain('aria-label="Clear status filter"')
    expect(page).toContain('aria-label="Clear type filter"')
    expect(page).toContain('aria-label="Search sources"')
    expect(page).toContain('bind:value={manageQuery}')
    expect(page).toContain('query={manageQuery}')
    expect(page).toContain("{ value: 'disabled', label: 'Disabled' }")
    expect(page).toContain("{ value: 'addon', label: 'Stremio add-ons' }")
    expect(page).toContain("{ value: 'community', label: 'Community sources' }")
    expect(page).toContain("{ value: 'catalog', label: 'Package catalogs' }")
    expect(page).toContain("{ value: 'package', label: 'Installed packages' }")
    expect(communitySources).toContain('visibleExtensionRows')
    expect(communitySources).toContain('visibleOrphans')
    expect(communitySources).toContain('matchesSourceQuery(query')
  })

  it('uses the wider desktop canvas for source management', () => {
    expect(page).toMatch(/role="tablist"[^>]*max-w-7xl/)
    expect(page).toMatch(/sources-panel-manage[\s\S]{0,160}<div class="max-w-7xl">/)
    expect(communitySources).toMatch(/section === 'manage'[\s\S]{0,100}<div class="max-w-7xl">/)
  })

  it('puts Add from Store on the Sources heading row', () => {
    expect(page).toMatch(/<h2 class="[^"]*max-sm:hidden[^"]*">Sources<\/h2>[\s\S]{0,400}Add from Store[\s\S]{0,800}<div role="tablist"/)
  })

  it('keeps old Extensions bookmarks working without retaining a second destination', () => {
    expect(legacy).toContain("redirect(307, '/app/settings/sources?tab=manage')")
  })

  it('routes source search results to the correct view', () => {
    expect(search).toContain("href: '/app/settings/sources?tab=manage'")
    expect(search).toContain("href: '/app/settings/sources?tab=playback'")
    expect(search).toContain("href: '/app/settings/sources?tab=ordering'")
    expect(search).not.toContain("category: 'Extensions'")
  })

  it('shows source artwork throughout the priority editor', () => {
    expect(priority).toContain("import AddonLogo from '$lib/components/player/AddonLogo.svelte'")
    expect(priority).toContain('<AddonLogo logo={source?.logo}')
    expect(priority).toContain('<AddonLogo logo={source.logo}')
  })
})
