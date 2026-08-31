import type {
  CompanionEpisode,
  CompanionHomeSnapshot,
  CompanionMedia,
} from '../types'

export interface CatalogCollections {
  search: CompanionMedia[]
  trending: CompanionMedia[]
  series: CompanionMedia[]
  movies: CompanionMedia[]
  myList: CompanionMedia[]
}

function mediaKey(media: CompanionMedia): string {
  return `${media.ref.provider}:${media.ref.type}:${media.ref.id}`
}

export function uniqueMedia(items: CompanionMedia[]): CompanionMedia[] {
  const seen = new Set<string>()
  return items.filter((item) => {
    const key = mediaKey(item)
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

export function catalogCollections(snapshot: CompanionHomeSnapshot): CatalogCollections {
  const rowItems = uniqueMedia(snapshot.rows.reduce<CompanionMedia[]>((items, row) => items.concat(row.items), []))
  const search = uniqueMedia(snapshot.views?.search ?? rowItems)
  const rankedRows = snapshot.rows.filter((row) => /trending|popular|top\s*10|top rated/i.test(`${row.id} ${row.title}`))
  const rankedItems = rowItems.filter((item) => item.placement?.kind === 'ranking')
  const trending = uniqueMedia(snapshot.views?.trending ?? rankedRows.reduce<CompanionMedia[]>((items, row) => items.concat(row.items), []).concat(rankedItems))
    .sort((left, right) => (left.placement?.position ?? Number.MAX_SAFE_INTEGER) - (right.placement?.position ?? Number.MAX_SAFE_INTEGER))
  return {
    search,
    trending,
    series: uniqueMedia(snapshot.views?.series ?? search.filter((item) => item.ref.type !== 'movie')),
    movies: uniqueMedia(snapshot.views?.movies ?? search.filter((item) => item.ref.type === 'movie')),
    myList: uniqueMedia(snapshot.views?.myList ?? search.filter((item) => item.inMyList === true)),
  }
}

export function episodeCountsFor(media: CompanionMedia): number[] {
  const supplied = media.seasonEpisodeCounts
    ?.map((count) => Number.isFinite(count) ? Math.min(9999, Math.floor(count)) : 0)
    .filter((count) => count > 0)
  if (supplied?.length) return supplied
  if (!media.episodes?.length) return []
  const seasons = new Map<number, number>()
  media.episodes.forEach((episode) => {
    if (!Number.isFinite(episode.season) || !Number.isFinite(episode.episode) || episode.episode < 1) return
    seasons.set(episode.season, Math.max(seasons.get(episode.season) ?? 0, Math.floor(episode.episode)))
  })
  return [...seasons.entries()].sort(([left], [right]) => left - right).map(([, count]) => count)
}

export function seasonNumberFor(media: CompanionMedia, seasonIndex: number, seasonCounts: number[]): number {
  if (media.seasonLabels?.[seasonIndex]) {
    const parsed = Number(media.seasonLabels[seasonIndex].match(/\d+/)?.[0])
    if (Number.isFinite(parsed) && parsed > 0) return parsed
  }
  const episodeSeasons = [...new Set(media.episodes?.map((episode) => episode.season) ?? [])].sort((left, right) => left - right)
  if (episodeSeasons[seasonIndex]) return episodeSeasons[seasonIndex]
  return seasonCounts.length === 1 && media.season ? media.season : seasonIndex + 1
}

export function episodeDetailsFor(media: CompanionMedia, seasonIndex: number, seasonCounts: number[]): CompanionEpisode[] {
  const seasonNumber = seasonNumberFor(media, seasonIndex, seasonCounts)
  const episodeCount = seasonCounts[seasonIndex] ?? 0
  if (!episodeCount) return []
  const supplied = new Map(
    media.episodes
      ?.filter((episode) => episode.season === seasonNumber)
      .map((episode) => [episode.episode, episode]) ?? [],
  )
  return Array.from({ length: episodeCount }, (_, index) => supplied.get(index + 1) ?? {
    season: seasonNumber,
    episode: index + 1,
    runtimeMinutes: media.episodeRuntimeMinutes,
  })
}
