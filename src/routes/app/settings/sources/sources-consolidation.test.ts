import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { SETTINGS_SEARCH_INDEX, searchSettings } from '$lib/settings/search'
import { settingsSection } from '$lib/settings/sections'
import { renderedSettingKeys, sectionOf, subcategoriesOf } from '../../../../test/settings-sections'

const here = (relative: string) => fileURLToPath(new URL(relative, import.meta.url))
const read = (relative: string) => readFileSync(here(relative), 'utf8').replace(/\r\n/g, '\n')
const file = here('./+page.svelte')
const page = read('./+page.svelte')
const sourcesLoad = read('./+page.ts')
const manage = read('./manage/+page.svelte')
const legacy = read('../extensions/+page.ts')
const communitySources = read('../extensions/+page.svelte')
const store = read('../store/+page.svelte')
const priority = read('./priority/+page.svelte')
const debrid = read('../../../../lib/components/settings/TorrentDebridSettings.svelte')
const subcategories = subcategoriesOf(file)
const block = (id: string) => subcategories.find((sub) => sub.id === id)?.source ?? ''
// The paste field's add logic, shared with first-run setup.
const addSource = read('../../../../lib/settings/add-source.ts')

/** Row keys on the section page (or its debrid component), with the subcategory that renders them. */
const ROWS: Record<string, string> = {
  'torrent-playback': 'debrid',
  'debrid-service': 'debrid',
  'debrid-key': 'debrid',
  'default-discussion-source': 'discussion',
  'source-priority': 'priority',
  'source-priority-mode': 'advanced',
  'package-updates': 'advanced',
}

