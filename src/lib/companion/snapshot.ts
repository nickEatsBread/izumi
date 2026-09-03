import type { Client } from '@urql/core'
import { get } from 'svelte/store'
import { MEDIA_BY_ID } from '$lib/anilist/detail-queries'
import { heroQuery, heroVars, homeSections, pageQuery } from '$lib/anilist/queries'
import { resumeEp } from '$lib/anilist/media'
import type { Media } from '$lib/anilist/types'
import { getEpisodeMeta } from '$lib/anizip'
import { CONTINUE_HOME_ROW } from '$lib/catalog/home-options'
import { catalogHomeLayouts, resolveCatalogHomeRows } from '$lib/catalog/home-layout'
import {
  decodeMergedCatalogHomeRowId,
  loadCatalogProvider,
  mergedCatalogHomeRowId,
  mergedCatalogHomeRowOptions,
} from '$lib/catalog/registry'
import { searchMergedCatalogs } from '$lib/catalog/merged-search'
import type { CatalogHome } from '$lib/catalog/types'
import { continueWatching, filterContinueWatching, type CwEntry } from '$lib/player/continue-watching'
import { positions, positionPercent, progressKey } from '$lib/player/progress'
import {
  catalogLabel,
  catalogProvider,
  catalogProviders,
  catalogScreen,
  enabledCatalogScreens,
  continueWatchingCatalogScope,
  mergedCatalogProviders,
  type CatalogSelection,
  type CatalogScreen,
} from '$lib/settings/catalog'
import { hideSpoilers } from '$lib/settings/ui'
import {
  companionMedia,
  COMPANION_PROTOCOL,
  type CompanionEpisode,
  type CompanionHomeRow,
  type CompanionHomeSnapshot,
  type CompanionMedia,
} from './protocol'

type QueryClient = Pick<Client, 'query'>
const SNAPSHOT_CACHE_MS = 60_000
const EPISODE_PREVIEW_LIMIT = 12
let cached: { key: string; at: number; snapshot: CompanionHomeSnapshot } | null = null

function episodeCount(media: CompanionMedia): number {
  return (media.seasonEpisodeCounts ?? []).reduce((total, count) => total + Math.max(0, Math.floor(count)), 0)
}

function episodeLibrary(media: Media, source: CompanionMedia, spoilersHidden: boolean): CompanionEpisode[] {
  const watchedThrough = Math.max(0, (source.episode ?? 1) - 1)
  return (media.videos ?? []).flatMap((video) => {
    const absolute = Math.floor(video.number)
    const episode = Math.floor(video.episode ?? video.number)
    const season = Math.floor(video.season ?? source.season ?? media.seasonNumber ?? 1)
    if (absolute < 1 || episode < 1 || season < 0) return []
    const watched = absolute <= watchedThrough
    return [{
      season,
      episode,
      title: video.title,
      description: video.overview,
      image: video.thumbnail,
      runtimeMinutes: media.duration ? Math.max(1, Math.round(media.duration)) : undefined,
      progress: watched ? 1 : absolute === source.episode ? source.episodeProgress : undefined,
      watched,
      spoiler: spoilersHidden && !watched,
    }]
  })
}

function seasonSummary(episodes: CompanionEpisode[]): { counts?: number[]; labels?: string[] } {
  if (!episodes.length) return {}
  const seasons = new Map<number, number>()
  for (const episode of episodes) seasons.set(episode.season, Math.max(seasons.get(episode.season) ?? 0, episode.episode))
  const ordered = [...seasons.entries()].sort(([left], [right]) => left - right)
  return {
    counts: ordered.map(([, count]) => count),
    labels: ordered.map(([season]) => season === 0 ? 'Specials' : `Season ${season}`),
  }
}

