import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8')

describe('card extras', () => {
  it('binds the time left on resume cards', () => {
    const card = read('./ContinueCard.svelte')
    expect(card).toContain("import { episodeDisplayModel, timeLeftLabel } from '$lib/themes/host-model'")
    expect(card).toContain('timeLeft: timeLeftLabel(savedPosition),')
  })
})
