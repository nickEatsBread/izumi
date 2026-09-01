import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = process.cwd()
const read = (path: string) => readFileSync(resolve(root, path), 'utf8')

describe('studio and staff profile navigation', () => {
  it('links anime details directly to dedicated profile routes', () => {
    const detail = read('src/lib/components/detail/AnimeDetail.svelte')
    const people = read('src/lib/components/detail/RichMetadata.svelte')
    expect(detail).toContain('`/app/studio/${studio.id}`')
    expect(detail).not.toContain('/app/search?studio=')
    expect(people).toContain('`/app/staff/${actor.id}`')
    expect(people).toContain('`/app/staff/${credit.node.id}`')
    expect(people).not.toContain('/app/search?staff=')
  })

  it('provides profile headers and paginated credit grids', () => {
    const studio = read('src/routes/app/studio/[id]/+page.svelte')
    const staff = read('src/routes/app/staff/[id]/+page.svelte')
    expect(studio).toContain('STUDIO_PROFILE_QUERY')
    expect(studio).toContain('<SearchResults {filters} />')
    expect(staff).toContain('STAFF_PROFILE_QUERY')
    expect(staff).toContain('Anime credits')
    expect(staff).toContain('<SearchResults {filters} />')
  })

  it('combines production and voice credits and applies the adult preference', () => {
    const results = read('src/lib/components/search/SearchResults.svelte')
    expect(results).toContain('batch = [...credited, ...voiced]')
    expect(results).toContain('$showAdult || !item.isAdult')
    expect(results).toContain('queueMicrotask(() => void loadMore())')
  })
})
