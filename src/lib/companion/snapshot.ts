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
// Leave headroom under both the 512 KiB LAN relay cap and Cloudflare sync's 384 KiB plaintext cap.
export const COMPANION_SNAPSHOT_TARGET_BYTES = 352 * 1024
let cached: { key: string; at: number; snapshot: CompanionHomeSnapshot } | null = null
const companionTitleLogoRequests = new Map<string, Promise<string | undefined>>()

function snapshotBytes(snapshot: CompanionHomeSnapshot): number {
  return new TextEncoder().encode(JSON.stringify(snapshot)).byteLength
}

function compactHomeMedia(media: CompanionMedia, keepDescription = true): CompanionMedia {
  const { episodes: _episodes, relations: _relations, recommendations: _recommendations, ...summary } = media
  return {
    ...summary,
    description: keepDescription ? summary.description?.slice(0, 520) : undefined,
  }
}

/** Home snapshots are transported through a deliberately bounded local relay. All catalogue
 * collections can be derived from rows on the TV, while episodes/relations/recommendations are
 * fetched when a title opens, so repeating those objects in the initial payload only makes pairing
 * fragile. Retain useful breadth under a conservative budget and degrade row depth before rows. */
export function compactCompanionSnapshot(
  snapshot: CompanionHomeSnapshot,
  targetBytes = COMPANION_SNAPSHOT_TARGET_BYTES,
): CompanionHomeSnapshot {
  const { views: _views, ...base } = snapshot
  const rows = snapshot.rows.map((row) => ({
    ...row,
    items: row.items.map((item) => compactHomeMedia(item)),
  })).filter((row) => row.items.length)
  let result: CompanionHomeSnapshot = {
    ...base,
    hero: snapshot.hero ? compactHomeMedia(snapshot.hero) : undefined,
    rows,
  }
  if (snapshotBytes(result) <= targetBytes) return result

  // Keep Continue Watching broader because it is personal state; catalogue shelves retain at
  // least eight useful choices before an entire low-priority shelf is considered for removal.
  const floors = rows.map((row) => Math.min(row.items.length, row.kind === 'continue' ? 12 : 8))
  while (snapshotBytes(result) > targetBytes) {
    let reduced = false
    for (let index = rows.length - 1; index >= 0; index -= 1) {
      if (rows[index].items.length <= floors[index]) continue
      rows[index].items.pop()
      reduced = true
    }
    if (!reduced) break
  }
  if (snapshotBytes(result) <= targetBytes) return result

  // Descriptions are visible presentation data, but title art and navigation must win if an
  // unusually large number of shelves is configured. Full copy returns via detail prefetch.
  result = {
    ...result,
    hero: result.hero ? compactHomeMedia(result.hero, false) : undefined,
    rows: rows.map((row) => ({ ...row, items: row.items.map((item) => compactHomeMedia(item, false)) })),
  }
  if (snapshotBytes(result) <= targetBytes) return result

  // Only pathological custom layouts reach this fallback. Preserve Continue Watching and the
  // highest-priority authored shelves rather than failing the entire pairing transaction.
  while (result.rows.length > 1 && snapshotBytes(result) > targetBytes) result.rows.pop()
  if (snapshotBytes(result) <= targetBytes) return result
  while (result.rows[0]?.items.length > 1 && snapshotBytes(result) > targetBytes) result.rows[0].items.pop()
  return result
}

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

async function detailedCatalogMedia(media: CompanionMedia, client?: QueryClient, presentationOnly = false): Promise<Media | null> {
  if (media.ref.provider === 'anilist') {
    const id = Number(media.ref.id)
    if (!client || !Number.isSafeInteger(id) || id < 1) return null
    const result = await client.query<{ Media?: Media }>(MEDIA_BY_ID, { id, withPreview: true }, { requestPolicy: 'network-only' }).toPromise()
    if (result.error) throw result.error
    return result.data?.Media ?? null
  }
  if (!['kitsu', 'tmdb', 'stremio', 'jvm'].includes(media.ref.provider)) return null
  const provider = await loadCatalogProvider(media.ref.provider as 'kitsu' | 'tmdb' | 'stremio' | 'jvm')
  if (presentationOnly && provider.presentation) return provider.presentation(media.ref)
  return provider.detail(media.ref)
}

