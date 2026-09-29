import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

// The series page hands the episode list a new `media` object each time its detail query delivers the
// same series again: the first revalidation of a cached page, each wave of the season picker's chain
// walk (`detail.episodes.seasons`), a tracker read-back. The metadata effect read `media` itself, so each
// delivery put the list back to skeletons until AniZip's cache answered, which re-mounted every
// EpisodeCard and faded every thumbnail in again. The effect follows the series and its provider's
// episode data instead (`animeEpisodeMetadataKey`, covered in anime-detail.test.ts).

const list = readFileSync(fileURLToPath(new URL('./EpisodeList.svelte', import.meta.url)), 'utf8')
const block = list.slice(list.indexOf('const metaSource = '), list.indexOf('// Only show per-episode thumbnails'))
const code = (text: string) => text.replace(/\/\/.*$/gm, '')
// The effect that follows the series, up to the nested load; then the load itself.
const [, series = '', load = ''] = code(block).split('$effect(() => {')

describe('episode metadata across deliveries of the same series', () => {
  it('loads per series and provider episode data, not per media object', () => {
    expect(block).toContain('const metaSource = $derived(animeEpisodeMetadataKey(media))')
    expect(series).toContain('void metaSource')
    expect(series).toContain('const current = untrack(() => media)')
    // The effects see the page's media only through the key and that one untracked read.
    expect(`${series}${load}`.replace('untrack(() => media)', '')).not.toMatch(/\bmedia\b/)
  })

  it('still starts a new series from its provider data, with skeletons until AniZip answers', () => {
    expect(series).toContain('meta = supplied')
    expect(series).toContain('if (offline || canonical == null) { metaLoading = false; return }')
    expect(series).toContain('metaLoading = !current.videos?.length')
  })

  it('asks AniZip again as progress rises, into the list as it stands', () => {
    // getEpisodeMeta refetches titles missing for watched episodes. Only the nested load reads progress,
    // so a finished episode or a tracker read-back never brings the skeletons back.
    expect(series).not.toContain('watchedThrough')
    expect(load).toContain('getEpisodeMeta(canonical, watchedThrough, applyMeta).then(applyMeta)')
    expect(load).not.toContain('meta = supplied')
    expect(load).not.toMatch(/metaLoading = (?!false)/)
  })
})
