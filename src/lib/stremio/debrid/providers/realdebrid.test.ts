import { beforeEach, describe, it, expect, vi } from 'vitest'

const { httpFetch } = vi.hoisted(() => ({ httpFetch: vi.fn() }))
vi.mock('@tauri-apps/plugin-http', () => ({ fetch: httpFetch }))

import { serveJson, called, urlsOf } from '../../../../test/debrid-http'
import { rdStatus, rdListItem, rdFile, rdSelectFileIds, rdLinkFor, rdShouldRetrySingleFile, rdPickBestDownloaded, rdMatchesSingleFile, rdOwnedHashes, rdForgetLists, realdebrid } from './realdebrid'

const HASH = '8'.repeat(40)

describe('rdStatus', () => {
  it('maps a finished torrent to ready', () => {
    expect(rdStatus({ status: 'downloaded', progress: 100 })).toEqual({ stage: 'ready', progress: 100, raw: 'downloaded' })
  })
  it('maps an error status', () => {
    expect(rdStatus({ status: 'virus' }).stage).toBe('error')
  })
  it('maps downloading with seeders + speed', () => {
    const r = rdStatus({ status: 'downloading', progress: 42, seeders: 30, speed: 1048576, bytes: 2000 })
    expect(r).toEqual({ stage: 'downloading', progress: 42, seeders: 30, speed: 1048576, total: 2000, raw: 'downloading' })
  })
  it('maps queued/waiting states', () => {
    expect(rdStatus({ status: 'queued' }).stage).toBe('queued')
    expect(rdStatus({ status: 'waiting_files_selection' }).stage).toBe('queued')
  })
})

describe('rdListItem', () => {
  it('maps a downloaded torrent to a ready DebridItem', () => {
    const it_ = rdListItem({ id: 'AB', filename: 'Show S01', hash: 'DEAD', bytes: 100, progress: 100, status: 'downloaded', added: '2026-07-01T00:00:00.000Z' })
    expect(it_).toMatchObject({ id: 'AB', name: 'Show S01', size: 100, status: 'ready', hash: 'dead' })
    expect(it_.addedAt).toBe(Date.parse('2026-07-01T00:00:00.000Z'))
  })
  it('maps a downloading torrent', () => {
    expect(rdListItem({ id: 'X', filename: 'f', hash: 'H', bytes: 1, progress: 40, status: 'downloading' }).status).toBe('downloading')
  })
})

describe('rdFile', () => {
  it('takes the basename and flags a video as playable', () => {
    expect(rdFile({ id: 3, path: '/Season 1/ep01.mkv', bytes: 50 })).toEqual({ id: '3', name: 'ep01.mkv', size: 50, playable: true })
  })
  it('flags a non-video / sample as not playable', () => {
    expect(rdFile({ id: 4, path: 'sample.mkv', bytes: 1 }).playable).toBe(false)
    expect(rdFile({ id: 5, path: 'readme.txt', bytes: 1 }).playable).toBe(false)
  })
})

const MB = 1024 * 1024

