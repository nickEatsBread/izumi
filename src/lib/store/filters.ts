import type { ContentType, SourceType, StoreEntry, StoreKind } from './types'

export interface StoreFilter {
  storeIds: 'all' | readonly string[]
  kind: 'all' | StoreKind
  sourceType: 'all' | SourceType
  language: 'all' | string
  content: 'all' | ContentType
  /** Only entries that work without a debrid account. */
  withoutDebrid: boolean
  installedOnly: boolean
  /** The active profile's effective 18+ setting. */
  showAdult: boolean
  query: string
  sort: 'popular' | 'name' | 'updated'
}

export const DEFAULT_STORE_FILTER: StoreFilter = {
  storeIds: 'all', kind: 'all', sourceType: 'all', language: 'all', content: 'all',
  withoutDebrid: false, installedOnly: false, showAdult: false, query: '', sort: 'popular',
}

const TYPE_LABELS: Readonly<Record<SourceType, string>> = {
  'stremio-addon': 'Stremio addon',
  'torrent-provider': 'Torrent source',
  'stream-provider': 'Streaming source',
  package: 'Package',
}

export function entryTypeLabel(entry: Pick<StoreEntry, 'kind' | 'sourceType'>): string {
  if (entry.kind === 'source') return entry.sourceType ? TYPE_LABELS[entry.sourceType] : 'Source'
  if (entry.kind === 'theme') return 'Theme'
  return entry.kind === 'plugin' ? 'Plugin' : 'Pack'
}

export function filterStoreEntries(
  entries: readonly StoreEntry[],
  filter: StoreFilter,
  isInstalled: (entry: StoreEntry) => boolean,
): StoreEntry[] {
  const query = filter.query.trim().toLocaleLowerCase()
  const matches = entries.filter((entry) =>
    (filter.storeIds === 'all' || filter.storeIds.includes(entry.storeId))
    && (filter.kind === 'all' || entry.kind === filter.kind)
    && (filter.sourceType === 'all' || entry.sourceType === filter.sourceType)
    && (filter.language === 'all' || entry.languages.includes(filter.language))
    && (filter.content === 'all' || entry.content.includes(filter.content))
    && (!filter.withoutDebrid || !entry.requiresDebrid)
    && (filter.showAdult || !entry.nsfw)
    && (!filter.installedOnly || isInstalled(entry))
    && (!query || [entry.name, entry.id, entry.author, entry.description]
      .some((part) => part?.toLocaleLowerCase().includes(query))))
  return matches.sort((left, right) => {
    if (filter.sort === 'popular') {
      const difference = (right.popularity ?? -1) - (left.popularity ?? -1)
      if (difference) return difference
    }
    if (filter.sort === 'updated') {
      const difference = (right.updatedAt ?? '').localeCompare(left.updatedAt ?? '')
      if (difference) return difference
    }
    return left.name.localeCompare(right.name)
  })
}

export function storeLanguages(entries: readonly StoreEntry[]): string[] {
  return [...new Set(entries.flatMap((entry) => entry.languages))].sort()
}
