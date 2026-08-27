import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8')
const page = read('./+page.svelte')
const legacy = read('../extensions/+page.ts')
const search = read('../../../../lib/settings/search.ts')

describe('unified Sources settings', () => {
  it('organises all source controls by task on one screen', () => {
    expect(page).toContain("{ id: 'manage', label: 'My sources'")
    expect(page).toContain("{ id: 'playback', label: 'Playback'")
    expect(page).toContain("{ id: 'ordering', label: 'Ordering'")
    expect(page).toContain('<CommunitySources section="manage" />')
    expect(page).toContain('<CommunitySources section="playback" />')
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
})
