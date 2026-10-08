import { get } from 'svelte/store'
import { describe, expect, it } from 'vitest'
import { showAdult } from '$lib/settings/ui'
import * as detailQueries from './detail-queries'
import { animeCredits, searchIdsQuery, searchProbeQuery, searchQuery, STAFF_MEDIA_QUERY, STUDIO_MEDIA_QUERY } from './detail-queries'
import * as fragments from './fragments'
import * as lists from './lists'
import * as queries from './queries'
import { heroQuery, pageQuery } from './queries'
import type { Media } from './types'

// AniList rejects a whole query when one nested field is given an argument it does not take: a studio
// page asking `Studio.media(type: ANIME)` showed "Unknown argument type on field media of type Studio"
// and no titles. The arguments each nested connection takes, as AniList's schema lists them (read from
// its introspection); a query that passes anything else to one of them fails this test.
const ACCEPTS: Record<string, Record<string, string[]>> = {
  Studio: { media: ['sort', 'isMain', 'onList', 'page', 'perPage'] },
  Staff: {
    staffMedia: ['sort', 'type', 'onList', 'page', 'perPage'],
    characterMedia: ['sort', 'onList', 'page', 'perPage'],
  },
  Character: { media: ['sort', 'type', 'onList', 'page', 'perPage'] },
  Media: {
    relations: [],
    studios: ['sort', 'isMain'],
    characters: ['sort', 'role', 'page', 'perPage'],
    staff: ['sort', 'page', 'perPage'],
    recommendations: ['sort', 'page', 'perPage'],
    airingSchedule: ['notYetAired', 'page', 'perPage'],
  },
}

// What each field returns, far enough to reach every connection above from a query's root.
const RETURNS: Record<string, Record<string, string>> = {
  Query: { Media: 'Media', Page: 'Page', Studio: 'Studio', Staff: 'Staff', Character: 'Character' },
  Page: { media: 'Media' },
  Studio: { media: 'MediaConnection' },
  Staff: { staffMedia: 'MediaConnection', characterMedia: 'MediaConnection' },
  Character: { media: 'MediaConnection' },
  MediaConnection: { nodes: 'Media', edges: 'MediaEdge' },
  MediaEdge: { node: 'Media' },
  Media: { relations: 'MediaConnection', recommendations: 'RecommendationConnection' },
  RecommendationConnection: { nodes: 'Recommendation' },
  Recommendation: { mediaRecommendation: 'Media' },
}

interface Node {
  kind: string
  name?: { value: string }
  arguments?: { name: { value: string } }[]
  selectionSet?: { selections: Node[] }
  typeCondition?: { name: { value: string } }
}
interface Document { kind: 'Document'; definitions: Node[]; loc?: { source: { body: string } } }

const isDocument = (value: unknown): value is Document => (value as Document | null)?.kind === 'Document'

/** Every argument passed to a nested connection that AniList's schema does not list for it. */
function unknownArguments(document: Document): string[] {
  const found: string[] = []
  const walk = (type: string | undefined, selections: Node[], path: string) => {
    for (const node of selections) {
      if (node.kind === 'InlineFragment' && node.selectionSet) {
        walk(node.typeCondition?.name.value ?? type, node.selectionSet.selections, path)
        continue
      }
      if (node.kind !== 'Field' || !node.name) continue
      const field = node.name.value
      const accepted = type ? ACCEPTS[type]?.[field] : undefined
      if (accepted) {
        for (const argument of node.arguments ?? []) {
          if (!accepted.includes(argument.name.value)) found.push(`${path}${type}.${field}(${argument.name.value})`)
        }
      }
      if (node.selectionSet) walk(type ? RETURNS[type]?.[field] : undefined, node.selectionSet.selections, `${path}${field} > `)
    }
  }
  for (const definition of document.definitions) {
    if (!definition.selectionSet) continue
    const root = definition.kind === 'FragmentDefinition' ? definition.typeCondition?.name.value : 'Query'
    walk(root, definition.selectionSet.selections, `${definition.name?.value ?? 'query'}: `)
  }
  return found
}

function everyDocument(): Document[] {
  const previous = get(showAdult)
  const documents: Document[] = []
  try {
    for (const adult of [false, true]) {
      showAdult.set(adult)
      documents.push(...[searchQuery(), searchIdsQuery(), searchProbeQuery(1), searchProbeQuery(3), pageQuery(), heroQuery()].filter(isDocument))
    }
  } finally {
    showAdult.set(previous)
  }
  for (const module of [detailQueries, fragments, lists, queries]) documents.push(...Object.values(module).filter(isDocument))
  return documents
}

describe('nested AniList connections', () => {
  it('pass only the arguments AniList accepts', () => {
    const documents = everyDocument()
    expect(documents.length).toBeGreaterThan(20)
    expect(documents.flatMap(unknownArguments)).toEqual([])
  })

  it('catches a type argument on a studio or a voice actor credit list', () => {
    const studio = STUDIO_MEDIA_QUERY.loc?.source.body ?? ''
    expect(studio).toMatch(/Studio\(id: \$id\)/)
    expect(studio).not.toMatch(/media\([^)]*\btype:/)
    // The check itself: the same query with the argument back is reported.
    const broken = {
      kind: 'Document',
      definitions: [{
        kind: 'OperationDefinition',
        selectionSet: { selections: [{
          kind: 'Field', name: { value: 'Studio' },
          selectionSet: { selections: [{ kind: 'Field', name: { value: 'media' }, arguments: [{ name: { value: 'type' } }, { name: { value: 'page' } }] }] },
        }, {
          kind: 'Field', name: { value: 'Staff' },
          selectionSet: { selections: [{ kind: 'Field', name: { value: 'characterMedia' }, arguments: [{ name: { value: 'type' } }] }] },
        }] },
      }],
    } as Document
    expect(unknownArguments(broken)).toEqual(['query: Studio > Studio.media(type)', 'query: Staff > Staff.characterMedia(type)'])
    // A staff member's own credits can still be narrowed to anime.
    expect(unknownArguments(STAFF_MEDIA_QUERY as unknown as Document)).toEqual([])
    expect(STAFF_MEDIA_QUERY.loc?.source.body).toMatch(/staffMedia\([^)]*type: ANIME/)
  })

  it('asks for the media type with every credit, so the credit pages can keep the anime', () => {
    const studio = STUDIO_MEDIA_QUERY.loc?.source.body ?? ''
    expect(studio).toContain('...CardMediaFields')
    const card = (fragments.CARD_MEDIA_FIELDS as unknown as Document).definitions[0]
    expect(card.selectionSet?.selections.map((field) => field.name?.value)).toContain('type')
  })
})

describe('anime credits', () => {
  const credit = (over: Partial<Media>): Media => ({ id: 1, title: {}, ...over }) as Media
  it('drops manga and novels from a credit list and keeps its order', () => {
    const items = [
      credit({ id: 1, type: 'ANIME', format: 'TV' }),
      credit({ id: 2, type: 'MANGA', format: 'MANGA' }),
      credit({ id: 3, type: 'ANIME', format: 'MOVIE' }),
      credit({ id: 4, type: 'MANGA', format: 'NOVEL' }),
      credit({ id: 5, format: 'ONA' }),
    ]
    expect(animeCredits(items).map((item) => item.id)).toEqual([1, 3, 5])
  })
  it('keeps an anime whatever its format says', () => {
    expect(animeCredits([credit({ id: 9, type: 'ANIME', format: 'MANGA' })]).map((item) => item.id)).toEqual([9])
  })
})
