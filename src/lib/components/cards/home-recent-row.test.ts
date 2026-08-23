import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8')
const settings = read('../../settings/ui.ts')
const home = read('../../../routes/app/home/+page.svelte')
const row = read('./RecentReleaseRow.svelte')
const queries = read('../../anilist/queries.ts')

describe('Recently Released home row', () => {
  it('is configurable, ordered immediately below Continue Watching, and hidden by default', () => {
    expect(settings).toMatch(/'continue', 'recent'/)
    expect(settings).toContain("rows.includes('recent') ? rows : [...rows, 'recent']")
    expect(home).toContain("row === 'recent'")
    expect(home).toContain('<RecentReleaseRow />')
  })

  it('uses actual episode airings rather than metadata update timestamps', () => {
    expect(queries).toContain('query RecentReleases')
    expect(queries).toContain('airingSchedules(airingAt_greater: $after, airingAt_lesser: $before, sort: TIME_DESC)')
    expect(row).toContain('seen.has(release.media.id)')
    expect(row).toContain('badge={`Episode ${release.episode}`}')
  })

  it('uses a simple play hover and persistently dismisses the active title with D', () => {
    expect(settings).toContain("dismissedRecentReleaseIds = persisted<number[]>('home-recent-dismissed', [])")
    expect(row).toContain('dismissed.has(release.media.id)')
    expect(row).toContain('simpleHover />')
    expect(row).toContain("e.key !== 'd' && e.key !== 'D'")
    expect(row).toContain('dismissedRecentReleaseIds.update')
  })
})
