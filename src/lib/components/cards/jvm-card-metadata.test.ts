import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const read = (name: string) => readFileSync(fileURLToPath(new URL(name, import.meta.url)), 'utf8')

describe('JVM card metadata', () => {
  it('attributes compact cards to their installed source instead of inventing a format', () => {
    const card = read('./SmallCard.svelte')
    expect(card).toContain("media.catalog?.provider === 'jvm'")
    expect(card).toContain('jvmSource.sourceIcon')
    expect(card).toContain('jvmSource.sourceName')
    expect(card).toContain('jvmSource.sourceLanguage')
  })

  it('only renders known preview facts and offers to load missing JVM details', () => {
    const preview = read('./PreviewCard.svelte')
    expect(preview).toContain('Open to load full details and episodes from')
    expect(preview).not.toContain("totalEpisodes(media) || '?'")
    expect(preview).not.toContain("media.averageScore ?? '–'")
  })
})
