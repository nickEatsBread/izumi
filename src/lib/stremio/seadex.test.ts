import { beforeEach, describe, it, expect, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  set: vi.fn(),
  phttp: vi.fn(),
}))

vi.mock('idb-keyval', () => ({ get: mocks.get, set: mocks.set }))
vi.mock('$lib/net/http', () => ({ phttp: mocks.phttp }))

import { bestHashes, getSeadexEntry, knownBestHashes, matchSeadexStreams, normalizeEntry } from './seadex'
import type { Stream } from './parse'

// Shaped from a live response: one public-tracker recommendation, one private-tracker row whose
// hash is withheld, and one public alternate the curators did NOT rate best.
const RECORD = {
  alID: 21519,
  comparison: 'https://slow.pics/c/Ff4SsSiB?image-position=top+left,https://slow.pics/c/WsGGSNwX',
  incomplete: false,
  notes: 'MegaMTBB is a colour-corrected DCP encode\nBlackRose is the same with dub',
  theoreticalBest: '4K JPN BD+?',
  expand: {
    trs: [
      { infoHash: '136456729270DCF8DE3A8FB0300F51453109DF98', url: 'https://nyaa.si/view/2074725', tracker: 'Nyaa', releaseGroup: 'MegaMTBB', dualAudio: false, isBest: true },
      { infoHash: '<redacted>', url: '/torrents.php?id=34776&torrentid=1211215', tracker: 'AB', releaseGroup: 'MegaMTBB', dualAudio: false, isBest: true },
      { infoHash: 'd71d2bae8fbc1e37113f81530105ce334a749f6a', url: 'https://nyaa.si/view/2095768', tracker: 'Nyaa', releaseGroup: 'BlackRose', dualAudio: true, isBest: false },
    ],
  },
}
const RESPONSE = { page: 1, perPage: 30, totalItems: 1, totalPages: 1, items: [RECORD] }
const EMPTY = { page: 1, perPage: 30, totalItems: 0, totalPages: 0, items: [] }

const entry = () => normalizeEntry(RECORD)!

describe('normalizeEntry', () => {
  it('reads the entry fields', () => {
    const e = entry()
    expect(e.anilistId).toBe(21519)
    expect(e.theoreticalBest).toBe('4K JPN BD+?')
    expect(e.incomplete).toBe(false)
    expect(e.notes).toContain('DCP encode')
  })

  it('splits the comma-joined comparison string, keeping per-link query strings', () => {
    expect(entry().comparisons).toEqual([
      'https://slow.pics/c/Ff4SsSiB?image-position=top+left',
      'https://slow.pics/c/WsGGSNwX',
    ])
  })

  it('lowercases hashes and blanks the withheld one', () => {
    expect(entry().releases.map((r) => r.infoHash)).toEqual([
      '136456729270dcf8de3a8fb0300f51453109df98',
      '',
      'd71d2bae8fbc1e37113f81530105ce334a749f6a',
    ])
  })

  it('rejects a record with no usable AniList id', () => {
    expect(normalizeEntry({ ...RECORD, alID: 0 })).toBeUndefined()
    expect(normalizeEntry({ ...RECORD, alID: 'nope' })).toBeUndefined()
    expect(normalizeEntry(null)).toBeUndefined()
    expect(normalizeEntry('not an object')).toBeUndefined()
  })

  it('tolerates missing and wrong-typed fields', () => {
    const e = normalizeEntry({ alID: 5, notes: 42, comparison: null, expand: { trs: 'nope' } })!
    expect(e).toMatchObject({ notes: '', comparisons: [], incomplete: false, theoreticalBest: '', releases: [] })
  })

  it('tolerates junk inside the torrent list', () => {
    const e = normalizeEntry({ alID: 5, expand: { trs: [null, { infoHash: 123 }, {}] } })!
    expect(e.releases).toHaveLength(3)
    expect(e.releases.every((r) => r.infoHash === '' && !r.isBest)).toBe(true)
  })
})

describe('bestHashes', () => {
  it('keeps only recommended, matchable hashes', () => {
    expect([...bestHashes(entry())]).toEqual(['136456729270dcf8de3a8fb0300f51453109df98'])
  })
  it('is empty for a missing entry', () => {
    expect(bestHashes(null).size).toBe(0)
    expect(bestHashes(undefined).size).toBe(0)
  })

  it('contributes no ranking effect when the recommendation is incomplete', () => {
    // The pack is missing episodes, so promoting it for one it does not contain leaves the debrid
    // file selector with no matching file — and that falls back to the largest video, silently
    // playing a different episode. The entry still badges and still says "Incomplete" in the notes
    // strip; it just stops steering the pick.
    const incomplete = normalizeEntry({ ...RECORD, incomplete: true })!
    expect(incomplete.incomplete).toBe(true)
    expect(bestHashes(incomplete).size).toBe(0)
    expect(matchSeadexStreams(incomplete, [{ infoHash: '136456729270DCF8DE3A8FB0300F51453109DF98', name: 'row' }]))
      .toHaveLength(1)
  })
})

