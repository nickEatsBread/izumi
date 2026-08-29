import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const picker = readFileSync(fileURLToPath(new URL('./LocalListPicker.svelte', import.meta.url)), 'utf8')
const catalogDetail = readFileSync(fileURLToPath(new URL('../catalog/CatalogMediaDetail.svelte', import.meta.url)), 'utf8')
const animeDetail = readFileSync(fileURLToPath(new URL('../detail/AnimeDetail.svelte', import.meta.url)), 'utf8')
const preview = readFileSync(fileURLToPath(new URL('../cards/PreviewCard.svelte', import.meta.url)), 'utf8')
const watchlist = readFileSync(fileURLToPath(new URL('../schedule/WatchlistView.svelte', import.meta.url)), 'utf8')

describe('account-independent saved lists UI', () => {
  it('opens the same list picker from provider and AniList detail pages', () => {
    expect(catalogDetail).toContain('<LocalListPicker {media}')
    expect(animeDetail).toContain('<LocalListPicker media={m}')
    expect(picker).toContain('No account needed.')
    expect(picker).toContain('createLocalList(newListName)')
    expect(picker).toContain('event.target === event.currentTarget')
  })

  it('makes card watchlist saving available without tracker gating', () => {
    expect(preview).toContain('toggleMediaInLocalList(media, WATCHLIST_ID)')
    expect(preview).not.toContain('anyTrackerConnected')
    expect(preview).not.toContain('Connect a tracker to bookmark')
  })

  it('shows local and custom lists in Schedule even when signed out', () => {
    expect(watchlist).toContain('localEntriesForList($localLibrary, selectedListId)')
    expect(watchlist).toContain('No account is required.')
    expect(watchlist).not.toContain('No tracker linked')
  })
})
