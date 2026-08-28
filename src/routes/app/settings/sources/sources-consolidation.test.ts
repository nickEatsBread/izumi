import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8')
const page = read('./+page.svelte')
const legacy = read('../extensions/+page.ts')
const communitySources = read('../extensions/+page.svelte')
const store = read('../store/+page.svelte')
const priority = read('./priority/+page.svelte')
const search = read('../../../../lib/settings/search.ts')

describe('unified Sources settings', () => {
  it('uses compact accessible bin actions for removing add-ons', () => {
    expect(page).toContain("import Trash2 from '@lucide/svelte/icons/trash-2'")
    expect(page.match(/<Trash2 size=\{16\} \/>/g)).toHaveLength(2)
    expect(page).not.toContain('>Remove</button>')
  })

  it('uses accessible cog actions for configurable Stremio and Aniyomi sources', () => {
    expect(page).toContain("import Settings from '@lucide/svelte/icons/settings'")
    expect(page).toContain('aria-label={`Configure ${m.name}`}')
    expect(page).toContain('<Settings size={17} />')
    expect(page).not.toContain('>Configure</button>')
    expect(communitySources).toContain("import JvmSourcePreferences from '$lib/components/catalog/JvmSourcePreferences.svelte'")
    expect(communitySources).toContain("p.backend === 'aniyomi-jvm' && p.sources[0]")
    expect(communitySources).toContain('openJvmSourceSettings(p.sources[0].id, p.sources[0].name)')
    expect(communitySources).toContain("p.backend === 'aniyomi-jvm' && p.sourceId")
    expect(communitySources).toContain('<JvmSourcePreferences')
  })

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

  it('uses a search, sort, filter toolbar and a merged two-column layout on wide displays', () => {
    const search = page.indexOf('aria-label="Search sources"')
    const sort = page.indexOf('aria-label="Sort sources"')
    const filter = page.indexOf('aria-label="Filter sources"')
    expect(search).toBeLessThan(sort)
    expect(sort).toBeLessThan(filter)
    expect(page).toContain('class="relative col-span-2 min-w-0 sm:min-w-52 sm:flex-1"')
    expect(page).toContain('<div data-source-masonry class="mt-3 grid items-start gap-2 2xl:auto-rows-[1px] 2xl:grid-cols-2">')
    expect(page).toContain('<ul class="contents">')
    expect(communitySources).toContain('<ul class="contents">')
  })

  it('sorts enabled sources first by default without redundant state badges', () => {
    expect(page).toContain("let manageSortMode = $state<SourceSortMode>('enabled')")
    expect(page).toContain("{ value: 'enabled', label: 'Enabled first' }")
    expect(page).toContain('sortManagedSources([...addonSortEntries, ...communitySortEntries], manageSortMode)')
    expect(page).toContain('bind:manageSortEntries={communitySortEntries}')
    expect(communitySources).toContain('style:order={sortRanks.get(`extension:${url}`) ?? 0}')
    expect(communitySources).toContain('style:order={sortRanks.get(`package:${p.id}`) ?? 0}')
    expect(communitySources).not.toContain("{pOff ? 'OFF' : 'ENABLED'}")
  })

  it('uses the wider desktop canvas for source management', () => {
    expect(page).toMatch(/role="tablist"[^>]*max-w-7xl/)
    expect(page).toMatch(/sources-panel-manage[\s\S]{0,160}<div class="max-w-7xl">/)
    expect(communitySources).toMatch(/section === 'manage'[\s\S]{0,100}<div class="contents"/)
  })

  it('puts Check for Updates directly before Add from Store on the Sources heading row', () => {
    const heading = page.indexOf('>Sources</h2>')
    const check = page.indexOf("'Check for Updates'", heading)
    const store = page.indexOf('Add from Store', check)
    const tabs = page.indexOf('<div role="tablist"', store)
    expect(heading).toBeGreaterThan(-1)
    expect(check).toBeGreaterThan(heading)
    expect(store).toBeGreaterThan(check)
    expect(tabs).toBeGreaterThan(store)
    expect(page).toContain("import { checkExtensionUpdates } from '$lib/extensions/auto-update'")
    expect(page).toMatch(/checkExtensionUpdates\(\{[\s\S]{0,180}retryAttempted: true,[\s\S]{0,180}includeDisabledCatalogs: true,[\s\S]{0,180}includeOfficialCatalog: true,[\s\S]{0,80}\}\)/)
    expect(page).toMatch(/class="[^"]*sm:translate-y-3[^"]*sm:flex-row"/)
  })

  it('keeps the built-in update catalog available after installing from the Store', () => {
    expect(store).toContain('disabledExtensions, disabledPlugins, enabledExtensionUrls, extensionUrls')
    expect(store).toContain('$disabledExtensions = $disabledExtensions.filter((spec) => spec !== OFFICIAL_ANIME_CATALOG)')
  })

  it('keeps the add controls and source cards inside phone-width viewports', () => {
    expect(page).toContain('class="min-w-0 overflow-x-hidden p-4 sm:p-8"')
    expect(page).toMatch(/href="\/app\/settings\/store"[^>]*class="[^"]*w-full[^"]*sm:w-auto/)
    expect(page).toContain('class="flex flex-col gap-2 sm:flex-row"')
    expect(page).toContain('class="min-w-0 flex-1 rounded-md bg-input')
    expect(page).toContain('class="flex min-w-0 flex-col gap-3 overflow-hidden rounded-lg border border-border p-3 sm:flex-row sm:items-center"')
    expect(page).toContain('class="flex w-full min-w-0 flex-wrap items-center justify-end gap-2 sm:w-auto sm:flex-nowrap"')
    expect(communitySources).toContain('class="min-w-0 overflow-hidden rounded-lg border border-border p-3"')
    expect(communitySources).toContain('class="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-center"')
    expect(communitySources).toContain('class="flex w-full min-w-0 flex-wrap items-center justify-end gap-2 sm:w-auto sm:flex-nowrap"')
  })

  it('masonry-packs expanded sources without leaving a matching gap in the other column', () => {
    expect(page).toContain('data-source-masonry')
    expect(page).toContain('use:masonryItem style:order={manageSortRanks.get(`addon:${url}`) ?? 0}')
    expect(communitySources).toContain('use:masonryItem style:order={sortRanks.get(`extension:${url}`) ?? 0}')
    expect(communitySources).toContain('use:masonryItem style:order={sortRanks.get(`package:${p.id}`) ?? 0}')
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
