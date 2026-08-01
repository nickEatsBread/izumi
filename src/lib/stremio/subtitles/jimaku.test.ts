import { beforeEach, describe, it, expect, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ phttp: vi.fn() }))
vi.mock('$lib/net/http', () => ({ phttp: mocks.phttp }))

import { createJimaku, jimakuSearchParams, pickEpisodeFiles, type JimakuFile } from './jimaku'
import { jimakuApiKey } from '$lib/settings/ui'
import type { SubQuery } from './types'

const SERIES: SubQuery = { type: 'series', anilistId: 154587, season: 1, episode: 7, languages: ['ja'] }

/** Shorthand for the {name,url,size} rows /entries/{id}/files returns. */
const f = (name: string, size = 1000): JimakuFile => ({ name, url: `https://jimaku.cc/entry/9/download/${name}`, size })
const names = (m: ReturnType<typeof pickEpisodeFiles>) => m.map((x) => x.file.name)

describe('pickEpisodeFiles — exact episode forms', () => {
  it('matches a zero-padded fansub name ("Show - 07")', () => {
    const files = [f('[Group] Show - 06 [1080p].srt'), f('[Group] Show - 07 [1080p].srt')]
    expect(names(pickEpisodeFiles(files, 7))).toEqual(['[Group] Show - 07 [1080p].srt'])
  })
  it('matches an unpadded number ("Show - 7")', () => {
    expect(names(pickEpisodeFiles([f('Show - 7.ass')], 7))).toEqual(['Show - 7.ass'])
  })
  it('matches the E07 and Episode 07 word forms', () => {
    expect(names(pickEpisodeFiles([f('Show E07.srt')], 7))).toEqual(['Show E07.srt'])
    expect(names(pickEpisodeFiles([f('Show Episode 07.srt')], 7))).toEqual(['Show Episode 07.srt'])
  })
  it('matches S01E07 and the 1x07 form', () => {
    expect(names(pickEpisodeFiles([f('Show.S01E07.srt')], 7, 1))).toEqual(['Show.S01E07.srt'])
    expect(names(pickEpisodeFiles([f('Show 1x07.srt')], 7, 1))).toEqual(['Show 1x07.srt'])
  })
  it('reads a digits-only bracket group as the episode ("[Show][07]")', () => {
    const files = [f('[JPJ][Show][07](idx+sub).srt'), f('[JPJ][Show][08](idx+sub).srt')]
    expect(names(pickEpisodeFiles(files, 7))).toEqual(['[JPJ][Show][07](idx+sub).srt'])
  })
  it('reads a bracketed revision as its episode, not as an unknown batch', () => {
    // [07v2] survives the digits-only re-spelling, so without the vN branch it parses to nothing
    // and lands in `batch` — offered as a plausible carrier of episode 3.
    const files = [f('[Group][Show][07v2].ass')]
    expect(pickEpisodeFiles(files, 7).map((m) => m.kind)).toEqual(['exact'])
    expect(pickEpisodeFiles(files, 3)).toEqual([])
  })
  it('reads a bracketed span as a range, so it cannot answer an episode outside it', () => {
    const files = [f('[Group][Show][01-12][BD].zip')]
    expect(pickEpisodeFiles(files, 7).map((m) => m.kind)).toEqual(['range'])
    expect(pickEpisodeFiles(files, 20)).toEqual([])
  })
  it('does not read a bracketed CRC or resolution as an episode', () => {
    // [ABC1E404] would otherwise read as E404, and [1080] as episode 1080. The resolution file is
    // still offered — as an unparseable batch row, never as evidence of episode 1080.
    expect(pickEpisodeFiles([f('Show - 07 [1080p][ABC1E404].srt')], 7)[0].kind).toBe('exact')
    expect(pickEpisodeFiles([f('Show [1080].srt')], 1080)[0].kind).toBe('batch')
  })
})

describe('pickEpisodeFiles — never returns the wrong episode', () => {
  it('drops every other episode in the directory', () => {
    const files = [f('Show - 01.srt'), f('Show - 07.srt'), f('Show - 12.srt'), f('Show - 70.srt')]
    expect(names(pickEpisodeFiles(files, 7))).toEqual(['Show - 07.srt'])
  })
  it('returns nothing rather than a neighbour when the episode is absent', () => {
    expect(pickEpisodeFiles([f('Show - 06.srt'), f('Show - 08.srt')], 7)).toEqual([])
  })
  it('does not confuse 7 with 07.5 (a recap special)', () => {
    expect(names(pickEpisodeFiles([f('Show - 07.5.srt')], 7))).toEqual([])
  })
  it('disqualifies a file whose season contradicts the wanted one', () => {
    const files = [f('Show S01E07.srt'), f('Show S02E07.srt')]
    expect(names(pickEpisodeFiles(files, 7, 2))).toEqual(['Show S02E07.srt'])
  })
  it('keeps a seasonless name when a season is wanted (most files carry no season)', () => {
    expect(names(pickEpisodeFiles([f('Show - 07.srt')], 7, 2))).toEqual(['Show - 07.srt'])
  })
})

