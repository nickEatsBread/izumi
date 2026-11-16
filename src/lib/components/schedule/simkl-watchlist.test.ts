import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const source = readFileSync(fileURLToPath(new URL('./WatchlistView.svelte', import.meta.url)), 'utf8')

describe('Schedule watchlist tracker sources', () => {
  it('loads SIMKL Watching state into the existing catalogue-neutral watchlist', () => {
    expect(source).toContain("getSimklAnimeListEntries('watching', 100)")
    expect(source).toContain('trackerEntries = [...(ani ?? []), ...(simkl ?? [])]')
    // A tracker that could not be read is named with a retry, never shown as an empty list.
    expect(source).toContain("failed = [ani ? '' : 'AniList', mal ? '' : 'MyAnimeList', simkl ? '' : 'SIMKL']")
    expect(source).toContain('localEntriesForList($localLibrary, selectedListId)')
    expect(source).not.toContain('No tracker linked')
    expect(source).not.toContain('Simkl ↗')
  })
})
