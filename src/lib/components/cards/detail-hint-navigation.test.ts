import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const read = (name: string) => readFileSync(fileURLToPath(new URL(name, import.meta.url)), 'utf8')

describe('homepage detail navigation hints', () => {
  it('carries card metadata through both ordinary and Continue Watching title links', () => {
    expect(read('./SmallCard.svelte')).toContain('rememberDetail(media)')
    const continued = read('./ContinueCard.svelte')
    expect(continued).toContain("import { openDetail, rememberDetail } from '$lib/anilist/detail-hint'")
    expect(continued).toContain('onpointerdown={() => rememberDetail(media, name)}')
    // The title routes itself: the stopped click keeps the card's play handler out, and a stopped
    // click that was not cancelled would skip SvelteKit's router and reload the whole app.
    expect(continued).toContain('onclick={(e) => { e.preventDefault(); e.stopPropagation(); h.tap(); void openDetail(media, name) }}')
  })
})