function comparableTitle(value?: string): string {
  return (value ?? '').toLocaleLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

function comparableTitles(media: Media): Set<string> {
  return new Set([
    media.title.english,
    media.title.userPreferred,
    media.title.romaji,
    media.title.native,
  ].map(comparableTitle).filter(Boolean))
}

function titleLogoQueries(media: Media, series: boolean): Array<{ title: string; base: boolean }> {
  const titles = [media.title.english, media.title.userPreferred, media.title.romaji]
    .map((title) => title?.trim())
    .filter((title): title is string => Boolean(title))
  if (!series) return [...new Set(titles)].map((title) => ({ title, base: false }))
  const bases = titles.flatMap((title) => {
    const values = [
      title.replace(/\s+(?:season|part|cour)\s+(?:\d+|[ivxlcdm]+)(?:\s*[-:–—].*)?$/i, '').trim(),
      title.replace(/\s+[ivxlcdm]+$/i, '').trim(),
    ]
    const colon = title.indexOf(':')
    if (colon >= 4) values.push(title.slice(0, colon).trim())
    return values.filter((value) => value && value !== title)
  })
  const queries = new Map<string, { title: string; base: boolean }>()
  for (const title of titles) queries.set(title, { title, base: false })
  for (const title of bases) if (!queries.has(title)) queries.set(title, { title, base: true })
  return [...queries.values()]
}

/** AniList/Kitsu do not expose clear-logo artwork. When the viewer has configured TMDB, bridge an
 * exact title/year match through its lightweight presentation endpoint. Exact matching matters:
 * using the first fuzzy search result is how an unrelated service/network mark can appear where a
 * programme logo belongs. */
function companionTitleLogo(media: CompanionMedia, detailed: Media): Promise<string | undefined> {
  if (detailed.logoImage || media.ref.provider === 'tmdb') return Promise.resolve(detailed.logoImage)
  const key = `${media.ref.provider}:${media.ref.type}:${media.ref.id}`
  const existing = companionTitleLogoRequests.get(key)
  if (existing) return existing
  const request = (async () => {
    const tmdb = await loadCatalogProvider('tmdb')
    if (!tmdb.presentation) return undefined
    const sourceYear = detailed.seasonYear ?? detailed.startDate?.year
    const type = detailed.format === 'MOVIE' || detailed.type === 'MOVIE' ? 'movie' as const : 'series' as const
    const sourceTitles = comparableTitles(detailed)
    const queries = titleLogoQueries(detailed, type === 'series')
    for (const { title: query, base: baseQuery } of queries) {
      const results = await tmdb.search({
        query,
        type,
        // TMDB groups anime seasons under their original series year. A deliberately simplified
        // base-title retry must therefore omit the sequel's AniList year.
        year: baseQuery ? undefined : sourceYear,
        withPoster: true,
      })
      const queryKey = comparableTitle(query)
      const match = results.media.find((candidate) => {
        const candidateTitles = comparableTitles(candidate)
        if (baseQuery) return candidateTitles.has(queryKey)
        const candidateYear = candidate.seasonYear ?? candidate.startDate?.year
        if (sourceYear && candidateYear && sourceYear !== candidateYear) return false
        return [...sourceTitles].some((title) => candidateTitles.has(title))
      })
      if (!match?.catalog) continue
      const logo = (await tmdb.presentation(match.catalog))?.logoImage
      if (logo) return logo
      // The best exact result had no clear logo. Fuzzier fallbacks must not replace it with art
      // from a different programme merely because that programme happens to have an image.
      return undefined
    }
    return undefined
  })().catch((error) => {
    companionTitleLogoRequests.delete(key)
    throw error
  })
  companionTitleLogoRequests.set(key, request)
  return request
}

/** Resolve the next TV tiles without making their logos wait for episode libraries or optional
 * third-party ratings. Opening a title still requests the full createCompanionDetails payload. */
export async function createCompanionPresentation(
  media: CompanionMedia,
  client?: QueryClient,
): Promise<CompanionMedia> {
  const detailed = await detailedCatalogMedia(media, client, true).catch(() => null)
  if (!detailed) return media
  const logoImage = await companionTitleLogo(media, detailed).catch(() => detailed.logoImage)
  const enriched = companionMedia(logoImage ? { ...detailed, logoImage } : detailed, {
    progress: media.progress,
    episode: media.episode,
    episodeTitle: media.episodeTitle,
    episodeImage: media.episodeImage,
    season: media.season,
    episodeProgress: media.episodeProgress,
    episodeRuntimeMinutes: media.episodeRuntimeMinutes,
    placement: media.placement,
  })
  return {
    ...media,
    ...enriched,
    inMyList: media.inMyList ?? enriched.inMyList,
    episodes: media.episodes,
    seasonEpisodeCounts: media.seasonEpisodeCounts ?? enriched.seasonEpisodeCounts,
    seasonLabels: media.seasonLabels ?? enriched.seasonLabels,
  }
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
  const revision = `${now.toString(36)}-${rows.reduce((count, row) => count + row.items.length, 0).toString(36)}`
  const snapshot = compactCompanionSnapshot({
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
    // The TV derives Search/Trending/Series/Movies/My List from these same rows. Do not serialize
    // five more copies of the catalogue into the pairing payload.
  })
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
