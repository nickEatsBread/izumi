import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const page = readFileSync(fileURLToPath(new URL('./+page.svelte', import.meta.url)), 'utf8')

describe('Source Store mobile layout', () => {
  it('lets the page and toolbar shrink to an Android viewport', () => {
    expect(page).toContain('<div class="min-w-0 overflow-x-hidden p-4 sm:p-8">')
    expect(page).toContain('class="mb-4 flex min-w-0 max-w-5xl flex-wrap gap-2"')
    expect(page).toContain('class="relative min-w-0 basis-full sm:min-w-60 sm:basis-auto sm:flex-1"')
  })

  it('keeps both kinds of store cards inside their grid tracks', () => {
    expect(page.match(/class="grid min-w-0 max-w-5xl gap-3 sm:grid-cols-2"/g)).toHaveLength(2)
    expect(page).toContain('flex w-full min-w-0 max-w-full gap-3 overflow-hidden rounded-xl')
    expect(page).toContain('w-full min-w-0 max-w-full overflow-hidden rounded-xl')
  })
})
