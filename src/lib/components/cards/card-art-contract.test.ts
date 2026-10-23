import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8')

describe('card templates load the artwork they bind (API 6)', () => {
  for (const file of ['./SmallCard.svelte', './ContinueCard.svelte']) {
    it(`${file} asks only for the artwork its template binds, once the card nears the screen`, () => {
      const source = read(file)
      expect(source).toContain('artNeeds(templateNeeds(')
      expect(source).toContain("import { nearViewport } from '$lib/util/near-viewport'")
      expect(source).toContain('use:nearViewport={artWanted.size ? artGate : undefined}')
      expect(source).toContain('queueTitleArt(target, wanted)')
      expect(source).toContain('...cardArt')
    })
  }
})