async function detailedCatalogMedia(media: CompanionMedia, client?: QueryClient): Promise<Media | null> {
  if (media.ref.provider === 'anilist') {
    const id = Number(media.ref.id)
    if (!client || !Number.isSafeInteger(id) || id < 1) return null
    const result = await client.query<{ Media?: Media }>(MEDIA_BY_ID, { id, withPreview: true }, { requestPolicy: 'network-only' }).toPromise()
    if (result.error) throw result.error
    return result.data?.Media ?? null
  }
  if (!['kitsu', 'tmdb', 'stremio', 'jvm'].includes(media.ref.provider)) return null
  const provider = await loadCatalogProvider(media.ref.provider as 'kitsu' | 'tmdb' | 'stremio' | 'jvm')
  return provider.detail(media.ref)
}

/** Load the complete playback model without routing the linked device to a detail screen. */
export async function loadCompanionPlaybackMedia(media: CompanionMedia, client?: QueryClient): Promise<Media> {
  const detailed = await detailedCatalogMedia(media, client)
  if (!detailed) throw new Error('The linked device could not load this title for playback.')
  return detailed
}

/** Enrich one TV title on demand instead of making every home snapshot carry an entire episode
 * library. AniZip is already the client's canonical episode-metadata source, so the TV remains a
 * presentation/playback receiver rather than developing a second resolver or metadata stack. */
export async function createCompanionDetails(
  media: CompanionMedia,
  spoilersHidden = get(hideSpoilers),
  client?: QueryClient,
): Promise<CompanionMedia> {
  const detailed = await detailedCatalogMedia(media, client).catch(() => null)
  const providerEpisodes = detailed ? episodeLibrary(detailed, media, spoilersHidden) : []
  const summary = seasonSummary(providerEpisodes)
  const enriched = detailed ? companionMedia(detailed, {
    progress: media.progress,
    episode: media.episode,
    episodeTitle: media.episodeTitle,
    episodeImage: media.episodeImage,
    season: media.season,
    episodeProgress: media.episodeProgress,
    episodeRuntimeMinutes: media.episodeRuntimeMinutes,
    episodes: providerEpisodes.length ? providerEpisodes : media.episodes,
    placement: media.placement,
  }) : media
  const working: CompanionMedia = {
    ...media,
    ...enriched,
    inMyList: media.inMyList ?? enriched.inMyList,
    episodes: providerEpisodes.length ? providerEpisodes : media.episodes,
    seasonEpisodeCounts: summary.counts ?? enriched.seasonEpisodeCounts ?? media.seasonEpisodeCounts,
    seasonLabels: summary.labels ?? media.seasonLabels,
  }
  const counts = working.seasonEpisodeCounts ?? []
  const total = episodeCount(working)
  if (!total) return working

  const watchedThrough = Math.max(0, (working.episode ?? 1) - 1)
  const anilistId = working.ref.provider === 'anilist'
    ? Number(working.ref.id)
    : Number(detailed?.externalIds?.anilist ?? 0)
  let aniZip: Awaited<ReturnType<typeof getEpisodeMeta>> = {}
  if (anilistId > 0 && Number.isSafeInteger(anilistId)) {
    aniZip = await getEpisodeMeta(anilistId, watchedThrough).catch(() => ({}))
  }
  const supplied = new Map((working.episodes ?? []).map((episode) => [`${episode.season}:${episode.episode}`, episode]))
  const suppliedSeasons = [...new Set((working.episodes ?? []).map((episode) => episode.season))].sort((left, right) => left - right)
  let absolute = 0
  const episodes: CompanionEpisode[] = counts.flatMap((rawCount, seasonIndex) => {
    const count = Math.max(0, Math.floor(rawCount))
    const labelledSeason = Number(working.seasonLabels?.[seasonIndex]?.match(/\d+/)?.[0])
    const season = suppliedSeasons[seasonIndex] ?? (Number.isFinite(labelledSeason)
      ? labelledSeason
      : counts.length === 1 && working.season ? working.season : seasonIndex + 1)
    return Array.from({ length: count }, (_, episodeIndex) => {
      absolute += 1
      const episode = episodeIndex + 1
      const existing = supplied.get(`${season}:${episode}`)
      const meta = aniZip[absolute]
      const watched = existing?.watched ?? absolute <= watchedThrough
      const spoiler = spoilersHidden && !watched
      return {
        season,
        episode,
        title: existing?.title ?? meta?.title,
        description: existing?.description ?? meta?.overview,
        image: existing?.image ?? meta?.image,
        runtimeMinutes: existing?.runtimeMinutes ?? (meta?.runtime ? Math.max(1, Math.round(meta.runtime)) : undefined),
        progress: existing?.progress ?? (watched ? 1 : absolute === working.episode ? working.episodeProgress : undefined),
        watched,
        spoiler,
      }
    })
  })
  return { ...working, episodes }
}