describe('rdSelectFileIds', () => {
  it('selects only the video ids so RD is not asked to pack the torrent', () => {
    const files = [
      { id: 1, path: 'ENG/Show_01_[rerip][85EDD0D6].eng_HH.ass', bytes: 9_657 },
      { id: 2, path: 'CHI/Show_01_[rerip][85EDD0D6].chi_Maho.sub.ass', bytes: 13_632 },
      { id: 3, path: 'Show_01_[rerip][85EDD0D6].mkv', bytes: 116 * MB },
      { id: 4, path: 'Show_02_[rerip][0460306D].mkv', bytes: 142 * MB },
    ]
    expect(rdSelectFileIds(files)).toBe('3,4')
  })

  it('drops samples and extras', () => {
    const files = [
      { id: 1, path: 'sample.mkv', bytes: 20 * MB },
      { id: 2, path: 'Show_01.mkv', bytes: 100 * MB },
    ]
    expect(rdSelectFileIds(files)).toBe('2')
  })

  it('drops videos under the 5 MB floor', () => {
    const files = [
      { id: 1, path: 'trailerclip.mkv', bytes: 2 * MB },
      { id: 2, path: 'Show_01.mkv', bytes: 100 * MB },
    ]
    expect(rdSelectFileIds(files)).toBe('2')
  })

  it('does not bulk-select sidecars when every video is junk or undersized', () => {
    const files = [
      { id: 1, path: 'sample.mkv', bytes: 20 * MB },
      { id: 2, path: 'Show_01.mkv', bytes: 2 * MB },
      { id: 3, path: 'ENG/Show_01.eng.ass', bytes: 10 * 1024 },
    ]
    expect(rdSelectFileIds(files)).toBe('2')
  })

  it('selects every file when the torrent carries no usable video', () => {
    const files = [
      { id: 7, path: 'readme.txt', bytes: 10 },
      { id: 8, path: 'cover.jpg', bytes: 20 },
    ]
    expect(rdSelectFileIds(files)).toBe('7,8')
  })

  it('falls back to the all keyword when there is nothing to name', () => {
    expect(rdSelectFileIds([])).toBe('all')
  })
})

describe('rdLinkFor', () => {
  it('returns the positionally matching link when counts agree', () => {
    const links = ['https://real-debrid.com/d/AAA', 'https://real-debrid.com/d/BBB']
    expect(rdLinkFor(2, 1, links)).toBe('https://real-debrid.com/d/BBB')
  })

  it('returns the only link for a single-file selection', () => {
    expect(rdLinkFor(1, 0, ['https://real-debrid.com/d/ONE'])).toBe('https://real-debrid.com/d/ONE')
  })

  it('refuses to guess when RD packed many files into one link', () => {
    // The reported bug: 7 files selected, RD returned a single archive link.
    expect(rdLinkFor(7, 6, ['https://real-debrid.com/d/PACKED'])).toBeUndefined()
  })

  it('refuses when the chosen file was not in the selection', () => {
    expect(rdLinkFor(2, -1, ['a', 'b'])).toBeUndefined()
  })

  it('refuses when there are no links at all', () => {
    expect(rdLinkFor(1, 0, [])).toBeUndefined()
  })

  it('refuses when selectedCount is zero or negative', () => {
    expect(rdLinkFor(0, 0, [])).toBeUndefined()
  })

  it('refuses when the index is beyond links.length even though counts agree', () => {
    expect(rdLinkFor(3, 5, ['a', 'b', 'c'])).toBeUndefined()
  })
})

describe('rdShouldRetrySingleFile', () => {
  it('retries when there is no usable link at all', () => {
    expect(rdShouldRetrySingleFile(undefined, 7, false)).toBe(true)
  })

  it('retries when RD packed more than one selected file into an archive', () => {
    expect(rdShouldRetrySingleFile({ download: 'https://real-debrid.com/d/PACKED', filename: 'Show.rar' }, 7, false)).toBe(true)
  })

  it('does not retry an archive that was already a single-file selection — a retry would just reproduce it', () => {
    expect(rdShouldRetrySingleFile({ download: 'https://real-debrid.com/d/ONE', filename: 'Show.rar' }, 1, false)).toBe(false)
  })

  it('does not retry a clean video link', () => {
    expect(rdShouldRetrySingleFile({ download: 'https://real-debrid.com/d/VID', filename: 'Show_01.mkv' }, 7, false)).toBe(false)
  })

  it('never retries for a noAdd (background prefetch) caller, in every other case', () => {
    expect(rdShouldRetrySingleFile(undefined, 7, true)).toBe(false)
    expect(rdShouldRetrySingleFile({ download: 'https://real-debrid.com/d/PACKED', filename: 'Show.rar' }, 7, true)).toBe(false)
    expect(rdShouldRetrySingleFile({ download: 'https://real-debrid.com/d/VID', filename: 'Show_01.mkv' }, 1, true)).toBe(false)
  })

  it('falls back to the download URL when filename is an empty string', () => {
    expect(rdShouldRetrySingleFile({ download: 'https://real-debrid.com/d/PACKED.rar', filename: '' }, 7, false)).toBe(true)
  })
})

