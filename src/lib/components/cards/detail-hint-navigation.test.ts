import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const read = (name: string) => readFileSync(fileURLToPath(new URL(name, import.meta.url)), 'utf8')

describe('homepage detail navigation hints', () => {
  it('carries card metadata through both ordinary and Continue Watching title links', () => {
    expect(read('./SmallCard.svelte')).toContain('rememberDetail(media)')
    const continued = read('./ContinueCard.svelte')
    expect(continued).toContain("import { rememberDetail } from '$lib/anilist/detail-hint'")
    expect(continued).toContain('onpointerdown={() => rememberDetail(media, name)}')
    expect(continued).toContain('e.stopPropagation(); rememberDetail(media, name); h.tap()')
  })
})
