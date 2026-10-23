import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8')

describe('card templates load the artwork they bind (API 6)', () => {
  for (const file of ['./SmallCard.svelte', './ContinueCard.svelte']) {
    it(`${file} loads artwork through the shared helper and registers a gate only when its template binds some`, () => {
      const source = read(file)
      expect(source).toContain("import { useCardArt } from '$lib/themes/card-art.svelte'")
      expect(source).toMatch(/const cardArt = useCardArt\(\(\) => \w+, \(\) => media, \(\) => \w+\)/)
      expect(source).toContain("import { nearViewport } from '$lib/util/near-viewport'")
      expect(source).toContain('use:nearViewport={cardArt.wanted.size ? cardArt.gate : undefined}')
      // The artwork comes last, over the model's own fields.
      expect(source).toMatch(/\.\.\.cardArt\.art,?\s*\}/)
      // The lookup logic lives in the helper only.
      expect(source).not.toContain('queueTitleArt')
    })
  }

  it('the helper asks only for bound artwork, once near the screen, keyed on the title', () => {
    const source = read('../../themes/card-art.svelte.ts')
    expect(source).toContain('artNeeds(templateNeeds(')
    expect(source).toContain('onEnter: () => { near = true }, observeParent: false')
    expect(source).toContain('titleExtrasKey(media())')
    expect(source).toContain('untrack(media)')
    expect(source).toContain('queueTitleArt(target, needs, { alive: () => live, distance: () => offscreenDistance(node()) })')
  })
})
