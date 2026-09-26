import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8')

describe('series page theme options', () => {
  it('renders the fact styles on phones and desktops', () => {
    const detail = read('./AnimeDetail.svelte')
    expect(detail.match(/<FactList /g)?.length).toBe(2)
    expect(read('./FactList.svelte')).toContain('data-part="detail.facts" data-variant={variant}')
  })
})