async function continueRow(entries: CwEntry[], active: CatalogSelection, all: boolean): Promise<CompanionHomeRow | null> {
  const filtered = filterContinueWatching(entries, active, all ? 'all' : get(continueWatchingCatalogScope))
  const playbackPositions = get(positions)
  const items = await Promise.all(filtered.slice(0, 30).map(async (entry, index) => {
    const base = companionMedia(entry.media, {
      watched: entry.progress,
      placement: { label: 'Continue Watching', kind: 'continue' },
    })
    const episode = base.episode ?? 1
    const savedPosition = playbackPositions[progressKey(entry.media.id, episode)]
    const provider = entry.media.catalog?.provider
    const canLoadAniListEpisode = index < EPISODE_PREVIEW_LIMIT
      && entry.media.id > 0
      && (!provider || provider === 'anilist')
    const episodeMetadata = canLoadAniListEpisode
      ? await getEpisodeMeta(entry.media.id, episode).catch(() => undefined)
      : undefined
    const episodeMeta = episodeMetadata?.[episode]
    const runtime = episodeMeta?.runtime ?? (savedPosition?.dur ? savedPosition.dur / 60 : undefined)
    return {
      ...base,
      episodeTitle: episodeMeta?.title,
      episodeImage: episodeMeta?.image,
      season: episodeMeta?.season,
      episodeProgress: savedPosition ? positionPercent(savedPosition) : undefined,
      episodeRuntimeMinutes: runtime ? Math.max(1, Math.round(runtime)) : undefined,
    }
  }))
  return items.length ? { id: 'continue', title: 'Continue Watching', kind: 'continue', items } : null
}

function catalogRows(screen: CatalogScreen, home: CatalogHome): CompanionHomeRow[] {
  const options = [CONTINUE_HOME_ROW, ...home.sections.map((section) => ({ id: section.id, title: section.title }))]
  const visible = resolveCatalogHomeRows(screen, options, get(catalogHomeLayouts))
  const sections = new Map(home.sections.map((section) => [section.id, section]))
  const featured = new Map(home.hero.map((media) => [
    `${media.catalog?.provider}:${media.catalog?.type}:${media.catalog?.id ?? media.id}`,
    media,
  ]))
  return visible.flatMap((row): CompanionHomeRow[] => {
    if (!row.enabled || row.id === CONTINUE_HOME_ROW.id) return []
    const section = sections.get(row.id)
    const items = section?.media.slice(0, 30).map((media, index) => {
      const highlight = featured.get(`${media.catalog?.provider}:${media.catalog?.type}:${media.catalog?.id ?? media.id}`)
      const displayMedia = highlight ? { ...media, ...highlight, featuredRank: media.featuredRank ?? highlight.featuredRank } : media
      return companionMedia(displayMedia, {
        placement: displayMedia.featuredRank ? undefined : {
          label: section?.title ?? row.title,
          position: index + 1,
          kind: row.id === 'recommendations' ? 'recommendation' : 'catalog',
        },
      })
    }) ?? []
    return items.length ? [{ id: row.id, title: section?.title ?? row.title, kind: 'catalog', items }] : []
  })
}

