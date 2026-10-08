import { getOperationName, makeOperation, mapExchange, type Client, type Exchange, type Operation, type TypedDocumentNode } from '@urql/core'
import type { Cache, Data, ResolveInfo, UpdatesConfig, Variables } from '@urql/exchange-graphcache'
import { BACKUP_MARK, backupProvider } from './backup-records'
import { MEDIA_BY_ID } from './detail-queries'

// What a series page shows when its MediaById answer came from a backup provider (see
// backup-records.ts for why those records are kept apart from AniList's):
//   1. A complete AniList record of the same query is already cached (a revisit, or a cold boot
//      revalidating the copy on disk): it stays on screen instead of the approximation, unless its
//      next-episode countdown has already passed (a copy from disk days old), which would hide the
//      newest episode for the whole outage. Rule 2 applies then.
//   2. Otherwise the backup record is shown, but every field the cache already has from AniList wins
//      over the backup's guess: the banner, title and cover of the card that was tapped, the
//      viewer's list entry, and anything else an earlier AniList query brought in.
//   3. A page answered that way asks AniList again: on a revisit once AniList may be probed, and at
//      once on every mounted page as soon as AniList answers again.

/** How the series page of an id was last answered without AniList. */
type Served = 'cached' | 'backup'

const FIELD_FRAGMENT = 'AniListField'

interface AstName { value: string }
interface AstSelection {
  kind: string
  name?: AstName
  alias?: AstName
  selectionSet?: { selections: readonly AstSelection[] }
}

let detailFields: { key: string; fragment: TypedDocumentNode }[] | null = null

/** One fragment per top-level field of the series-page query, carrying that field's exact selection
 *  (and the fragments it spreads), so each field can be read from the AniList record on its own and
 *  copied only when the cache has all of it. Derived from MEDIA_BY_ID so the two cannot drift. */
export function detailFieldFragments(): { key: string; fragment: TypedDocumentNode }[] {
  if (detailFields) return detailFields
  const definitions = MEDIA_BY_ID.definitions as unknown as readonly AstSelection[]
  const fragments = new Map<string, AstSelection>()
  for (const definition of definitions) {
    if (definition.kind === 'FragmentDefinition' && definition.name) fragments.set(definition.name.value, definition)
  }
  const media = definitions.find((definition) => definition.kind === 'OperationDefinition')
    ?.selectionSet?.selections.find((selection) => selection.kind === 'Field' && selection.name?.value === 'Media')
  const fields: AstSelection[] = []
  const collect = (selections: readonly AstSelection[] = []) => {
    for (const selection of selections) {
      if (selection.kind === 'Field') fields.push(selection)
      else if (selection.kind === 'FragmentSpread') collect(fragments.get(selection.name?.value ?? '')?.selectionSet?.selections)
      else if (selection.kind === 'InlineFragment') collect(selection.selectionSet?.selections)
    }
  }
  collect(media?.selectionSet?.selections)
  detailFields = fields.flatMap((field) => {
    const key = field.alias?.value ?? field.name?.value
    if (!key || key === 'id' || key === '__typename') return []
    // Graphcache reads and writes with a document's first fragment, so the field's own comes first.
    const fragment = {
      kind: 'Document',
      definitions: [
        {
          kind: 'FragmentDefinition',
          name: { kind: 'Name', value: FIELD_FRAGMENT },
          typeCondition: { kind: 'NamedType', name: { kind: 'Name', value: 'Media' } },
          directives: [],
          selectionSet: { kind: 'SelectionSet', selections: [field] },
        },
        ...fragments.values(),
      ],
    } as unknown as TypedDocumentNode
    return [{ key, fragment }]
  })
  return detailFields
}

/** Whether a cached `nextAiringEpisode` already lies in the past: the episode list counts that
 *  episode as unaired, so the record is stale. */
const countdownPassed = (next: unknown): boolean =>
  next != null && Number((next as Data).airingAt) <= Date.now() / 1000

/** Copies onto the backup record of `id` every series-page field the AniList record of `id` already
 *  holds in full. A field AniList knows to be empty (no banner, no list entry) keeps the backup's
 *  value; a countdown that has already passed is stale and the backup's live schedule wins. */