describe('pickEpisodeFiles — batches and ranges', () => {
  it('offers a range file that spans the episode, narrowest span first', () => {
    const files = [f('Show 01-24.zip'), f('Show 01-12.zip')]
    const out = pickEpisodeFiles(files, 7)
    expect(names(out)).toEqual(['Show 01-12.zip', 'Show 01-24.zip'])
    expect(out.every((m) => m.kind === 'range')).toBe(true)
  })
  it('drops a range that does not span the episode', () => {
    expect(pickEpisodeFiles([f('Show 13-24.zip')], 7)).toEqual([])
  })
  it('ranks exact above range above batch', () => {
    // Plain subtitle files throughout: an archive in either wide bucket is dropped once an exact
    // file exists (see the archive describe below), which would hide the ranking under test.
    const files = [f('Show Complete.ass', 90), f('Show 01-12.ass'), f('Show - 07.srt')]
    expect(pickEpisodeFiles(files, 7).map((m) => m.kind)).toEqual(['exact', 'range', 'batch'])
  })
  it('keeps an episode-less archive as a batch row, largest first', () => {
    const files = [f('Show subs.zip', 10), f('Show batch.zip', 900)]
    const out = pickEpisodeFiles(files, 7)
    expect(names(out)).toEqual(['Show batch.zip', 'Show subs.zip'])
    expect(out.every((m) => m.kind === 'batch')).toBe(true)
  })
  it('treats every playable file as a batch row when no episode is wanted (a movie)', () => {
    const out = pickEpisodeFiles([f('Movie.srt'), f('Movie alt.ass')], undefined)
    expect(out.map((m) => m.kind)).toEqual(['batch', 'batch'])
  })
})

describe('pickEpisodeFiles — an archive can only hand back its first entry', () => {
  // The download path unzips and takes the first subtitle entry in archive order, so a "Show 01-12"
  // zip answers ANY episode with episode 1. Nothing here may end up labelled as the wanted episode.
  const archiveLabel = (name: string, ep: number) => `${name} — archive: loads its first entry, may not be episode ${ep}`

  it('drops a season archive when a real per-episode file answers', () => {
    const files = [f('Show 01-12.zip', 900), f('Show - 07.srt', 4)]
    expect(names(pickEpisodeFiles(files, 7))).toEqual(['Show - 07.srt'])
  })
  it('drops an episode-less archive too once an exact file exists', () => {
    const files = [f('Show Complete Batch.zip', 900), f('Show - 07.srt', 4)]
    expect(names(pickEpisodeFiles(files, 7))).toEqual(['Show - 07.srt'])
  })
  it('drops every archive from a realistic directory listing, keeping the one true file', () => {
    const files = [
      f('[Group] Show 01-12 [BD][1080p].zip', 90_000),
      f('[Group] Show 01-24 Complete.zip', 180_000),
      f('Show batch.zip', 50_000),
      f('[Group] Show - 07 [1080p].srt', 4_000),
    ]
    const out = pickEpisodeFiles(files, 7)
    expect(names(out)).toEqual(['[Group] Show - 07 [1080p].srt'])
    expect(out[0].kind).toBe('exact')
  })
  it('keeps a non-archive range beside the exact file — that one loads the name it shows', () => {
    const files = [f('Show 01-12.ass'), f('Show - 07.srt')]
    const out = pickEpisodeFiles(files, 7)
    expect(out.map((m) => m.kind)).toEqual(['exact', 'range'])
    expect(out.map((m) => m.release)).toEqual(['Show - 07.srt', 'Show 01-12.ass'])
  })
  it('keeps an archive that is the only answer, but says what it is', () => {
    const out = pickEpisodeFiles([f('Show 01-12.zip')], 7)
    expect(out.map((m) => m.kind)).toEqual(['range'])
    expect(out[0].release).toBe(archiveLabel('Show 01-12.zip', 7))
  })
  it('labels an episode-less archive batch row the same way', () => {
    const out = pickEpisodeFiles([f('Show batch.zip')], 3)
    expect(out.map((m) => m.kind)).toEqual(['batch'])
    expect(out[0].release).toBe(archiveLabel('Show batch.zip', 3))
  })
  it('names the episode the user actually asked for in the warning', () => {
    expect(pickEpisodeFiles([f('Show 01-12.zip')], 11)[0].release).toContain('may not be episode 11')
  })
  it('never returns an archive row under a bare filename when an episode is wanted', () => {
    const files = [f('Show 01-12.zip'), f('Show 01-24.zip'), f('Show batch.zip'), f('Show 01-12.ass')]
    for (const m of pickEpisodeFiles(files, 7)) {
      expect(m.release === m.file.name).toBe(!/\.zip$/i.test(m.file.name))
    }
  })
  it('leaves an exact archive under its own name — its span is this episode alone', () => {
    const out = pickEpisodeFiles([f('Show - 07.zip')], 7)
    expect(out.map((m) => m.kind)).toEqual(['exact'])
    expect(out[0].release).toBe('Show - 07.zip')
  })
  it('does not label anything when no episode is wanted (a movie archive holds the movie)', () => {
    const out = pickEpisodeFiles([f('Movie.zip')], undefined)
    expect(out[0].release).toBe('Movie.zip')
  })
  it('leaves plain subtitle batch rows unlabelled', () => {
    expect(pickEpisodeFiles([f('Show subs.srt')], 7)[0].release).toBe('Show subs.srt')
  })
})