async function legacyHome(client: QueryClient, requestedRowIds?: string[]): Promise<CatalogHome> {
  const now = new Date()
  const availableSections = homeSections(now)
  const sectionById = new Map(availableSections.map((section) => [section.key, section]))
  const configured = requestedRowIds
    ? requestedRowIds.flatMap((id) => {
        const section = sectionById.get(id)
        return section ? [{ id, title: section.title }] : []
      })
    : resolveCatalogHomeRows('anilist', [
        CONTINUE_HOME_ROW,
        ...availableSections.map((section) => ({ id: section.key, title: section.title })),
      ], get(catalogHomeLayouts)).filter((row) => row.enabled && row.id !== CONTINUE_HOME_ROW.id)
  const [heroResult, ...sectionResults] = await Promise.allSettled([
    client.query<{ Page?: { media?: Media[] } }>(heroQuery(), heroVars(now), { requestPolicy: 'cache-first' }).toPromise(),
    ...configured.map((row) => {
      const section = sectionById.get(row.id)
      return section
        ? client.query<{ Page?: { media?: Media[] } }>(pageQuery(), { perPage: 20, withPreview: true, ...section.vars }, { requestPolicy: 'cache-first' }).toPromise()
        : Promise.resolve(null)
    }),
  ])
  const hero = (heroResult.status === 'fulfilled' ? heroResult.value.data?.Page?.media ?? [] : [])
    .map((media, index) => ({
      ...media,
      featuredRank: { position: index + 1, label: 'Top Rated This Season' },
    }))
  const sections = configured.flatMap((row, index) => {
    const result = sectionResults[index]
    const media = result?.status === 'fulfilled' && result.value ? result.value.data?.Page?.media ?? [] : []
    return media.length ? [{ id: row.id, title: row.title, media }] : []
  })
  return { hero, sections }
}

async function mergedHome(client: QueryClient): Promise<CatalogHome> {
  const selections = mergedCatalogProviders(get(catalogProviders))
  const options = await mergedCatalogHomeRowOptions(selections)
  const visible = resolveCatalogHomeRows('merged', options, get(catalogHomeLayouts))
    .filter((row) => row.enabled && row.id !== CONTINUE_HOME_ROW.id)
  const requested = new Map<CatalogSelection, string[]>()
  for (const row of visible) {
    const decoded = decodeMergedCatalogHomeRowId(row.id)
    if (!decoded) continue
    requested.set(decoded.selection, [...(requested.get(decoded.selection) ?? []), decoded.rowId])
  }

  const batches = await Promise.allSettled(selections.map(async (selection) => {
    const rowIds = requested.get(selection) ?? []
    if (!rowIds.length) return { selection, home: { hero: [], sections: [] } as CatalogHome }
    const home = selection === 'auto' || selection === 'anilist'
      ? await legacyHome(client, rowIds)
      : await (await loadCatalogProvider(selection)).home(undefined, rowIds)
    return { selection, home }
  }))
  const homes = batches.flatMap((batch) => batch.status === 'fulfilled' ? [batch.value] : [])
  const maximumHeroLength = Math.max(0, ...homes.map(({ home }) => home.hero.length))
  const hero = Array.from({ length: maximumHeroLength }, (_, index) =>
    homes.flatMap(({ home }) => home.hero[index] ?? [])).flat().slice(0, 15)
  const sections = homes.flatMap(({ selection, home }) => home.sections.map((section) => ({
    ...section,
    id: mergedCatalogHomeRowId(selection, section.id),
    title: `${section.title} · ${catalogLabel(selection)}`,
  })))
  return { hero, sections }
}

async function selectedHome(client: QueryClient, screen: CatalogScreen, provider: CatalogSelection): Promise<CatalogHome> {
  const load = async (selection: Exclude<CatalogSelection, 'auto' | 'anilist'>) => {
    const selected = await loadCatalogProvider(selection)
    return selected.home ? selected.home() : { hero: [], sections: [] }
  }
  if (screen === 'merged') return mergedHome(client)
  return screen === 'auto' || screen === 'anilist' ? legacyHome(client) : load(screen)
}

