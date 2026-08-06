import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

// Opening a result and coming back (browser Back, Android back, B on the Deck) remounts the search
// page, which seeds itself from the URL. Nothing ever wrote the typed query there, so every return
// landed on an empty search.

const page = readFileSync(fileURLToPath(new URL('./+page.svelte', import.meta.url)), 'utf8')

describe('search URL state', () => {
  it('mirrors the settled filters into the URL', () => {
    expect(page).toContain("import { replaceState } from '$app/navigation'")
    for (const param of ['search', 'sort', 'genre', 'season', 'year']) {
      expect(page).toContain(`params.set('${param}'`)
    }
  })

  it('replaces rather than pushes, so Back leaves the page', () => {
    // pushState would stack an entry per debounced edit and make Back crawl through the query.
    expect(page).toContain('replaceState(next, page.state)')
    expect(page).not.toContain('pushState(')
  })

  it('writes only the params the seed reads back', () => {
    // A param the seed ignores would vanish on the return trip and look like mangled filters.
    const written = [...page.matchAll(/params\.set\('(\w+)'/g)].map((m) => m[1]).sort()
    const seeded = [...page.matchAll(/sp\.get\('(\w+)'\)/g)].map((m) => m[1])
    for (const param of written) expect(seeded).toContain(param)
  })

  it('settles instead of rewriting the URL on every run', () => {
    expect(page).toContain('if (next === page.url.pathname + page.url.search) return')
  })
})