describe('pickEpisodeFiles — a title ending in a digit is not the start of a span', () => {
  it('reads "Show 2 - 05" as episode 5, not as the span 2-5', () => {
    const file = [f('Show 2 - 05.srt')]
    expect(pickEpisodeFiles(file, 5).map((m) => m.kind)).toEqual(['exact'])
    expect(pickEpisodeFiles(file, 2)).toEqual([])
    expect(pickEpisodeFiles(file, 3)).toEqual([])
    expect(pickEpisodeFiles(file, 4)).toEqual([])
  })
  it('stops every later episode of a second season from answering episode 5', () => {
    const files = [f('Show 2 - 05.srt'), f('Show 2 - 06.srt'), f('Show 2 - 07.srt'), f('Show 2 - 12.srt')]
    expect(names(pickEpisodeFiles(files, 5))).toEqual(['Show 2 - 05.srt'])
    expect(names(pickEpisodeFiles(files, 7))).toEqual(['Show 2 - 07.srt'])
  })
  it('still reads an evenly written span as a span', () => {
    expect(pickEpisodeFiles([f('Show 01-12.ass')], 7).map((m) => m.kind)).toEqual(['range'])
    expect(pickEpisodeFiles([f('Show 13-24.ass')], 20).map((m) => m.kind)).toEqual(['range'])
    expect(pickEpisodeFiles([f('Show 13-24.ass')], 7)).toEqual([])
  })
  it('reads a padded bound as the episode even when the name is written tight ("Show 2-05")', () => {
    expect(pickEpisodeFiles([f('Show 2-05.srt')], 5).map((m) => m.kind)).toEqual(['exact'])
    expect(pickEpisodeFiles([f('Show 2-05.srt')], 3)).toEqual([])
  })
  it('refuses to turn an unevenly written span into its last episode', () => {
    // "9-10" is a real span typed without padding; reading it as episode 10 would be the same silent
    // mis-answer in the other direction. Unresolved names fall to `batch`, which claims no episode.
    expect(pickEpisodeFiles([f('Show 9-10.ass')], 10).map((m) => m.kind)).toEqual(['batch'])
  })
})

describe('pickEpisodeFiles — extras are not carriers of every episode', () => {
  it('drops a creditless opening rather than offering it for any episode', () => {
    expect(pickEpisodeFiles([f('Show OP 07.srt')], 3)).toEqual([])
    expect(pickEpisodeFiles([f('Show OP 07.srt')], 7)).toEqual([])
  })
  it('drops the rest of the extras vocabulary', () => {
    const files = [f('Show NCED.ass'), f('Show Preview.srt'), f('Show - Trailer.srt'), f('Show menu.srt')]
    expect(pickEpisodeFiles(files, 3)).toEqual([])
  })
  it('keeps a numbered file whose GROUP tag happens to carry an extras token', () => {
    const out = pickEpisodeFiles([f('[NCOP-Raws] Show - 07.srt')], 7)
    expect(out.map((m) => m.kind)).toEqual(['exact'])
  })
  it('keeps a range whose name carries one too — only the batch bucket is filtered', () => {
    expect(pickEpisodeFiles([f('[Preview-Subs] Show 01-12.ass')], 7).map((m) => m.kind)).toEqual(['range'])
  })
  it('still lists extras when no episode is wanted — a movie has nothing to narrow on', () => {
    expect(pickEpisodeFiles([f('Movie NCED.ass')], undefined)).toHaveLength(1)
  })
})