export async function createCompanionSnapshot(client: QueryClient, now = Date.now()): Promise<CompanionHomeSnapshot> {
  const screen = get(catalogScreen)
  const active = get(catalogProvider)
  const availableScreens = get(enabledCatalogScreens)
  const watchingEntries = get(continueWatching)
  const playbackPositions = get(positions)
  const cacheKey = JSON.stringify({
    screen,
    active,
    availableScreens,
    layouts: get(catalogHomeLayouts),
    watching: watchingEntries.slice(0, 30).map((entry) => [entry.media.id, entry.progress, entry.updatedAt]),
    positions: watchingEntries.slice(0, 30).map((entry) => {
      const episode = resumeEp(entry.media, entry.progress)
      const saved = playbackPositions[progressKey(entry.media.id, episode)]
      return [entry.media.id, episode, saved?.pos, saved?.dur, saved?.updatedAt]
    }),
    spoilersHidden: get(hideSpoilers),
  })
  if (cached?.key === cacheKey && now - cached.at < SNAPSHOT_CACHE_MS) return cached.snapshot
  const home = await selectedHome(client, screen, active)
  const layoutScreen = screen
  const watching = await continueRow(watchingEntries, active, screen === 'merged')
  const rows = catalogRows(layoutScreen, home)
  const continueEnabled = resolveCatalogHomeRows(layoutScreen, [CONTINUE_HOME_ROW], get(catalogHomeLayouts))[0]?.enabled ?? true
  if (watching && continueEnabled) rows.unshift(watching)
  const featured = home.hero[0] ? companionMedia(home.hero[0]) : undefined
  const matchingRowItem = featured && rows.flatMap((row) => row.items).find((item) =>
    item.ref.provider === featured.ref.provider && item.ref.type === featured.ref.type && item.ref.id === featured.ref.id)
  const hero = watching?.items[0] ?? (featured ? {
    ...featured,
    placement: featured.placement ?? matchingRowItem?.placement ?? {
      label: `Popular on ${catalogLabel(layoutScreen)}`,
      kind: 'catalog' as const,
    },
  } : rows[0]?.items[0])
  const allItems = rows.flatMap((row) => row.items)
    .filter((item, index, items) => items.findIndex((candidate) => candidate.ref.provider === item.ref.provider
      && candidate.ref.type === item.ref.type && candidate.ref.id === item.ref.id) === index)
  const rankedRows = rows.filter((row) => /trending|popular|top\s*10|top rated/i.test(`${row.id} ${row.title}`))
  const rankedItems = rankedRows.flatMap((row) => row.items)
    .concat(allItems.filter((item) => item.placement?.kind === 'ranking'))
    .filter((item, index, items) => items.findIndex((candidate) => candidate.ref.provider === item.ref.provider
      && candidate.ref.type === item.ref.type && candidate.ref.id === item.ref.id) === index)
  const revision = `${now.toString(36)}-${rows.reduce((count, row) => count + row.items.length, 0).toString(36)}`
  const snapshot: CompanionHomeSnapshot = {
    app: 'izumi',
    kind: 'companion-home',
    version: COMPANION_PROTOCOL,
    revision,
    generatedAt: now,
    catalog: {
      screen,
      label: catalogLabel(screen),
      options: availableScreens.map((option) => ({ screen: option, label: catalogLabel(option) })),
    },
    spoilersHidden: get(hideSpoilers),
    hero,
    rows,
    views: {
      search: allItems,
      trending: rankedItems,
      series: allItems.filter((item) => item.ref.type !== 'movie'),
      movies: allItems.filter((item) => item.ref.type === 'movie'),
      myList: allItems.filter((item) => item.inMyList),
    },
  }
  cached = { key: cacheKey, at: now, snapshot }
  return snapshot
}

export async function createCompanionSearch(_client: QueryClient, query: string): Promise<ReturnType<typeof companionMedia>[]> {
  const normalized = query.trim().slice(0, 80)
  if (!normalized) return []
  const media = (await searchMergedCatalogs(get(catalogProviders), normalized, 1)).media
  return media.slice(0, 40).map((item) => companionMedia(item, {
    placement: { label: `Search results for ${normalized}`, kind: 'catalog' },
  }))
}
