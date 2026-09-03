import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const layout = readFileSync(fileURLToPath(new URL('../../routes/app/+layout.svelte', import.meta.url)), 'utf8')
const detail = readFileSync(fileURLToPath(new URL('../components/detail/AnimeDetail.svelte', import.meta.url)), 'utf8')
const catalogDetail = readFileSync(fileURLToPath(new URL('../components/catalog/CatalogMediaDetail.svelte', import.meta.url)), 'utf8')
const play = readFileSync(fileURLToPath(new URL('../stremio/play.ts', import.meta.url)), 'utf8')

describe('live TV playback handoff', () => {
  it('resolves in an isolated hidden session without navigating the linked device', () => {
    expect(layout).toContain('headless: true')
    expect(layout).toContain('pickerStore: companionStreamPicker')
    expect(layout).toContain('resolveSession: companionResolveSession')
    expect(layout).toContain('forceAuto: !manual')
    expect(play).toContain('if (options.companion && hasPendingCompanionPlayback(media, episode))')
    expect(layout).not.toContain('goto(acceptCompanionPlayRequest')
  })

  it('does not let a coincidentally open detail page consume a headless request', () => {
    expect(detail).toContain('pending.headless')
    expect(catalogDetail).toContain('pending.headless')
  })
})
