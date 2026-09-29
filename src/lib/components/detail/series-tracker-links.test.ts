import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

// The series page's `media` is a new object each time its detail query delivers the same series again:
// the first revalidation of a cached page, each wave of the season picker's chain walk
// (`detail.episodes.seasons`), a tracker read-back. The Kitsu lookup's effect read `media` itself, so every
// delivery cleared the Kitsu id until AniZip's IndexedDB cache answered. The tracker buttons are keyed by
// tracker, so the Kitsu button left the page and came back, and a d-pad focus resting on it fell to <body>.
// The lookup follows the title's ids instead.

const detail = readFileSync(fileURLToPath(new URL('./AnimeDetail.svelte', import.meta.url)), 'utf8')
const block = detail.slice(detail.indexOf('// AniList does not expose Kitsu IDs.'), detail.indexOf('const externalTrackerLinks = $derived.by('))
const code = (text: string) => text.replace(/\/\/.*$/gm, '')
// The ids the lookup follows, then the lookup itself.
const [ids = '', lookup = ''] = code(block).split('$effect(() => {')

describe('the Kitsu link across deliveries of the same series', () => {
  it('looks the Kitsu id up per title id, not per media object', () => {
    expect(ids).toContain('const mediaKitsuId = $derived(media ? kitsuIdOf(media) : undefined)')
    expect(ids).toContain('const mediaAnilistId = $derived(media ? anilistIdOf(media) : undefined)')
    // The effect sees the page's media only through those two ids.
    expect(lookup).not.toMatch(/\bmedia\b/)
  })

  it('still resolves a new title from its own record, else by a fresh AniZip lookup', () => {
    expect(lookup).toContain('const direct = mediaKitsuId')
    expect(lookup).toContain('if (direct) { externalKitsuId = direct; return }')
    expect(lookup).toContain('const requestedId = mediaAnilistId')
    expect(lookup).toContain('externalKitsuId = undefined')
    expect(lookup).toContain('void getKitsuId(requestedId).then(')
  })

  it('ignores an answer for a title the page has since left', () => {
    expect(lookup).toContain('if (!cancelled && mediaAnilistId === requestedId) externalKitsuId = value')
  })
})