describe('pickEpisodeFiles — only files the download path can open', () => {
  it('keeps text subtitle formats and zip', () => {
    const files = [f('Show - 07.srt'), f('Show - 07.ass'), f('Show - 07.ssa'), f('Show - 07.vtt'), f('Show - 07.zip')]
    expect(pickEpisodeFiles(files, 7)).toHaveLength(5)
  })
  it('drops 7z/rar archives and image-based subs, which Rust cannot unpack', () => {
    const files = [f('Show - 07.7z'), f('Show - 07.rar'), f('Show - 07.sub'), f('Show - 07.idx')]
    expect(pickEpisodeFiles(files, 7)).toEqual([])
  })
})

describe('jimakuSearchParams', () => {
  it('prefers the anilist id', () => {
    expect(jimakuSearchParams(SERIES)).toBe('anilist_id=154587')
  })
  it('falls back to the composite tmdb form', () => {
    expect(jimakuSearchParams({ type: 'series', tmdbId: '1234', languages: ['ja'] })).toBe('tmdb_id=tv%3A1234')
    expect(jimakuSearchParams({ type: 'movie', tmdbId: '550', languages: ['ja'] })).toBe('tmdb_id=movie%3A550')
  })
  it('is empty when neither id is known', () => {
    expect(jimakuSearchParams({ type: 'series', languages: ['ja'] })).toBe('')
  })
})