describe('rdPickBestDownloaded', () => {
  it('picks the fullest entry, not the newest (first in newest-first list order)', () => {
    const entries = [
      { id: 'newest-single-file', hash: 'h', status: 'downloaded', bytes: 100 },
      { id: 'older-all-files', hash: 'h', status: 'downloaded', bytes: 900 },
    ]
    expect(rdPickBestDownloaded(entries, 'h')).toEqual({ id: 'older-all-files', bytes: 900 })
  })

  it('ignores entries that are not downloaded', () => {
    const entries = [
      { id: 'still-downloading', hash: 'h', status: 'downloading', bytes: 900 },
      { id: 'ready', hash: 'h', status: 'downloaded', bytes: 100 },
    ]
    expect(rdPickBestDownloaded(entries, 'h')).toEqual({ id: 'ready', bytes: 100 })
  })

  it('ignores entries whose hash does not match', () => {
    const entries = [
      { id: 'other-release', hash: 'other', status: 'downloaded', bytes: 900 },
      { id: 'wanted', hash: 'h', status: 'downloaded', bytes: 100 },
    ]
    expect(rdPickBestDownloaded(entries, 'h')).toEqual({ id: 'wanted', bytes: 100 })
  })

  it('treats a missing bytes field as 0 rather than throwing', () => {
    const entries = [
      { id: 'no-bytes', hash: 'h', status: 'downloaded' },
      { id: 'has-bytes', hash: 'h', status: 'downloaded', bytes: 1 },
    ]
    expect(rdPickBestDownloaded(entries, 'h')).toEqual({ id: 'has-bytes', bytes: 1 })
  })
})

describe('rdMatchesSingleFile', () => {
  it('matches when exactly one file is selected and it is the wanted id', () => {
    expect(rdMatchesSingleFile([{ id: 3, selected: 1 }, { id: 4, selected: 0 }], 3)).toBe(true)
  })

  it('does not match when the one selected file has a different id', () => {
    expect(rdMatchesSingleFile([{ id: 3, selected: 1 }, { id: 4, selected: 0 }], 4)).toBe(false)
  })

  it('does not match when more than one file is selected', () => {
    expect(rdMatchesSingleFile([{ id: 3, selected: 1 }, { id: 4, selected: 1 }], 3)).toBe(false)
  })

  it('does not match when nothing is selected', () => {
    expect(rdMatchesSingleFile([{ id: 3, selected: 0 }, { id: 4, selected: 0 }], 3)).toBe(false)
  })
})

// The reference implementation of the noAdd contract every other provider now mirrors:
// reuse an entry the account already holds, otherwise bail rather than add.
describe('realdebrid.resolveHash noAdd', () => {
  // The account-list scan is cached per key across resolves, so each case starts from cold.
  beforeEach(() => { httpFetch.mockReset(); rdForgetLists() })

  it('never adds the magnet when the hash is not already on the account', async () => {
    serveJson(httpFetch, [['/torrents?limit=', []]])
    await expect(realdebrid.resolveHash('key', HASH, { noAdd: true })).rejects.toThrow(/background prefetch/)
    expect(called(httpFetch, '/torrents/addMagnet')).toBe(false)
  })

  it('never adds the magnet when the account list itself fails', async () => {
    serveJson(httpFetch, [])
    await expect(realdebrid.resolveHash('key', HASH, { noAdd: true })).rejects.toThrow(/background prefetch/)
    expect(called(httpFetch, '/torrents/addMagnet')).toBe(false)
  })

  it('reuses a downloaded torrent already on the account', async () => {
    serveJson(httpFetch, [
      ['/torrents?limit=', [{ id: 'T1', hash: HASH.toUpperCase(), status: 'downloaded', bytes: 100 }]],
      ['/torrents/info/T1', { id: 'T1', status: 'downloaded', files: [{ id: 1, path: 'Show_01.mkv', bytes: 100, selected: 1 }], links: ['https://real-debrid.com/d/AAA'] }],
      ['/unrestrict/link', { download: 'https://cdn.real-debrid/Show_01.mkv', filename: 'Show_01.mkv', filesize: 100 }],
    ])
    await expect(realdebrid.resolveHash('key', HASH, { noAdd: true })).resolves.toBe('https://cdn.real-debrid/Show_01.mkv')
    expect(called(httpFetch, '/torrents/addMagnet')).toBe(false)
  })
})