describe('knownBestHashes', () => {
  beforeEach(() => {
    mocks.get.mockReset()
    mocks.set.mockReset()
    mocks.phttp.mockReset()
    vi.useRealTimers()
  })

  it('is empty for a title nothing has looked up yet', () => {
    // The automatic paths rank inside a synchronous settings snapshot and cannot await a lookup, so
    // a cold title ranks exactly the way an uncurated one does rather than blocking on the network.
    expect(knownBestHashes(4_040_404).size).toBe(0)
    expect(knownBestHashes(undefined).size).toBe(0)
    expect(knownBestHashes(0).size).toBe(0)
  })

  it('answers synchronously once any lookup for that title has landed', () => {
    mocks.get.mockResolvedValue(undefined)
    mocks.phttp.mockResolvedValue({ ok: true, json: async () => RESPONSE })

    return getSeadexEntry(21519).then(() => {
      expect([...knownBestHashes(21519)]).toEqual(['136456729270dcf8de3a8fb0300f51453109df98'])
    })
  })

  it('stays empty for an incomplete entry, like the ranking set it mirrors', () => {
    mocks.get.mockResolvedValue(undefined)
    mocks.phttp.mockResolvedValue({ ok: true, json: async () => ({ items: [{ ...RECORD, alID: 21_777, incomplete: true }] }) })

    return getSeadexEntry(21_777).then(() => expect(knownBestHashes(21_777).size).toBe(0))
  })
})

describe('matchSeadexStreams', () => {
  const stream = (infoHash?: string, name = 'row'): Stream => ({ infoHash, name })

  it('matches on infoHash regardless of case', () => {
    const upper = stream('136456729270DCF8DE3A8FB0300F51453109DF98')
    const matches = matchSeadexStreams(entry(), [upper])
    expect(matches).toHaveLength(1)
    expect(matches[0].stream).toBe(upper)
    expect(matches[0].release.isBest).toBe(true)
    expect(matches[0].release.releaseGroup).toBe('MegaMTBB')
  })

  it('reports a curated alternate as not-best rather than dropping it', () => {
    const matches = matchSeadexStreams(entry(), [stream('D71D2BAE8FBC1E37113F81530105CE334A749F6A')])
    expect(matches).toHaveLength(1)
    expect(matches[0].release.isBest).toBe(false)
    expect(matches[0].release.dualAudio).toBe(true)
  })

  it('never matches a stream against a withheld hash', () => {
    // The placeholder is what a private-tracker row carries; a stream that literally repeats it,
    // or carries an empty hash, must not be presented as the curated release.
    expect(matchSeadexStreams(entry(), [stream('<redacted>'), stream(''), stream(undefined)])).toEqual([])
  })

  it('ignores streams the entry does not list', () => {
    expect(matchSeadexStreams(entry(), [stream('a'.repeat(40))])).toEqual([])
  })

  it('prefers the recommendation when the same hash is listed twice', () => {
    const dup = normalizeEntry({
      alID: 1,
      expand: {
        trs: [
          { infoHash: 'b'.repeat(40), tracker: 'Nyaa', isBest: false },
          { infoHash: 'B'.repeat(40), tracker: 'AB', isBest: true },
        ],
      },
    })
    expect(matchSeadexStreams(dup, [stream('b'.repeat(40))])[0].release.isBest).toBe(true)
  })

  it('returns nothing for a missing entry or an empty list', () => {
    expect(matchSeadexStreams(null, [stream('b'.repeat(40))])).toEqual([])
    expect(matchSeadexStreams(entry(), [])).toEqual([])
  })
})

