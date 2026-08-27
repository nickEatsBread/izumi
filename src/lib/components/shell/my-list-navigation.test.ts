import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8')

describe('My List navigation', () => {
  it('is a fixed desktop and Gamescope sidebar destination', () => {
    const sidebar = read('./Sidebar.svelte')
    expect(sidebar).toContain("href: '/app/mylist'")
    expect(sidebar).toContain("label: 'My List'")
  })

  it('is visible in the default mobile bottom bar', () => {
    const nav = read('../../settings/nav.ts')
    expect(nav).toContain("{ id: 'mylist', placement: 'bottom' }")
    expect(nav).not.toContain("{ id: 'mylist', placement: 'hidden' }")
  })

  it('keeps a connected SIMKL library visible even when its Watching list is empty', () => {
    const page = read('../../../routes/app/mylist/+page.svelte')
    const row = read('../cards/TrackerListRow.svelte')
    expect(page).toContain('Simkl Library')
    expect(page).toContain('status="watching" showEmpty')
    expect(row).toContain('{:else if showEmpty}')
    expect(row).toContain('No titles in this list.')
  })
})
