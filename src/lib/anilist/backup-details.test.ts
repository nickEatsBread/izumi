import { describe, expect, it } from 'vitest'
import { Client, createRequest, fetchExchange, gql, type AnyVariables, type TypedDocumentNode } from '@urql/core'
import { cacheExchange } from '@urql/exchange-graphcache'
import { pipe, subscribe } from 'wonka'
import { ANILIST_CACHE_KEYS } from './cache'
import { ANIME_LIST_ENTRY, MEDIA_BY_ID } from './detail-queries'
import { CARD_MEDIA_FIELDS } from './fragments'
import { backupProvider, mediaCacheKey, stampBackupData } from './backup-records'
import { createBackupDetails, detailFieldFragments, isBackupRecord } from './backup-details'
import { aniListCard, aniListDetail, backupDetail } from './__fixtures__/media-by-id'

type Fields = Record<string, unknown>
type Detail = { Media: Fields & { title: Fields; coverImage: Fields; relations: { edges: unknown[] } } }

const CARDS = gql`
  query Page($withPreview: Boolean = true) { Page { media { ...CardMediaFields } } }
  ${CARD_MEDIA_FIELDS}`

const backupAnswer = (id: number, overrides: Fields = {}) => {
  const data = { Media: backupDetail(id, overrides) }
  stampBackupData(data, 'Kitsu')
  return data
}

/** A real urql client with graphcache in front of a scripted transport, wired like client.ts. */
function harness() {
  const backup = createBackupDetails()
  const answers: unknown[] = []
  const requests: string[] = []
  let probe = false
  const client = new Client({
    url: 'https://graphql.anilist.co',
    preferGetMethod: false,
    exchanges: [
      backup.exchange(() => probe),
      cacheExchange({ keys: { ...ANILIST_CACHE_KEYS, Media: mediaCacheKey }, updates: backup.updates }),
      fetchExchange,
    ],
    fetch: async (_input, init) => {
      const { query } = JSON.parse(String(init?.body)) as { query: string }
      requests.push(/\bquery\s+(\w+)/.exec(query)?.[1] ?? '?')
      if (!answers.length) throw new Error('no scripted answer left')
      // An answer may be a promise, to hold a request in flight.
      return Response.json({ data: await answers.shift() })
    },
  })
  const query = <T = Detail>(document: TypedDocumentNode, variables: AnyVariables, requestPolicy: 'cache-first' | 'network-only' | 'cache-only' = 'cache-first') =>
    client.query<T>(document, variables, { requestPolicy }).toPromise()
  return { client, backup, answers, requests, query, allowProbe: (value: boolean) => { probe = value } }
}

describe('backup records on the wire', () => {
  it('stamps the answer and every Media in it, and keys those records beside AniList\'s', () => {
    const data = { Page: { __typename: 'Page', media: [aniListCard(1), { ...aniListCard(2), relations: { edges: [{ node: aniListCard(3) }] } }] } }
    stampBackupData(data, 'Jikan')
    expect(backupProvider(data)).toBe('Jikan')
    expect(backupProvider(data.Page)).toBeUndefined()
    expect(data.Page.media.map(backupProvider)).toEqual(['Jikan', 'Jikan'])
    expect(backupProvider((data.Page.media[1].relations as { edges: { node: unknown }[] }).edges[0].node)).toBe('Jikan')
    expect(mediaCacheKey(aniListCard(1) as never)).toBe('1')
    expect(mediaCacheKey(data.Page.media[0] as never)).toBe('backup-1')
    expect(mediaCacheKey({ __typename: 'Media' })).toBeNull()
  })

  it('reads each series-page field on its own, with the selection the page asks for', () => {
    const fields = detailFieldFragments().map((field) => field.key)
    expect(fields).toEqual(expect.arrayContaining(['bannerImage', 'title', 'coverImage', 'popularity', 'mediaListEntry', 'relations']))
    expect(fields).not.toContain('id')
    expect(new Set(fields).size).toBe(fields.length)
  })
})