function keepAniListFields(cache: Cache, id: number, provider: string, variables: Variables) {
  for (const { key, fragment } of detailFieldFragments()) {
    const known = cache.readFragment(fragment, { __typename: 'Media', id }, variables) as Data | null
    const value = known?.[key]
    if (value == null) continue
    if (key === 'nextAiringEpisode' && countdownPassed(value)) continue
    cache.writeFragment(fragment, { ...known, __typename: 'Media', id, [BACKUP_MARK]: provider }, variables)
  }
}

export interface BackupDetails {
  /** Graphcache `updates`: applies rules 1 and 2 whenever a backup answer lands. */
  updates: UpdatesConfig
  /** Sits in front of graphcache: tracks mounted series pages and applies rule 3 on a revisit. */
  exchange(probeAllowed: () => boolean): Exchange
  /** AniList itself answered the series page of `id`. */
  live(id: number | undefined): void
  /** AniList answers again: every mounted series page that shows a backup answer asks it again. */
  refresh(): void
  /** Ids whose last series-page answer did not come live from AniList. */
  readonly served: ReadonlyMap<number, Served>
}

/** The series-page answers of the app's client (client.ts creates it), for `isBackupRecord`. */
let current: BackupDetails | null = null

/** Whether the series page of `id` shows a backup provider's record rather than AniList's (rule 2):
 *  the page keeps the AniList banner it has seen over that record's own. The query does not select
 *  the record's catalog identity, so the page cannot tell from the record itself. */
export function isBackupRecord(id: number): boolean {
  return current?.served.get(id) === 'backup'
}

export function createBackupDetails(): BackupDetails {
  const served = new Map<number, Served>()
  const refreshing = new Set<number>()
  const mounted = new Map<number, Operation>()
  let client: Client | null = null

  const keepAniListRecord = (result: Data, args: Variables, cache: Cache, info: ResolveInfo) => {
    const provider = backupProvider(result)
    const id = Number(args.id)
    if (!provider || !Number.isFinite(id)) return
    refreshing.delete(id)
    const record = result[info.fieldName]
    const backupKey = record && typeof record === 'object' ? cache.keyOfEntity(record as Data) : null
    cache.link('Query', info.fieldName, args, cache.keyOfEntity({ __typename: 'Media', id }))
    const kept = cache.readQuery({ query: MEDIA_BY_ID, variables: info.variables }) as { Media?: Data | null } | null
    // A stale countdown only gives way when the backup has a record of its own to take over.
    const stale = backupKey != null && countdownPassed(kept?.Media?.nextAiringEpisode)
    if (kept?.Media && !stale) {
      served.set(id, 'cached')
      return
    }
    cache.link('Query', info.fieldName, args, backupKey)
    if (backupKey) keepAniListFields(cache, id, provider, info.variables)
    served.set(id, 'backup')
  }

  const details: BackupDetails = {
    // Only the series page's MediaById is ever answered by a backup at the root `Media` field.
    updates: { Query: { Media: keepAniListRecord } },
    exchange(probeAllowed) {
      return (input) => {
        client = input.client
        return mapExchange({
          onOperation(op) {
            if (op.kind === 'teardown') {
              // A refresh cancelled by leaving the page must not block the next one.
              const left = mounted.get(op.key)
              if (left) refreshing.delete(Number(left.variables?.id))
              mounted.delete(op.key)
              return op
            }
            if (op.kind !== 'query' || getOperationName(op.query) !== 'MediaById') return op
            mounted.set(op.key, op)
            const id = Number(op.variables?.id)
            const answer = served.get(id)
            // While a refresh of this page is in flight, a cache update re-running it reads the cache
            // instead of sending a second request.
            if (!answer || refreshing.has(id) || op.context.requestPolicy !== 'cache-first' || !probeAllowed()) return op
            // A cached AniList record may paint while it revalidates. A backup record is not painted
            // again: the loading state shows the art of the card that was tapped instead.
            return makeOperation(op.kind, op, {
              ...op.context,
              requestPolicy: answer === 'cached' ? 'cache-and-network' : 'network-only',
            })
          },
        })(input)
      }
    },
    live(id) {
      if (id == null) return
      served.delete(id)
      refreshing.delete(id)
    },
    refresh() {
      if (!client || !served.size) return
      for (const op of mounted.values()) {
        const id = Number(op.variables?.id)
        if (!served.has(id) || refreshing.has(id)) continue
        refreshing.add(id)
        client.reexecuteOperation(makeOperation(op.kind, op, { ...op.context, requestPolicy: 'network-only' }))
      }
    },
    served,
  }
  current = details
  return details
}
