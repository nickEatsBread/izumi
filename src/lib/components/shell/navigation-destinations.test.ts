import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8')

describe('navigation destinations', () => {
  it('uses Schedule as the only watchlist destination', () => {
    const sidebar = read('./Sidebar.svelte')
    const nav = read('../../settings/nav.ts')
    const myListRoute = fileURLToPath(new URL('../../../routes/app/mylist/+page.svelte', import.meta.url))

    expect(sidebar).not.toContain('/app/mylist')
    expect(nav).not.toContain("id: 'mylist'")
    expect(existsSync(myListRoute)).toBe(false)
  })

  it('does not label tracker state as a card catalogue source', () => {
    const card = read('../cards/SmallCard.svelte')
    expect(card).not.toContain('sourceLabel')
    expect(card).not.toContain('View on ${sourceLabel}')
  })
})