describe('series page answered by a backup provider', () => {
  it('still shows the backup record when nothing about the title is cached (cold outage visit)', async () => {
    const { backup, answers, query } = harness()
    answers.push(backupAnswer(135865))
    const result = await query(MEDIA_BY_ID, { id: 135865 }, 'network-only')
    expect(result.error).toBeUndefined()
    expect(result.data?.Media).toMatchObject({ id: 135865, title: { userPreferred: 'Backup title 135865' }, bannerImage: null, popularity: 3_200 })
    expect(backup.served.get(135865)).toBe('backup')
  })

  it('keeps a cached AniList record on screen instead of the backup answer to its revalidation', async () => {
    const { backup, answers, query } = harness()
    answers.push({ Media: aniListDetail(182205) })
    await query(MEDIA_BY_ID, { id: 182205 })
    answers.push(backupAnswer(182205))
    const result = await query(MEDIA_BY_ID, { id: 182205 }, 'network-only')
    expect(result.data?.Media).toMatchObject({
      title: { userPreferred: 'Title 182205' },
      bannerImage: 'https://anilist.test/banner/182205.jpg',
      popularity: 140_000,
      relations: { edges: [expect.objectContaining({ relationType: 'PREQUEL' })] },
    })
    expect(backup.served.get(182205)).toBe('cached')
  })

  it('takes the backup\'s live schedule over a cached AniList countdown that has already passed', async () => {
    const { backup, answers, query } = harness()
    // A copy from disk days old: its next episode has aired since, so the episode list would hide it.
    const aired = { __typename: 'AiringSchedule', episode: 5, airingAt: Math.floor(Date.now() / 1000) - 3600, timeUntilAiring: -3600 }
    answers.push({ Media: aniListDetail(182205, { nextAiringEpisode: aired }) })
    await query(MEDIA_BY_ID, { id: 182205 })
    answers.push(backupAnswer(182205))
    const result = await query(MEDIA_BY_ID, { id: 182205 }, 'network-only')
    expect(result.data?.Media).toMatchObject({
      title: { userPreferred: 'Title 182205' },
      bannerImage: 'https://anilist.test/banner/182205.jpg',
      popularity: 140_000,
      relations: { edges: [expect.objectContaining({ relationType: 'PREQUEL' })] },
      nextAiringEpisode: expect.objectContaining({ episode: 6 }),
    })
    expect(backup.served.get(182205)).toBe('backup')

    // A backup that does not know the title leaves the AniList record on screen, stale or not.
    answers.push({ Media: aniListDetail(21, { nextAiringEpisode: aired }) })
    await query(MEDIA_BY_ID, { id: 21 })
    const unknown = { Media: null }
    stampBackupData(unknown, 'Kitsu')
    answers.push(unknown)
    const kept = await query(MEDIA_BY_ID, { id: 21 }, 'network-only')
    expect(kept.data?.Media).toMatchObject({ title: { userPreferred: 'Title 21' }, nextAiringEpisode: { episode: 5 } })
    expect(backup.served.get(21)).toBe('cached')
  })

  it('keeps every field AniList already sent when only a card and the list entry are cached', async () => {
    const { answers, query } = harness()
    const id = 154587
    // The card the viewer tapped carries an already-passed countdown; the backup's live one wins.
    answers.push({ Page: { __typename: 'Page', media: [aniListCard(id, { nextAiringEpisode: { __typename: 'AiringSchedule', episode: 4, airingAt: 1, timeUntilAiring: 0 } })] } })
    await query(CARDS, {})
    answers.push({ Media: { __typename: 'Media', id, mediaListEntry: {
      __typename: 'MediaList', id: 9, progress: 3, status: 'CURRENT', score: 80, repeat: 0,
      startedAt: { __typename: 'FuzzyDate', year: 2026, month: 4, day: 2 },
      completedAt: { __typename: 'FuzzyDate', year: null, month: null, day: null },
    } } })
    await query(ANIME_LIST_ENTRY, { id })

    answers.push(backupAnswer(id))
    const result = await query(MEDIA_BY_ID, { id }, 'network-only')
    expect(result.data?.Media).toMatchObject({
      bannerImage: `https://anilist.test/banner/${id}.jpg`,
      title: { userPreferred: `Title ${id}`, english: `English ${id}` },
      coverImage: { extraLarge: `https://anilist.test/cover/xl/${id}.jpg`, color: '#e4a15d' },
      genres: ['Action', 'Drama'],
      rankings: [expect.objectContaining({ rank: 3 })],
      mediaListEntry: expect.objectContaining({ progress: 3, status: 'CURRENT' }),
      // What no AniList query brought in stays the backup's.
      popularity: 3_200,
      relations: { edges: [] },
      nextAiringEpisode: expect.objectContaining({ episode: 6 }),
    })

    // The AniList card itself was not overwritten by the backup record.
    const card = await query<{ Page: { media: Fields[] } }>(CARDS, {}, 'cache-only')
    expect(card.data?.Page.media[0]).toMatchObject({
      title: { userPreferred: `Title ${id}` }, bannerImage: `https://anilist.test/banner/${id}.jpg`,
    })
  })

  it('does not erase backup art with a banner AniList itself does not have', async () => {
    const { answers, query } = harness()
    answers.push({ Page: { __typename: 'Page', media: [aniListCard(21, { bannerImage: null })] } })
    await query(CARDS, {})
    answers.push(backupAnswer(21, { bannerImage: 'https://backup.test/cover/21.jpg' }))
    const result = await query(MEDIA_BY_ID, { id: 21 }, 'network-only')
    expect(result.data?.Media).toMatchObject({ bannerImage: 'https://backup.test/cover/21.jpg', title: { userPreferred: 'Title 21' } })
  })

  it('asks AniList again on a revisit only once AniList may be probed', async () => {
    const { answers, requests, query, allowProbe } = harness()
    answers.push(backupAnswer(135865))
    await query(MEDIA_BY_ID, { id: 135865 })

    // Still inside the outage window: the revisit is answered from the cache, no request.
    const inside = await query(MEDIA_BY_ID, { id: 135865 })
    expect(requests).toEqual(['MediaById'])
    expect(inside.data?.Media.title).toMatchObject({ userPreferred: 'Backup title 135865' })

    allowProbe(true)
    answers.push({ Media: aniListDetail(135865) })
    const after = await query(MEDIA_BY_ID, { id: 135865 })
    expect(requests).toEqual(['MediaById', 'MediaById'])
    expect(after.data?.Media).toMatchObject({ bannerImage: 'https://anilist.test/banner/135865.jpg', popularity: 140_000 })
  })

  it('leaves pages AniList answered alone', async () => {
    const { answers, requests, query, allowProbe } = harness()
    allowProbe(true)
    answers.push({ Media: aniListDetail(1) })
    await query(MEDIA_BY_ID, { id: 1 })
    await query(MEDIA_BY_ID, { id: 1 })
    expect(requests).toEqual(['MediaById'])
  })

  it('refreshes a mounted page showing a backup answer once, as soon as AniList answers again', async () => {
    const { client, backup, answers, requests } = harness()
    const seen: (Fields | undefined)[] = []
    answers.push(backupAnswer(135865))
    const mounted = pipe(
      client.query<Detail>(MEDIA_BY_ID, { id: 135865 }),
      subscribe((result) => { seen.push(result.data?.Media) }),
    )
    await expect.poll(() => seen.at(-1)?.bannerImage, { timeout: 2000 }).toBeNull()

    answers.push({ Media: aniListDetail(135865) })
    backup.refresh()
    backup.refresh()
    await expect.poll(() => seen.at(-1)?.bannerImage, { timeout: 2000 }).toBe('https://anilist.test/banner/135865.jpg')
    expect(requests).toEqual(['MediaById', 'MediaById'])

    // AniList answered it; an unmounted page is never re-asked.
    backup.live(135865)
    mounted.unsubscribe()
    backup.refresh()
    expect(requests).toHaveLength(2)
  })

  it('does not send a second request when a cache update re-runs a page whose refresh is in flight', async () => {
    const { client, backup, answers, requests, allowProbe } = harness()
    const seen: (Fields | undefined)[] = []
    answers.push(backupAnswer(135865))
    const mounted = pipe(
      client.query<Detail>(MEDIA_BY_ID, { id: 135865 }),
      subscribe((result) => { seen.push(result.data?.Media) }),
    )
    await expect.poll(() => seen.at(-1)?.bannerImage, { timeout: 2000 }).toBeNull()

    allowProbe(true)
    let answer!: (data: unknown) => void
    answers.push(new Promise((resolve) => { answer = resolve }))
    backup.refresh()
    await expect.poll(() => requests.length, { timeout: 2000 }).toBe(2)

    // Graphcache re-runs a mounted page as cache-first whenever data it reads changes.
    const rerun = client.createRequestOperation('query', createRequest(MEDIA_BY_ID, { id: 135865 }), { requestPolicy: 'cache-first' })
    client.reexecuteOperation(rerun)
    client.reexecuteOperation(rerun)
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(requests).toHaveLength(2)

    answer({ Media: aniListDetail(135865) })
    await expect.poll(() => seen.at(-1)?.bannerImage, { timeout: 2000 }).toBe('https://anilist.test/banner/135865.jpg')
    mounted.unsubscribe()
  })
})

// The series page keeps the AniList banner it has seen over a backup record's own. The query does not
// select the record's catalog identity, so the page asks which answer it is showing.
describe('the series page asking whether it shows a backup record', () => {
  it('is told only for a backup answer, and no longer once AniList answers', async () => {
    const { backup, answers, query } = harness()
    answers.push(backupAnswer(135865))
    const result = await query(MEDIA_BY_ID, { id: 135865 }, 'network-only')
    // The record itself carries no sign of where it came from.
    expect(result.data?.Media).not.toHaveProperty('catalog')
    expect(isBackupRecord(135865)).toBe(true)

    // A cached AniList record kept on screen is AniList's.
    answers.push({ Media: aniListDetail(182205) })
    await query(MEDIA_BY_ID, { id: 182205 })
    answers.push(backupAnswer(182205))
    await query(MEDIA_BY_ID, { id: 182205 }, 'network-only')
    expect(backup.served.get(182205)).toBe('cached')
    expect(isBackupRecord(182205)).toBe(false)

    backup.live(135865)
    expect(isBackupRecord(135865)).toBe(false)
    expect(isBackupRecord(7)).toBe(false)
  })
})