describe('createJimaku().search', () => {
  beforeEach(() => { mocks.phttp.mockReset(); jimakuApiKey.set('JIMAKU_KEY') })

  // Resolved entry ids are memoised module-wide on the search query, so a case reusing another's
  // query would silently skip the search hop. Every case takes its own series id.
  let nextAnilistId = 200_000
  const series = (over: Partial<SubQuery> = {}): SubQuery => ({ ...SERIES, anilistId: nextAnilistId++, ...over })

  const ok = (body: unknown) => ({ ok: true, status: 200, text: async () => '', json: async () => body })
  const denied = { ok: false, status: 401, text: async () => '', json: async () => ({ error: 'unauthorized', code: 7 }) }
  const ENTRIES = [{ id: 9, name: 'Show', anilist_id: 154587, flags: 0, last_modified: '2026-01-01T00:00:00Z' }]
  const FILES = [
    { name: 'Show - 07.srt', url: 'https://jimaku.cc/entry/9/download/Show%20-%2007.srt', size: 4210, last_modified: '2026-01-01T00:00:00Z' },
    { name: 'Show - 08.srt', url: 'https://jimaku.cc/entry/9/download/Show%20-%2008.srt', size: 4310, last_modified: '2026-01-01T00:00:00Z' },
  ]

  it('resolves the entry then its files and maps only the wanted episode', async () => {
    mocks.phttp.mockResolvedValueOnce(ok(ENTRIES)).mockResolvedValueOnce(ok(FILES))
    expect(await createJimaku().search(series())).toEqual([
      {
        provider: 'jimaku',
        lang: 'ja',
        release: 'Show - 07.srt',
        download: { needsFetch: true, fileUrl: 'https://jimaku.cc/entry/9/download/Show%20-%2007.srt' },
      },
    ])
  })

  it('sends the raw key in the Authorization header on both hops', async () => {
    mocks.phttp.mockResolvedValueOnce(ok(ENTRIES)).mockResolvedValueOnce(ok(FILES))
    await createJimaku().search(series())
    for (const call of mocks.phttp.mock.calls) {
      expect(call[1]).toEqual({ headers: expect.objectContaining({ Authorization: 'JIMAKU_KEY' }) })
    }
  })

  it('lists the entry files unfiltered so whole-season batches stay visible', async () => {
    mocks.phttp.mockResolvedValueOnce(ok(ENTRIES)).mockResolvedValueOnce(ok(FILES))
    await createJimaku().search(series())
    expect(mocks.phttp.mock.calls[1][0]).toBe('https://jimaku.cc/api/entries/9/files')
  })

  it('never offers a season archive as the episode when a per-episode file exists', async () => {
    const ARCHIVED = [
      { name: 'Show 01-12.zip', url: 'https://jimaku.cc/entry/9/download/Show%2001-12.zip', size: 900_000 },
      ...FILES,
    ]
    mocks.phttp.mockResolvedValueOnce(ok(ENTRIES)).mockResolvedValueOnce(ok(ARCHIVED))
    const out = await createJimaku().search(series())
    expect(out.map((c) => c.release)).toEqual(['Show - 07.srt'])
  })

  it('carries the archive warning into the candidate the picker shows', async () => {
    const ONLY_ARCHIVE = [{ name: 'Show 01-12.zip', url: 'https://jimaku.cc/entry/9/download/Show%2001-12.zip', size: 900_000 }]
    mocks.phttp.mockResolvedValueOnce(ok(ENTRIES)).mockResolvedValueOnce(ok(ONLY_ARCHIVE))
    const out = await createJimaku().search(series())
    expect(out).toHaveLength(1)
    expect(out[0].release).toBe('Show 01-12.zip — archive: loads its first entry, may not be episode 7')
    expect(out[0].download?.fileUrl).toBe('https://jimaku.cc/entry/9/download/Show%2001-12.zip')
  })

  it('resolves the entry once and reuses it for every later search on that series', async () => {
    const q = series()
    mocks.phttp.mockResolvedValueOnce(ok(ENTRIES)).mockResolvedValue(ok(FILES))
    await createJimaku().search(q)
    await createJimaku().search({ ...q, episode: 8 })
    expect(mocks.phttp).toHaveBeenCalledTimes(3) // search + files, then files alone
    expect(mocks.phttp.mock.calls.map((c) => c[0])).toEqual([
      `https://jimaku.cc/api/entries/search?anilist_id=${q.anilistId}`,
      'https://jimaku.cc/api/entries/9/files',
      'https://jimaku.cc/api/entries/9/files',
    ])
  })

  it('does not memoise a 401 — a key pasted after a failed attempt still works', async () => {
    const q = series()
    mocks.phttp.mockResolvedValueOnce(denied)
    expect(await createJimaku().search(q)).toEqual([])
    mocks.phttp.mockResolvedValueOnce(ok(ENTRIES)).mockResolvedValueOnce(ok(FILES))
    expect(await createJimaku().search(q)).toHaveLength(1)
    expect(mocks.phttp.mock.calls[1][0]).toContain('/entries/search?')
  })

  it('does not memoise a 429 or an unknown series', async () => {
    const limited = series()
    mocks.phttp.mockResolvedValueOnce({ ok: false, status: 429, text: async () => '', json: async () => ({}) })
    expect(await createJimaku().search(limited)).toEqual([])
    const unknown = series()
    mocks.phttp.mockResolvedValueOnce(ok([]))
    expect(await createJimaku().search(unknown)).toEqual([])
    mocks.phttp.mockResolvedValueOnce(ok(ENTRIES)).mockResolvedValueOnce(ok(FILES))
    expect(await createJimaku().search(limited)).toHaveLength(1)
    mocks.phttp.mockResolvedValueOnce(ok(ENTRIES)).mockResolvedValueOnce(ok(FILES))
    expect(await createJimaku().search(unknown)).toHaveLength(1)
  })

  it('returns [] without a network call when no api key is set', async () => {
    jimakuApiKey.set('')
    expect(await createJimaku().search(series())).toEqual([])
    expect(mocks.phttp).not.toHaveBeenCalled()
  })

  it('returns [] without a network call when the query has no usable id', async () => {
    expect(await createJimaku().search({ type: 'series', episode: 7, languages: ['ja'] })).toEqual([])
    expect(mocks.phttp).not.toHaveBeenCalled()
  })

  it('returns [] on a 401 from the entry search and never lists files', async () => {
    mocks.phttp.mockResolvedValue(denied)
    expect(await createJimaku().search(series())).toEqual([])
    expect(mocks.phttp).toHaveBeenCalledOnce()
  })

  it('returns [] on a 401 from the file listing', async () => {
    mocks.phttp.mockResolvedValueOnce(ok(ENTRIES)).mockResolvedValueOnce(denied)
    expect(await createJimaku().search(series())).toEqual([])
  })

  it('returns [] on a 429 rate limit, an unknown series, or a throw', async () => {
    mocks.phttp.mockResolvedValue({ ok: false, status: 429, text: async () => '', json: async () => ({}) })
    expect(await createJimaku().search(series())).toEqual([])
    mocks.phttp.mockResolvedValue(ok([]))
    expect(await createJimaku().search(series())).toEqual([])
    mocks.phttp.mockRejectedValue(new Error('network'))
    expect(await createJimaku().search(series())).toEqual([])
  })
})
