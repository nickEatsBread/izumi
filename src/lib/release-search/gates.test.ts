import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { get } from 'svelte/store'
import { describe, expect, it } from 'vitest'
import type { Media } from '$lib/anilist/types'
import { durableHistory, recordPlay } from '$lib/player/history'
import { releaseMedia } from './release-media'

const read = (relative: string) => readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8').replace(/\r\n/g, '\n')
const body = (source: string, signature: string) => source.split(signature)[1].split('\nexport ')[0]

describe('search box releases stay out of history and trackers', () => {
  it('never records a release in watch history, while a title still is', () => {
    const release = releaseMedia({ infoHash: 'ab'.repeat(20), title: 'Quiet Harbor 05' })
    recordPlay(release, 1)
    expect(get(durableHistory)[release.id]).toBeUndefined()
    const title = { id: 424242, title: { romaji: 'Example' }, episodes: 12 } as Media
    recordPlay(title, 1)
    expect(get(durableHistory)[title.id]).toBeDefined()
  })

  it('never syncs a release to a tracker', () => {
    expect(body(read('../trackers/index.ts'), 'export function markWatched(')).toContain('if (media.release) return 0')
  })
})