describe('Sources and store section', () => {
  it('is a SettingsSection page with no title of its own', () => {
    expect(sectionOf(file)).toBe('sources')
    expect(page).not.toContain('data-settings-page-title')
  })

  it('renders the registry subcategories in order with Advanced last', () => {
    const ids = subcategories.map((sub) => sub.id)
    expect(ids).toEqual(['my-sources', 'store', 'debrid', 'discussion', 'priority', 'advanced'])
    expect(ids).toEqual(settingsSection('sources').subcategories.map((sub) => sub.id))
  })

  it('folds Advanced behind a summary of its rows, and folds nothing else', () => {
    expect(subcategories.at(-1)).toMatchObject({ id: 'advanced', summary: 'Priority mode, package updates', collapsible: false, plain: false })
    expect(subcategories.filter((sub) => sub.collapsible || sub.summary !== undefined).map((sub) => sub.id)).toEqual(['advanced'])
  })

  it('renders every section row key through the page and its components', () => {
    const keys = renderedSettingKeys(file)
    for (const key of Object.keys(ROWS)) expect(keys, key).toContain(key)
  })

  it.each(Object.entries(ROWS))('%s sits in %s and search sends it there', (key, subcategory) => {
    if (subcategory === 'debrid') {
      expect(block('debrid')).toContain('<TorrentDebridSettings />')
      expect(debrid).toContain(`settingKey="${key}"`)
    } else {
      expect(block(subcategory)).toContain(`settingKey="${key}"`)
    }
    const entries = SETTINGS_SEARCH_INDEX.filter((item) => item.key === key)
    expect(entries.length, key).toBeGreaterThan(0)
    for (const entry of entries) {
      expect(entry, key).toMatchObject({ section: 'sources', subcategory, href: '/app/settings/sources' })
      expect(entry.advanced === true, key).toBe(subcategory === 'advanced')
    }
  })

  it('links My sources, Store and Priority as sub-pages with their status', () => {
    expect(block('my-sources')).toContain('href="/app/settings/sources/manage"')
    expect(block('my-sources')).toMatch(/value=\{sourceCount \?/)
    expect(block('store')).toContain('href="/app/settings/store"')
    expect(block('priority')).toContain('href="/app/settings/sources/priority"')
    expect(block('priority')).toContain('value={priorityValue}')
    expect(page).toContain("'source' : 'sources'} ordered`")
  })

  it('shows the torrent and debrid rows without mounting the source list', () => {
    expect(page).not.toContain('CommunitySources')
    expect(communitySources).not.toContain("section === 'torrent-debrid'")
    expect(communitySources).not.toContain('torrentPlaybackMode')
  })

  it('moves the default discussion source off the old Ordering tab into Discussion', () => {
    expect(block('discussion')).toContain('value={$defaultDiscussionPlatform}')
    expect(block('discussion')).toContain("{ value: 'auto', label: 'Auto — all sources' }")
  })

  it('keeps the catalog update check, now under Advanced', () => {
    expect(page).toContain("import { checkExtensionUpdates } from '$lib/extensions/auto-update'")
    expect(page).toMatch(/checkExtensionUpdates\(\{[\s\S]{0,180}retryAttempted: true,[\s\S]{0,180}includeDisabledCatalogs: true,[\s\S]{0,80}\}\)/)
    expect(block('advanced')).toContain('onclick={() => void checkForUpdates()}')
    expect(manage).not.toContain('checkExtensionUpdates')
  })

  it('moves the priority mode out of the priority editor into Advanced', () => {
    expect(block('advanced')).toContain('value={$sourcePriorityMode}')
    expect(block('advanced')).toContain('$sourcePriorityMode = value as SourcePriorityMode')
    expect(priority).not.toContain('sourcePriorityMode')
    expect(priority).not.toContain('How strictly to apply it')
  })

  it('drops the tab strip and maps old ?tab= links', () => {
    expect(page).not.toContain('role="tablist"')
    expect(page).not.toContain('?tab=')
    expect(sourcesLoad).toContain("if (url.searchParams.has('tab'))")
    expect(sourcesLoad).toContain('legacySettingsRedirect(url)')
  })

  it('sends source search hits to the section or the Manage sources sub-page', () => {
    expect(searchSettings('source repositories')[0]).toMatchObject({ href: '/app/settings/sources/manage', section: 'sources', subcategory: 'my-sources' })
    expect(searchSettings('add-on sources')[0]).toMatchObject({ href: '/app/settings/sources/manage', section: 'sources', subcategory: 'my-sources' })
    expect(searchSettings('store')[0]).toMatchObject({ href: '/app/settings/store', section: 'sources', subcategory: 'store' })
    expect(searchSettings('check for updates')[0]?.title).toBe('Check for updates')
  })
})

describe('Manage sources sub-page', () => {
  it('opens with its title and Add from Store before the paste field', () => {
    const title = manage.indexOf('>Manage sources</h2>')
    const storeLink = manage.indexOf('Add from Store', title)
    const field = manage.indexOf('URL, GitHub repo, or catalog', storeLink)
    expect(title).toBeGreaterThan(-1)
    expect(storeLink).toBeGreaterThan(title)
    expect(field).toBeGreaterThan(storeLink)
  })

  it('uses compact accessible bin actions for removing add-ons and tracker feeds', () => {
    expect(manage).toContain("import Trash2 from '@lucide/svelte/icons/trash-2'")
    expect(manage.match(/<Trash2 size=\{16\} \/>/g)).toHaveLength(3)
    expect(manage).not.toContain('>Remove</button>')
  })

  it('uses accessible cog actions for configurable add-ons and extension sources', () => {
    expect(manage).toContain("import Settings from '@lucide/svelte/icons/settings'")
    expect(manage).toContain('aria-label={`Configure ${m.name}`}')
    expect(manage).toContain('<Settings size={17} />')
    expect(manage).not.toContain('>Configure</button>')
    expect(communitySources).toContain("import JvmSourcePreferences from '$lib/components/catalog/JvmSourcePreferences.svelte'")
    expect(communitySources).toContain("p.backend === 'aniyomi-jvm' && p.sources[0]")
    expect(communitySources).toContain('openJvmSourceSettings(p.sources[0].id, p.sources[0].name)')
    expect(communitySources).toContain("p.backend === 'aniyomi-jvm' && p.sourceId")
    expect(communitySources).toContain('<JvmSourcePreferences')
  })

  it('uses one paste field and one list', () => {
    expect(manage).toContain('URL, GitHub repo, or catalog')
    expect(manage).toContain("import { addSourceSpec, type AddSourceResult } from '$lib/settings/add-source'")
    // An already-added source keeps its own message instead of falling through to the tracker check.
    expect(manage).toContain('if (result.duplicate) {')
    expect(manage).toContain('Nothing here yet')
    expect(manage).toMatch(/<CommunitySources\s+[\s\S]*?section="manage"/)
    expect(manage).not.toMatch(/<h[1-6][^>]*>Stremio add-ons<\/h[1-6]>/)
    expect(communitySources).not.toContain('Source repositories')
    expect(communitySources).not.toContain('Installed sources')
    expect(communitySources).not.toContain('No community sources added.')
    expect(manage.indexOf('ADD-ON')).toBeLessThan(manage.indexOf('section="manage"'))
  })

  it('adds and lists torrent tracker feeds from the same paste field', () => {
    expect(manage).toContain("import { checkTrackerFeed, isSearchFeedUrl, trackerFeedUrls } from '$lib/extensions/tracker-feeds'")
    expect(manage).toContain("{ value: 'indexer', label: 'Torrent trackers' }")
    expect(manage).toContain('onclick={() => removeIndexer(url)}')
  })

  it('filters the merged source list by status and source type', () => {
    expect(manage).toContain('aria-label="Filter sources"')
    expect(manage).toContain('aria-label="Source filters"')
    expect(manage).toContain('manageFilterCount')
    expect(manage).toContain('aria-label="Clear status filter"')
    expect(manage).toContain('aria-label="Clear type filter"')
    expect(manage).toContain('aria-label="Search sources"')
    expect(manage).toContain('bind:value={manageQuery}')
    expect(manage).toContain('query={manageQuery}')
    expect(manage).toContain("{ value: 'disabled', label: 'Disabled' }")
    expect(manage).toContain("{ value: 'catalog', label: 'Package catalogs' }")
    expect(manage).toContain("{ value: 'package', label: 'Installed packages' }")
    expect(communitySources).toContain('visibleExtensionRows')
    expect(communitySources).toContain('visibleOrphans')
    expect(communitySources).toContain('matchesSourceQuery(query')
  })

  it('uses a search, sort, filter toolbar and a merged two-column layout on wide displays', () => {
    const search = manage.indexOf('aria-label="Search sources"')
    const sort = manage.indexOf('aria-label="Sort sources"')
    const filter = manage.indexOf('aria-label="Filter sources"')
    expect(search).toBeLessThan(sort)
    expect(sort).toBeLessThan(filter)
    expect(manage).toContain('class="relative col-span-2 min-w-0 sm:min-w-52 sm:flex-1"')
    expect(manage).toContain('<div data-source-masonry class="mt-3 grid items-start gap-2 2xl:auto-rows-[1px] 2xl:grid-cols-2">')
    expect(manage).toContain('<ul class="contents">')
    expect(manage).toContain('<div class="max-w-7xl">')
    expect(communitySources).toContain('<ul class="contents">')
    expect(communitySources).toMatch(/section === 'manage'[\s\S]{0,100}<div class="contents"/)
  })

  it('sorts enabled sources first by default without redundant state badges', () => {
    expect(manage).toContain("let manageSortMode = $state<SourceSortMode>('enabled')")
    expect(manage).toContain("{ value: 'enabled', label: 'Enabled first' }")
    expect(manage).toContain('sortManagedSources([...addonSortEntries, ...indexerSortEntries, ...communitySortEntries], manageSortMode)')
    expect(manage).toContain('bind:manageSortEntries={communitySortEntries}')
    expect(communitySources).toContain('style:order={sortRanks.get(`extension:${url}`) ?? 0}')
    expect(communitySources).toContain('style:order={sortRanks.get(`package:${p.id}`) ?? 0}')
    expect(communitySources).not.toContain("{pOff ? 'OFF' : 'ENABLED'}")
  })

  it('keeps the add controls and source cards inside phone-width viewports', () => {
    expect(manage).toContain('class="min-w-0 overflow-x-hidden p-4 sm:p-8"')
    expect(manage).toMatch(/href="\/app\/settings\/store"[^>]*class="[^"]*w-full[^"]*sm:w-auto/)
    expect(manage).toContain('class="flex flex-col gap-2 sm:flex-row"')
    expect(manage).toContain('class="min-w-0 flex-1 rounded-md bg-input')
    expect(manage).toContain('class="flex min-w-0 flex-col gap-3 overflow-hidden rounded-lg border border-border p-3 sm:flex-row sm:items-center"')
    expect(manage).toContain('class="flex w-full min-w-0 flex-wrap items-center justify-end gap-2 sm:w-auto sm:flex-nowrap"')
    expect(communitySources).toContain('class="min-w-0 overflow-hidden rounded-lg border border-border p-3"')
  })

  it('masonry-packs expanded sources without leaving a matching gap in the other column', () => {
    expect(manage).toContain('use:masonryItem style:order={manageSortRanks.get(`addon:${url}`) ?? 0}')
    expect(communitySources).toContain('use:masonryItem style:order={sortRanks.get(`extension:${url}`) ?? 0}')
    expect(communitySources).toContain('use:masonryItem style:order={sortRanks.get(`package:${p.id}`) ?? 0}')
  })

  it('asks before replacing a package installed elsewhere, and freezes legacy stores before adding a source', () => {
    expect(communitySources).toContain("!mayUpdateFrom(url, p, inst) ? 'Replace'")
    expect(communitySources).toContain('error instanceof PackageInstalledElsewhereError')
    expect(communitySources).toContain('<ReplacePackageDialog')
    expect(communitySources).toContain('void installFromCatalog(chosen.url, chosen.extension, true)')
    expect(addSource).toContain('currentLegacyStores()')
  })

  it('keeps old Extensions bookmarks working without a second destination', () => {
    expect(legacy).toContain('legacySettingsRedirect(url)')
    expect(legacy).toContain("'/app/settings/sources/manage'")
  })

  it('installs Store entries through the shared dispatcher, which keeps catalogs on the source list', () => {
    expect(store).toContain('installStoreEntry(entry, {')
    expect(store).toContain('adapter: loaded[entry.storeId]?.listing?.adapter')
    expect(store).toContain('href="/app/settings/sources/manage"')
  })

  it('shows source artwork throughout the priority editor', () => {
    expect(priority).toContain("import AddonLogo from '$lib/components/player/AddonLogo.svelte'")
    expect(priority).toContain('<AddonLogo logo={source?.logo}')
    expect(priority).toContain('<AddonLogo logo={source.logo}')
  })
})
