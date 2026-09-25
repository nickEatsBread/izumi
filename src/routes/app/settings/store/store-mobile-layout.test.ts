import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const page = readFileSync(fileURLToPath(new URL('./+page.svelte', import.meta.url)), 'utf8')
const card = readFileSync(fileURLToPath(new URL('../../../../lib/components/store/StoreEntryCard.svelte', import.meta.url)), 'utf8')

describe('Store mobile layout', () => {
  it('lets the page and toolbar shrink to an Android viewport', () => {
    expect(page).toContain('<div class="min-w-0 overflow-x-hidden p-4 sm:p-8">')
    expect(page).toContain('class="mb-4 flex min-w-0 max-w-5xl flex-wrap gap-2"')
    expect(page).toContain('class="relative min-w-0 basis-full sm:min-w-60 sm:basis-auto sm:flex-1"')
  })

  it('keeps store cards inside their grid tracks', () => {
    expect(page).toContain('class="grid min-w-0 max-w-5xl gap-3 sm:grid-cols-2"')
    expect(card).toContain('flex w-full min-w-0 max-w-full gap-3 overflow-hidden rounded-xl')
  })
})

describe('Store behaviour', () => {
  it('browses every store through one filtered list with store and type chips', () => {
    expect(page).toContain('filterStoreEntries(allEntries, filter, isInstalled)')
    expect(page).toContain('aria-label="Stores"')
    expect(page).toContain('aria-label="Type"')
    expect(page).toContain('Add store')
  })

  it('pauses installs from locked stores and drops the old blanket signing claim', () => {
    expect(page).toContain("locked={loaded[entry.storeId]?.trust.state === 'locked'}")
    expect(page).not.toContain('signed/hash-pinned')
  })

  it('shows update status on installed entries, bound to each package origin', () => {
    expect(page).toContain('update={updateAvailable(entry)}')
    expect(page).toContain('refOf(entry) !== null && installed.version !== install.pkg.version')
    expect(page).toContain('installedElsewhere:')
  })

  it('opens the add-store preview from a deep link', () => {
    expect(page).toContain("page.url.searchParams.get('add')")
  })
})
