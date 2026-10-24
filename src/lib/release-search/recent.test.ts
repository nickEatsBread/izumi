import { get } from 'svelte/store'
import { beforeEach, describe, expect, it } from 'vitest'
import { enterIncognito, exitIncognito } from '$lib/stores/incognito'
import { RECENT_RELEASE_LIMIT, forgetRelease, recentReleases, rememberRelease } from './recent'

const entry = (n: number) => ({ mediaId: -n, episode: 1, title: `Release ${n}`, stream: { infoHash: String(n).padStart(40, '0'), __logo: 'data:image/png;base64,AAAA' } })

describe('recent releases', () => {
  beforeEach(() => { exitIncognito(); recentReleases.set([]) })

  it('keeps the newest first, once per release, capped', () => {
    for (let n = 1; n <= RECENT_RELEASE_LIMIT + 3; n++) rememberRelease(entry(n))
    rememberRelease(entry(5))
    const list = get(recentReleases)
    expect(list).toHaveLength(RECENT_RELEASE_LIMIT)
    expect(list[0].mediaId).toBe(-5)
    expect(list.filter((item) => item.mediaId === -5)).toHaveLength(1)
  })

  it('drops the source icon so the list stays small', () => {
    rememberRelease(entry(1))
    expect(get(recentReleases)[0].stream.__logo).toBeUndefined()
  })

  it('writes nothing in incognito', () => {
    enterIncognito()
    rememberRelease(entry(1))
    expect(get(recentReleases)).toEqual([])
  })

  it('forgets one release', () => {
    rememberRelease(entry(1))
    rememberRelease(entry(2))
    forgetRelease(-1)
    expect(get(recentReleases).map((item) => item.mediaId)).toEqual([-2])
  })
})