describe('real-debrid account list caching', () => {
  beforeEach(() => { httpFetch.mockReset(); rdForgetLists() })

  it('scans the account list once for several hashes in a row', async () => {
    const other = 'b'.repeat(40)
    serveJson(httpFetch, [
      ['/torrents?limit', [
        { id: '1', hash: HASH, status: 'downloaded', bytes: 500 },
        { id: '2', hash: other, status: 'downloaded', bytes: 500 },
      ]],
      ['/torrents/info/', { status: 'downloaded', files: [{ id: 1, path: '/Show_01.mkv', bytes: 500, selected: 1 }], links: ['LINK'] }],
      ['/unrestrict/link', { download: 'https://cdn.rd/Show_01.mkv', filename: 'Show_01.mkv', filesize: 500 }],
    ])

    await realdebrid.resolveHash('key', HASH)
    const afterFirst = urlsOf(httpFetch).filter((u) => u.includes('/torrents?limit')).length
    await realdebrid.resolveHash('key', other)
    const afterSecond = urlsOf(httpFetch).filter((u) => u.includes('/torrents?limit')).length

    expect(afterFirst).toBe(1)
    expect(afterSecond).toBe(1)
  })

  it('keeps the cached scan when a torrent is ADDED, so a binge pays for it once', async () => {
    // Adding is the operation that most often immediately precedes the next episode's resolve.
    // Clearing the cache here meant every episode re-paid the full account scan the cache exists
    // to avoid. The new entry is recorded instead; only a REMOVAL invalidates.
    const other = 'c'.repeat(40)
    serveJson(httpFetch, [
      ['/torrents?limit', []],
      ['/torrents/addMagnet', { id: '9' }],
      ['/torrents/selectFiles/', {}],
      ['/torrents/info/', { status: 'downloaded', files: [{ id: 1, path: '/Show_01.mkv', bytes: 500, selected: 1 }], links: ['LINK'] }],
      ['/unrestrict/link', { download: 'https://cdn.rd/Show_01.mkv', filename: 'Show_01.mkv', filesize: 500 }],
    ])

    await realdebrid.resolveHash('key', HASH)
    await realdebrid.resolveHash('key', other)

    expect(urlsOf(httpFetch).filter((u) => u.includes('/torrents?limit')).length).toBe(1)
  })
})

