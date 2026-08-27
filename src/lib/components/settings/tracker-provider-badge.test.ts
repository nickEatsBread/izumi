import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const source = readFileSync(fileURLToPath(new URL('./TrackerProviderBadge.svelte', import.meta.url)), 'utf8')

describe('tracker provider badges', () => {
  it('covers every tracker shown by Accounts', () => {
    for (const provider of ['anilist', 'mal', 'kitsu', 'simkl']) {
      expect(source).toContain(`provider === '${provider}'`)
    }
  })

  it('keeps every provider on the same square canvas', () => {
    expect(source.match(/size-10 shrink-0/g)).toHaveLength(4)
  })

  it('does not layer fallback text beneath transparent artwork', () => {
    expect(source.match(/\{#if imageFailed\}/g)).toHaveLength(3)
    expect(source.match(/onerror=\{\(\) => \(imageFailed = true\)\}/g)).toHaveLength(3)
  })

  it('uses the official bundled MyAnimeList mark instead of imitation text', () => {
    expect(source).toContain('src="/brand/myanimelist.svg"')
    expect(source).toMatch(/src="\/brand\/myanimelist\.svg"[\s\S]*?class="size-8 object-contain"/)
  })
})