describe('getSeadexEntry', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    mocks.get.mockReset()
    mocks.set.mockReset()
    mocks.phttp.mockReset()
    vi.useRealTimers()
  })

  it('fetches, normalizes and caches on a cold cache', async () => {
    mocks.get.mockResolvedValue(undefined)
    mocks.phttp.mockResolvedValue({ ok: true, json: async () => RESPONSE })

    await expect(getSeadexEntry(21519)).resolves.toMatchObject({ anilistId: 21519 })
    expect(mocks.phttp).toHaveBeenCalledOnce()
    const url = mocks.phttp.mock.calls[0][0] as string
    expect(url).toContain('alID%3D21519')
    // The default response embeds every file name; the trimmed field list is the whole point.
    expect(url).toContain('fields=')
    expect(url).not.toContain('files')
    expect(mocks.set).toHaveBeenCalledTimes(2)
  })

  it('serves a cached entry inside the TTL without asking again', async () => {
    const now = 1_700_000_000_000
    vi.useFakeTimers()
    vi.setSystemTime(now)
    mocks.get
      .mockResolvedValueOnce(entry())
      .mockResolvedValueOnce(now - 6 * 864e5)

    await expect(getSeadexEntry(21519)).resolves.toMatchObject({ anilistId: 21519 })
    expect(mocks.phttp).not.toHaveBeenCalled()
  })

  it('refetches once the cached entry is older than a week', async () => {
    const now = 1_700_000_000_000
    vi.useFakeTimers()
    vi.setSystemTime(now)
    mocks.get
      .mockResolvedValueOnce(entry())
      .mockResolvedValueOnce(now - 8 * 864e5)
    mocks.phttp.mockResolvedValue({ ok: true, json: async () => RESPONSE })

    await expect(getSeadexEntry(21519)).resolves.toMatchObject({ anilistId: 21519 })
    expect(mocks.phttp).toHaveBeenCalledOnce()
  })

  it('caches a confirmed absence, so uncurated titles cost one request', async () => {
    mocks.get.mockResolvedValue(undefined)
    mocks.phttp.mockResolvedValue({ ok: true, json: async () => EMPTY })

    await expect(getSeadexEntry(999_999)).resolves.toBeNull()
    expect(mocks.set).toHaveBeenCalledWith('seadex-entry-999999', null)
  })

  it('serves a cached null inside the TTL', async () => {
    const now = 1_700_000_000_000
    vi.useFakeTimers()
    vi.setSystemTime(now)
    mocks.get.mockResolvedValueOnce(null).mockResolvedValueOnce(now - 1000)

    await expect(getSeadexEntry(999_999)).resolves.toBeNull()
    expect(mocks.phttp).not.toHaveBeenCalled()
  })

  it('never caches a failed lookup', async () => {
    mocks.get.mockResolvedValue(undefined)
    mocks.phttp.mockRejectedValue(new Error('offline'))

    await expect(getSeadexEntry(21519)).resolves.toBeNull()
    expect(mocks.set).not.toHaveBeenCalled()
  })

  it('keeps a stale cached entry when the refetch fails', async () => {
    const now = 1_700_000_000_000
    vi.useFakeTimers()
    vi.setSystemTime(now)
    mocks.get.mockResolvedValueOnce(entry()).mockResolvedValueOnce(now - 30 * 864e5)
    mocks.phttp.mockResolvedValue({ ok: false, status: 503, json: async () => ({}) })

    await expect(getSeadexEntry(21519)).resolves.toMatchObject({ anilistId: 21519 })
    expect(mocks.set).not.toHaveBeenCalled()
  })

  it('survives a malformed body without throwing', async () => {
    mocks.get.mockResolvedValue(undefined)
    mocks.phttp.mockResolvedValue({ ok: true, json: async () => { throw new SyntaxError('not json') } })
    await expect(getSeadexEntry(21519)).resolves.toBeNull()

    mocks.phttp.mockResolvedValue({ ok: true, json: async () => ({ items: 'nope' }) })
    await expect(getSeadexEntry(21520)).resolves.toBeNull()

    mocks.phttp.mockResolvedValue({ ok: true, json: async () => null })
    await expect(getSeadexEntry(21521)).resolves.toBeNull()
  })

  it('coalesces concurrent callers for the same id into one request', async () => {
    mocks.get.mockResolvedValue(undefined)
    mocks.phttp.mockResolvedValue({ ok: true, json: async () => RESPONSE })

    const [a, b] = await Promise.all([getSeadexEntry(21522), getSeadexEntry(21522)])
    expect(mocks.phttp).toHaveBeenCalledOnce()
    expect(a).toBe(b)
  })

  it('asks for nothing without an id', async () => {
    await expect(getSeadexEntry(undefined)).resolves.toBeNull()
    await expect(getSeadexEntry(0)).resolves.toBeNull()
    expect(mocks.phttp).not.toHaveBeenCalled()
  })
})
