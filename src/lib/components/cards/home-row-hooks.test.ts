import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8').replace(/\r\n/g, '\n')

describe('Home row placeholders', () => {
  it('mark every placeholder card with the row.skeleton part', () => {
    for (const row of ['HomeRow', 'ListRow', 'MalListRow', 'RecentReleaseRow', 'PersonalizedRow', 'ContinueRow']) {
      const source = read(`./${row}.svelte`)
      const placeholders = source.match(/<div[^>]*\bskeloader\b[^>]*>/g) ?? []
      expect(placeholders.length, row).toBeGreaterThan(0)
      for (const placeholder of placeholders) expect(placeholder, row).toContain('data-part="row.skeleton"')
    }
  })
})

describe('the Continue Watching view-more link', () => {
  const row = read('./ContinueRow.svelte')
  it('opens the Library, only when the theme names a view-more style on that row itself', () => {
    expect(row).toContain('const own = (byId?.[id]?.heading ?? byId?.continue?.heading)?.viewMore')
    expect(row).toContain("return own === 'text' || own === 'arrow' ? '/app/library' : undefined")
    // The resolved heading (which folds in `rows.defaults`) is not what decides it.
    expect(row).not.toContain('resolveRow')
    // The loading row, the cards and (API 4 `empty: "shown"`) the empty state.
    expect(row.match(/<Carousel \{title\} \{viewMoreHref\}>/g)).toHaveLength(3)
  })
  it('links to a page that exists', () => {
    expect(read('../../../routes/app/library/+page.svelte')).toContain('<WatchlistView />')
  })
})

describe('the Continue Watching empty state (API 4)', () => {
  const row = read('./ContinueRow.svelte')
  it("is shown only when the theme asks on that row itself, never from rows.defaults", () => {
    expect(row).toContain("return (byId?.[rowScope?.().id ?? '']?.empty ?? byId?.continue?.empty) === 'shown'")
    // Cards first, then the cold-start placeholders; the empty state only when neither applies.
    expect(row.indexOf('{:else if emptyShown}')).toBeGreaterThan(row.indexOf('{:else if items.length}'))
    expect(row.indexOf('{:else if items.length}')).toBeGreaterThan(row.indexOf('{#if cold}'))
  })
  it('names the box, its line and its Browse link', () => {
    expect(row).toContain('<div data-part="row.empty" class=')
    expect(row).toContain('<p data-part="row.empty.text" class="text-sm font-semibold text-muted-foreground">Nothing to continue yet</p>')
    expect(row).toContain('<a data-part="row.empty.action" href="/app/search" data-focusable')
  })
})
