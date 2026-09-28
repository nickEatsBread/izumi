import { describe, expect, it, vi } from 'vitest'

// The season picker's chain walk shares records with the series page's own query: the sequel it asks
// for is one of the page's relations, and that sequel lists the page's title as its prequel. Graphcache
// merges those writes into the page's records and delivers the page's query again, with the same series
// in it. The page must take such a delivery as the same series: AnimeDetail's banner fade follows its
// image, since an effect that reset the fade on each delivery left a loaded banner invisible.

const http = vi.hoisted(() => vi.fn())
vi.mock('$lib/net/http', () => ({ invokeNativeHttp: http, phttp: vi.fn() }))

import { gql } from '@urql/core'
import { queryStore } from '@urql/svelte'
import { anilist } from './client'
import { MEDIA_BY_ID } from './detail-queries'
import { fetchSeasonChain } from './seasons'
import type { Media } from './types'

type Json = Record<string, unknown>
interface Selection {
  kind: string
  name?: { value: string }
  alias?: { value: string }
  selectionSet?: { selections: Selection[] }
}
interface Definition { kind: string; name?: { value: string }; selectionSet: { selections: Selection[] } }

// The object type of each selected field, for the `__typename` graphcache normalizes by.
const CHILD: Record<string, Record<string, string>> = {
  Query: { Media: 'Media', Page: 'Page' },
  Page: { media: 'Media' },
  Media: {
    title: 'MediaTitle', coverImage: 'MediaCoverImage', startDate: 'FuzzyDate', studios: 'StudioConnection',
    trailer: 'MediaTrailer', nextAiringEpisode: 'AiringSchedule', airingSchedule: 'AiringScheduleConnection',
    rankings: 'MediaRank', tags: 'MediaTag', mediaListEntry: 'MediaList', relations: 'MediaRelationConnection',
    characters: 'CharacterConnection', staff: 'StaffConnection', recommendations: 'RecommendationConnection',
  },
  StudioConnection: { nodes: 'Studio' },
  AiringScheduleConnection: { nodes: 'AiringSchedule' },
  MediaRelationConnection: { edges: 'MediaEdge' },
  MediaEdge: { node: 'Media' },
}

/** AniList's answer to `selections`: every selected field, `null` where the record has none. */
function answer(selections: Selection[], value: Json, type: string, fragments: Map<string, Definition>): Json {
  const out: Json = {}
  for (const selection of selections) {
    if (selection.kind === 'FragmentSpread') Object.assign(out, answer(fragments.get(selection.name!.value)!.selectionSet.selections, value, type, fragments))
    else if (selection.kind === 'InlineFragment') Object.assign(out, answer(selection.selectionSet!.selections, value, type, fragments))
    else {
      const name = selection.name!.value
      const key = selection.alias?.value ?? name
      const raw = value[name]
      const child = CHILD[type]?.[name] ?? 'Unknown'
      if (name === '__typename') out[key] = type
      else if (!selection.selectionSet || raw == null) out[key] = raw ?? null
      else if (Array.isArray(raw)) out[key] = raw.map((item) => answer(selection.selectionSet!.selections, item as Json, child, fragments))
      else out[key] = answer(selection.selectionSet.selections, raw as Json, child, fragments)
    }
  }
  return out
}

const title = (id: number, year: number): Json => ({
  id, type: 'ANIME', format: 'TV', season: 'FALL', seasonYear: year, isAdult: false, status: 'FINISHED', episodes: 12,
  title: { romaji: `Title ${id}`, english: `Title ${id}`, native: `Title ${id}`, userPreferred: `Title ${id}` },
  description: `About ${id}.`, genres: ['Fantasy'], averageScore: 80, duration: 24, rankings: [], tags: [],
  startDate: { year, month: 10, day: 1 },
  coverImage: { extraLarge: `https://img.test/${id}-xl.jpg`, large: `https://img.test/${id}-l.jpg`, medium: `https://img.test/${id}-m.jpg`, color: '#aabbcc' },
  bannerImage: `https://img.test/${id}-banner.jpg`,
  studios: { nodes: [] }, airingSchedule: { nodes: [] },
})
// A season and its sequel, each linking the other.
const titles: Record<number, Json> = {
  101: { ...title(101, 2023), relations: { edges: [{ relationType: 'SEQUEL', node: title(102, 2026) }] }, characters: { edges: [] }, staff: { edges: [] }, recommendations: { nodes: [] } },
  102: { ...title(102, 2026), relations: { edges: [{ relationType: 'PREQUEL', node: title(101, 2023) }] } },
}

const operations: string[] = []
http.mockImplementation(async (_command: string, { body }: { body: string }) => {
  const request = JSON.parse(body) as { query: string; variables: Json }
  const document = gql(request.query) as unknown as { definitions: Definition[] }
  const fragments = new Map(document.definitions.filter((d) => d.kind === 'FragmentDefinition').map((d) => [d.name!.value, d]))
  const operation = document.definitions.find((d) => d.kind === 'OperationDefinition')!
  const name = operation.name?.value ?? ''
  operations.push(name)
  const root = name === 'MediaById'
    ? { Media: titles[request.variables.id as number] }
    : { Page: { media: (request.variables.ids as number[]).map((id) => titles[id]) } }
  return { status: 200, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ data: answer(operation.selectionSet.selections, root, 'Query', fragments) }) }
})

async function until(done: () => boolean) {
  for (let waited = 0; !done() && waited < 5000; waited += 20) await new Promise((resolve) => setTimeout(resolve, 20))
}

describe('the season walk and the series page query', () => {
  it('delivers the page query again with the same series, banner included', async () => {
    const page = queryStore<{ Media: Media }>({ client: anilist, query: MEDIA_BY_ID, variables: { id: 101 } })
    const deliveries: Media[] = []
    const stop = page.subscribe(({ data }) => { if (data?.Media) deliveries.push(data.Media) })
    await until(() => deliveries.length > 0)
    const [first] = deliveries

    const chain = await fetchSeasonChain(101, first)
    await until(() => deliveries.length > 1)
    stop()

    expect(chain.map((media) => media.id).sort()).toEqual([101, 102])
    expect(operations).toEqual(['MediaById', 'SeasonChain'])
    expect(first.bannerImage).toBe('https://img.test/101-banner.jpg')
    expect(deliveries.length).toBeGreaterThan(1)
    for (const media of deliveries.slice(1)) expect(media).toEqual(first)
  })
})
