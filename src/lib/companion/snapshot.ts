import type { Client } from '@urql/core'
import { get } from 'svelte/store'
import { searchQuery, searchVariables } from '$lib/anilist/detail-queries'
import { heroQuery, heroVars, homeSections, pageQuery } from '$lib/anilist/queries'
import { resumeEp } from '$lib/anilist/media'
import type { Media } from '$lib/anilist/types'
import { getEpisodeMeta } from '$lib/anizip'
import { CONTINUE_HOME_ROW } from '$lib/catalog/home-options'
import { catalogHomeLayouts, resolveCatalogHomeRows } from '$lib/catalog/home-layout'
import { loadCatalogProvider } from '$lib/catalog/registry'
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

/** Enrich one TV title on demand instead of making every home snapshot carry an entire episode
 * library. AniZip is already the client's canonical episode-metadata source, so the TV remains a
 * presentation/playback receiver rather than developing a second resolver or metadata stack. */
export async function createCompanionDetails(
  media: CompanionMedia,
  spoilersHidden = get(hideSpoilers),
): Promise<CompanionMedia> {
  const counts = media.seasonEpisodeCounts ?? []
  const total = episodeCount(media)
  if (!total) return media

  const watchedThrough = Math.max(0, (media.episode ?? 1) - 1)
  const anilistId = media.ref.provider === 'anilist' ? Number(media.ref.id) : 0
  let aniZip: Awaited<ReturnType<typeof getEpisodeMeta>> = {}
  if (anilistId > 0 && Number.isSafeInteger(anilistId)) {
    aniZip = await getEpisodeMeta(anilistId, watchedThrough).catch(() => ({}))
  }
  const supplied = new Map((media.episodes ?? []).map((episode) => [`${episode.season}:${episode.episode}`, episode]))
  let absolute = 0
  const episodes: CompanionEpisode[] = counts.flatMap((rawCount, seasonIndex) => {
    const count = Math.max(0, Math.floor(rawCount))
    const season = counts.length === 1 && media.season ? media.season : seasonIndex + 1
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
        progress: existing?.progress ?? (watched ? 1 : absolute === media.episode ? media.episodeProgress : undefined),
        watched,
        spoiler,
      }
    })
  })
  return { ...media, episodes }
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
  return visible.flatMap((row): CompanionHomeRow[] => {
    if (!row.enabled || row.id === CONTINUE_HOME_ROW.id) return []
    const section = sections.get(row.id)
    const items = section?.media.slice(0, 30).map((media, index) => companionMedia(media, {
      placement: media.featuredRank ? undefined : {
        label: section?.title ?? row.title,
        position: index + 1,
        kind: row.id === 'recommendations' ? 'recommendation' : 'catalog',
      },
    })) ?? []
    return items.length ? [{ id: row.id, title: section?.title ?? row.title, kind: 'catalog', items }] : []
  })
}

async function legacyHome(client: QueryClient): Promise<CatalogHome> {
  const now = new Date()
  const configured = resolveCatalogHomeRows('anilist', [
    CONTINUE_HOME_ROW,
    ...homeSections(now).map((section) => ({ id: section.key, title: section.title })),
  ], get(catalogHomeLayouts)).filter((row) => row.enabled && row.id !== CONTINUE_HOME_ROW.id)
  const sectionById = new Map(homeSections(now).map((section) => [section.key, section]))
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

async function selectedHome(client: QueryClient, screen: CatalogScreen, provider: CatalogSelection): Promise<CatalogHome> {
  const load = async (selection: Exclude<CatalogSelection, 'auto' | 'anilist'>) => {
    const selected = await loadCatalogProvider(selection)
    return selected.home ? selected.home() : { hero: [], sections: [] }
  }
  if (screen === 'merged') {
    // Merged Home has independent row selection in the client. Until every selected provider has
    // completed, its existing rendered/cache path can publish a richer snapshot; this baseline
    // deliberately uses the active provider rather than reimplementing merged-provider arbitration.
    return provider === 'auto' || provider === 'anilist' ? legacyHome(client) : load(provider)
  }
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
  const layoutScreen = screen === 'merged' ? active : screen
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

export async function createCompanionSearch(client: QueryClient, query: string): Promise<ReturnType<typeof companionMedia>[]> {
  const normalized = query.trim().slice(0, 80)
  if (!normalized) return []
  const screen = get(catalogScreen)
  let media: Media[] = []
  if (screen === 'merged') {
    media = (await searchMergedCatalogs(get(catalogProviders), normalized, 1)).media
  } else if (screen === 'auto' || screen === 'anilist') {
    const response = await client.query<{ Page?: { media?: Media[] } }>(searchQuery(), {
      ...searchVariables({ search: normalized }),
      page: 1,
      perPage: 30,
    }, { requestPolicy: 'network-only' }).toPromise()
    if (response.error) throw response.error
    media = response.data?.Page?.media ?? []
  } else {
    const provider = await loadCatalogProvider(screen)
    media = (await provider.search({ query: normalized, page: 1, type: 'all', sort: 'popular' })).media
  }
  return media.slice(0, 40).map((item) => companionMedia(item, {
    placement: { label: `Search results for ${normalized}`, kind: 'catalog' },
  }))
}