describe('real-debrid round trips on a first play', () => {
  beforeEach(() => { httpFetch.mockReset(); rdForgetLists() })

  it('costs exactly two info reads on a cached first play', async () => {
    // Pre-selection read, then the post-selection read that finds it already downloaded. The
    // `stage !== 'ready'` guard means poll is never entered on this path, so its first probe adds
    // no third read — this pins that, since removing the guard would be an invisible regression.
    let infoCalls = 0
    httpFetch.mockImplementation(async (url: string) => {
      const u = String(url)
      const json = (v: unknown) => ({ ok: true, status: 200, text: async () => JSON.stringify(v) })
      if (u.includes('/torrents?limit')) return json([])
      if (u.includes('/torrents/addMagnet')) return json({ id: '9' })
      if (u.includes('/torrents/selectFiles/')) return json({})
      if (u.includes('/torrents/info/')) {
        infoCalls++
        // First read is pre-selection; everything after it is the finished torrent.
        return json(infoCalls === 1
          ? { status: 'waiting_files_selection', files: [{ id: 1, path: '/Show_01.mkv', bytes: 500, selected: 0 }], links: [] }
          : { status: 'downloaded', files: [{ id: 1, path: '/Show_01.mkv', bytes: 500, selected: 1 }], links: ['LINK'] })
      }
      if (u.includes('/unrestrict/link')) return json({ download: 'https://cdn.rd/Show_01.mkv', filename: 'Show_01.mkv', filesize: 500 })
      return { ok: false, status: 404, text: async () => '{}' }
    })

    await expect(realdebrid.resolveHash('key', HASH)).resolves.toBe('https://cdn.rd/Show_01.mkv')
    expect(infoCalls).toBe(2)
  })
})

describe('real-debrid magnet conversion window', () => {
  beforeEach(() => { httpFetch.mockReset(); rdForgetLists() })

  it('waits for the file list before selecting, instead of 404ing', async () => {
    // Reported: POST /torrents/selectFiles/<id> -> 404. addMagnet returns at once, but the very
    // next /torrents/info can still be in magnet_conversion with NO files, and selecting when
    // there is nothing to select is a 404 that killed the whole resolve.
    let infoCalls = 0
    const order: string[] = []
    httpFetch.mockImplementation(async (url: string) => {
      const u = String(url)
      const json = (v: unknown) => ({ ok: true, status: 200, text: async () => JSON.stringify(v) })
      if (u.includes('/torrents?limit')) return json([])
      if (u.includes('/torrents/addMagnet')) { order.push('add'); return json({ id: '9' }) }
      if (u.includes('/torrents/selectFiles/')) {
        order.push('select')
        return json({})
      }
      if (u.includes('/torrents/info/')) {
        infoCalls++
        order.push('info:' + infoCalls)
        return json(infoCalls === 1
          ? { status: 'magnet_conversion', files: [], links: [] }
          : { status: 'downloaded', files: [{ id: 1, path: '/Show_01.mkv', bytes: 500, selected: 1 }], links: ['LINK'] })
      }
      if (u.includes('/unrestrict/link')) return json({ download: 'https://cdn.rd/Show_01.mkv', filename: 'Show_01.mkv', filesize: 500 })
      return { ok: false, status: 404, text: async () => '{}' }
    })

    await expect(realdebrid.resolveHash('key', HASH)).resolves.toBe('https://cdn.rd/Show_01.mkv')
    // Must never select while the file list is still empty: the first info returned no files, so
    // any select has to come after a LATER info.
    const firstSelect = order.indexOf('select')
    if (firstSelect >= 0) expect(order.slice(0, firstSelect)).toContain('info:2')
  })
})

describe('rdOwnedHashes', () => {
  const asked = ['aaa', 'bbb', 'ccc']

  it('marks only DOWNLOADED entries as cached', () => {
    const m = rdOwnedHashes([
      { id: '1', hash: 'AAA', status: 'downloaded' },
      { id: '2', hash: 'bbb', status: 'downloading' },
    ], asked)
    expect(m.get('aaa')).toBe('cached')
    expect(m.has('bbb')).toBe(false)
  })
  it('NEVER emits uncached — absence means unknown, not "not cached"', () => {
    const m = rdOwnedHashes([{ id: '1', hash: 'aaa', status: 'downloaded' }], asked)
    expect([...m.values()].every((v) => v === 'cached')).toBe(true)
    expect(m.has('ccc')).toBe(false)
  })
  it('ignores account entries that were not asked about', () => {
    expect(rdOwnedHashes([{ id: '9', hash: 'zzz', status: 'downloaded' }], asked).size).toBe(0)
  })
  it('tolerates a non-array payload', () => {
    expect(rdOwnedHashes(null as never, asked).size).toBe(0)
  })
})
