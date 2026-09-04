// @ts-nocheck -- Wrangler validates this Worker-only runtime module; the root app checker does not
// model its provider response shapes.
// Runtime-neutral companion catalogue adapter. The full client remains the canonical rich mapper;
// this Worker boundary deliberately emits the existing compact CompanionMedia/HomeSnapshot shape.
const ANI = 'https://graphql.anilist.co'
const KITSU = 'https://kitsu.io/api/edge'
const TMDB = 'https://api.themoviedb.org/3'
const TMDB_IMAGE = 'https://image.tmdb.org/t/p'
const MAX_BYTES = 1024 * 1024

const clean = (value, maximum = 1_500) => typeof value === 'string'
  ? value.replace(/<[^>]*>/g, '').replace(/[\u0000-\u001f]/g, '').trim().slice(0, maximum) || undefined
  : undefined
const year = (value) => Number.isInteger(Number(value)) && Number(value) >= 1800 && Number(value) <= 2200 ? Number(value) : undefined
const image = (path, size = 'w780') => typeof path === 'string' && path
  ? path.startsWith('http') ? path : `${TMDB_IMAGE}/${size}${path}`
  : undefined
const mediaKind = (type) => type === 'movie' ? 'movie' : 'show'
const streamType = (type) => type === 'movie' ? 'movie' : 'series'

function fnv(value) {
  let a = 0x811c9dc5
  let b = 0x9e3779b9
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index)
    a = Math.imul(a ^ code, 0x01000193)
    b = Math.imul(b ^ code, 0x85ebca6b)
  }
  return `${(a >>> 0).toString(16).padStart(8, '0')}${(b >>> 0).toString(16).padStart(8, '0')}`
}

function normalizeBase(value) {
  const url = new URL(String(value).replace(/^stremio:\/\//i, 'https://'))
  url.pathname = url.pathname.replace(/\/manifest\.json\/?$/i, '').replace(/\/$/, '')
  url.hash = ''
  return url.toString().replace(/\/$/, '')
}

function endpoint(base, suffix) {
  const url = new URL(base)
  const search = url.search
  url.search = ''
  url.pathname = `${url.pathname.replace(/\/$/, '')}${suffix}`
  url.search = search
  return url.toString()
}

async function fetchJson(url, init = {}, timeoutMs = 9_000, fetcher = fetch) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetcher(url, {
      ...init,
      headers: { Accept: 'application/json', 'User-Agent': 'Izumi-Cloud-Catalog/1', ...(init.headers || {}) },
      signal: controller.signal,
    })
    if (!response.ok) throw new Error(`Catalogue provider returned HTTP ${response.status}.`)
    const announced = Number(response.headers.get('content-length') || 0)
    if (announced > MAX_BYTES) throw new Error('Catalogue response is too large.')
    const text = await response.text()
    if (new TextEncoder().encode(text).byteLength > MAX_BYTES) throw new Error('Catalogue response is too large.')
    return JSON.parse(text)
  } finally { clearTimeout(timer) }
}

function aniMedia(raw) {
  if (!raw?.id || raw.type && raw.type !== 'ANIME') return null
  const type = raw.format === 'MOVIE' ? 'movie' : 'anime'
  const title = clean(raw.title?.userPreferred ?? raw.title?.english ?? raw.title?.romaji, 240)
  if (!title) return null
  return {
    mediaId: Number(raw.id),
    ref: { provider: 'anilist', type, id: String(raw.id) },
    resolver: { streamType: streamType(type) },
    title,
    subtitle: clean(raw.format, 80),
    description: clean(raw.description),
    mediaKind: mediaKind(type),
    genres: Array.isArray(raw.genres) ? raw.genres.slice(0, 12).map((entry) => clean(entry, 80)).filter(Boolean) : [],
    releaseYear: year(raw.seasonYear ?? raw.startDate?.year),
    runtimeMinutes: Number(raw.duration) || undefined,
    poster: clean(raw.coverImage?.extraLarge ?? raw.coverImage?.large, 2_048),
    backdrop: clean(raw.bannerImage, 2_048),
    trailer: raw.trailer?.id ? { id: String(raw.trailer.id).slice(0, 40), site: clean(raw.trailer.site, 30) } : undefined,
    ratings: Number(raw.averageScore) > 0 ? [{ source: 'AniList', score: Number(raw.averageScore), scale: 100 }] : undefined,
    seasonEpisodeCounts: Number(raw.episodes) > 0 ? [Number(raw.episodes)] : undefined,
  }
}

const ANI_FIELDS = `id type format isAdult description(asHtml:false) duration episodes seasonYear genres averageScore bannerImage coverImage{extraLarge large} trailer{id site} title{userPreferred english romaji}`

async function aniRequest(query, variables, fetcher = fetch) {
  const value = await fetchJson(ANI, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ query, variables }),
  }, 9_000, fetcher)
  if (value.errors?.length) throw new Error(clean(value.errors[0]?.message, 240) || 'AniList catalogue failed.')
  return value.data || {}
}

async function aniDetail(id, fetcher = fetch) {
  if (!/^\d{1,12}$/.test(String(id || ''))) return null
  const data = await aniRequest(`query($id:Int){Media(id:$id,type:ANIME){${ANI_FIELDS} characters(perPage:20,sort:ROLE){edges{role node{id name{full} image{large}}}} staff(perPage:20,sort:RELEVANCE){edges{role node{id name{full} image{large}}}} relations{edges{relationType node{${ANI_FIELDS}}}} recommendations(perPage:12,sort:RATING_DESC){nodes{mediaRecommendation{${ANI_FIELDS}}}}}}`, { id: Number(id) }, fetcher)
  const raw = data.Media
  const summary = aniMedia(raw)
  if (!summary) return null
  const person = (edge, credit) => edge?.node?.id && edge?.node?.name?.full ? {
    id: String(edge.node.id), provider: 'anilist', name: clean(edge.node.name.full, 160),
    role: clean(edge.role, 160), image: clean(edge.node.image?.large, 2_048), credit,
  } : null
  return {
    summary,
    cast: (raw.characters?.edges || []).map((edge) => person(edge, 'cast')).filter(Boolean),
    crew: (raw.staff?.edges || []).map((edge) => person(edge, 'crew')).filter(Boolean),
    relations: (raw.relations?.edges || []).slice(0, 12).flatMap((edge) => {
      const media = aniMedia(edge?.node)
      return media ? [{ relationType: clean(edge.relationType, 80) || 'RELATED', media }] : []
    }),
    recommendations: (raw.recommendations?.nodes || []).slice(0, 12)
      .map((entry) => aniMedia(entry?.mediaRecommendation)).filter(Boolean),
  }
}

async function aniHome(showAdult) {
  const data = await aniRequest(`query($adult:Boolean){trending:Page(page:1,perPage:20){media(type:ANIME,sort:TRENDING_DESC,isAdult:$adult){${ANI_FIELDS}}}popular:Page(page:1,perPage:20){media(type:ANIME,sort:POPULARITY_DESC,isAdult:$adult){${ANI_FIELDS}}}rated:Page(page:1,perPage:20){media(type:ANIME,sort:SCORE_DESC,isAdult:$adult){${ANI_FIELDS}}}}`, { adult: showAdult ? null : false })
  const rows = [['trending', 'Trending now'], ['popular', 'Most popular'], ['rated', 'Highest rated']]
    .map(([id, title]) => ({ id, title, kind: 'catalog', items: (data[id]?.media || []).map(aniMedia).filter(Boolean) }))
    .filter((row) => row.items.length)
  return { rows, hero: rows[0]?.items[0] }
}

async function aniSearch(query, showAdult, genre) {
  const data = await aniRequest(`query($q:String,$genre:String,$sort:[MediaSort],$adult:Boolean){Page(page:1,perPage:40){media(type:ANIME,search:$q,genre:$genre,sort:$sort,isAdult:$adult){${ANI_FIELDS}}}}`, {
    q: query || undefined,
    genre: genre || undefined,
    sort: [query ? 'SEARCH_MATCH' : 'TRENDING_DESC'],
    adult: showAdult ? null : false,
  })
  return (data.Page?.media || []).map(aniMedia).filter(Boolean)
}

async function aniPersonMedia(person, showAdult) {
  if (!/^\d{1,12}$/.test(String(person?.id || ''))) return []
  const id = Number(person.id)
  if (person.credit === 'cast') {
    const data = await aniRequest(`query($id:Int){Character(id:$id){media(page:1,perPage:40,sort:POPULARITY_DESC){nodes{${ANI_FIELDS}}}}}`, { id })
    return (data.Character?.media?.nodes || []).filter((entry) => showAdult || entry?.isAdult !== true).map(aniMedia).filter(Boolean)
  }
  const data = await aniRequest(`query($id:Int){Staff(id:$id){staffMedia(page:1,perPage:40,sort:POPULARITY_DESC){nodes{${ANI_FIELDS}}}}}`, { id })
  return (data.Staff?.staffMedia?.nodes || []).filter((entry) => showAdult || entry?.isAdult !== true).map(aniMedia).filter(Boolean)
}

function kitsuMedia(raw) {
  const attrs = raw?.attributes
  if (!raw?.id || !attrs) return null
  const subtype = String(attrs.subtype || '').toLowerCase()
  const type = subtype === 'movie' ? 'movie' : 'anime'
  const title = clean(attrs.titles?.en ?? attrs.canonicalTitle ?? attrs.titles?.en_jp, 240)
  if (!title) return null
  return {
    ref: { provider: 'kitsu', type, id: String(raw.id) },
    resolver: { streamType: streamType(type) }, title,
    description: clean(attrs.synopsis), mediaKind: mediaKind(type),
    genres: [], releaseYear: year(String(attrs.startDate || '').slice(0, 4)),
    runtimeMinutes: Number(attrs.episodeLength) || undefined,
    poster: clean(attrs.posterImage?.original ?? attrs.posterImage?.large, 2_048),
    backdrop: clean(attrs.coverImage?.original ?? attrs.coverImage?.large, 2_048),
    ratings: Number(attrs.averageRating) > 0 ? [{ source: 'Kitsu', score: Number(attrs.averageRating), scale: 100 }] : undefined,
    seasonEpisodeCounts: Number(attrs.episodeCount) > 0 ? [Number(attrs.episodeCount)] : undefined,
  }
}

async function kitsuPage(params) {
  const url = new URL(`${KITSU}/anime`)
  url.searchParams.set('page[limit]', '20')
  for (const [key, value] of Object.entries(params)) if (value != null && value !== '') url.searchParams.set(key, String(value))
  const data = await fetchJson(url.toString())
  return (data.data || []).map(kitsuMedia).filter(Boolean)
}

async function kitsuHome() {
  const [airing, popular, rated] = await Promise.all([
    kitsuPage({ 'filter[status]': 'current', sort: '-userCount' }), kitsuPage({ sort: '-userCount' }), kitsuPage({ sort: '-averageRating' }),
  ])
  const rows = [['airing', 'Airing now', airing], ['popular', 'Most popular', popular], ['rated', 'Highest rated', rated]]
    .filter(([, , items]) => items.length).map(([id, title, items]) => ({ id, title, kind: 'catalog', items }))
  return { rows, hero: rows[0]?.items[0] }
}

function tmdbMedia(raw, forcedKind) {
  const kind = raw?.media_type === 'movie' || raw?.media_type === 'tv' ? raw.media_type : forcedKind
  if (!raw?.id || (kind !== 'movie' && kind !== 'tv')) return null
  const type = kind === 'movie' ? 'movie' : 'series'
  const title = clean(raw.title ?? raw.name ?? raw.original_title ?? raw.original_name, 240)
  if (!title) return null
  return {
    ref: { provider: 'tmdb', type, id: String(raw.id) }, resolver: { streamType: streamType(type) }, title,
    description: clean(raw.overview), mediaKind: mediaKind(type),
    releaseYear: year(String(raw.release_date ?? raw.first_air_date ?? '').slice(0, 4)),
    poster: image(raw.poster_path, 'w500'), backdrop: image(raw.backdrop_path, 'w1280'),
    ratings: Number(raw.vote_average) > 0 ? [{ source: 'TMDB', score: Number(raw.vote_average), scale: 10, votes: Number(raw.vote_count) || undefined }] : undefined,
  }
}

async function tmdbRequest(token, path, params = {}) {
  if (!token) throw new Error('TMDB is enabled but its Read Access Token is not available to the Worker.')
  const url = new URL(`${TMDB}${path}`)
  url.searchParams.set('language', 'en-US')
  for (const [key, value] of Object.entries(params)) if (value != null && value !== '') url.searchParams.set(key, String(value))
  return fetchJson(url.toString(), { headers: { Authorization: `Bearer ${token}` } })
}

async function tmdbHome(profile) {
  const params = { include_adult: !!profile.showAdult }
  const [trending, movies, television] = await Promise.all([
    tmdbRequest(profile.tmdbToken, '/trending/all/week', params),
    tmdbRequest(profile.tmdbToken, '/movie/popular', params),
    tmdbRequest(profile.tmdbToken, '/tv/popular', params),
  ])
  const rows = [
    { id: 'trending', title: 'Trending this week', kind: 'catalog', items: (trending.results || []).map((item) => tmdbMedia(item)).filter(Boolean) },
    { id: 'movies', title: 'Popular movies', kind: 'catalog', items: (movies.results || []).map((item) => tmdbMedia(item, 'movie')).filter(Boolean) },
    { id: 'television', title: 'Popular TV', kind: 'catalog', items: (television.results || []).map((item) => tmdbMedia(item, 'tv')).filter(Boolean) },
  ].filter((row) => row.items.length)
  return { rows, hero: rows[0]?.items[0] }
}

async function tmdbPersonMedia(profile, person) {
  if (!/^\d{1,12}$/.test(String(person?.id || ''))) return []
  const value = await tmdbRequest(profile.tmdbToken, `/person/${encodeURIComponent(person.id)}/combined_credits`)
  const raw = person.credit === 'crew' ? value.crew : value.cast
  return dedupe((raw || []).map((entry) => tmdbMedia(entry)).filter(Boolean))
}

function stremioIdentity(base, type, id) {
  return encodeURIComponent(JSON.stringify([fnv(normalizeBase(base)), type, id]))
}

function stremioMedia(raw, base, forcedType) {
  const nativeType = raw?.type ?? forcedType ?? 'series'
  if (!raw?.id || !raw?.name) return null
  const type = nativeType === 'movie' ? 'movie' : nativeType === 'anime' ? 'anime' : 'series'
  const rating = Number(raw.imdbRating)
  return {
    ref: { provider: 'stremio', type, id: stremioIdentity(base, nativeType, raw.id), addonId: fnv(normalizeBase(base)) },
    resolver: { streamType: streamType(type) }, title: clean(raw.name, 240), description: clean(raw.description),
    mediaKind: mediaKind(type), genres: Array.isArray(raw.genres ?? raw.genre) ? (raw.genres ?? raw.genre).slice(0, 12) : [],
    releaseYear: year(String(raw.releaseInfo ?? raw.released ?? '').match(/\b(?:18|19|20|21)\d{2}\b/)?.[0]),
    runtimeMinutes: Number(String(raw.runtime || '').match(/\d+/)?.[0]) || undefined,
    poster: clean(raw.poster, 2_048), backdrop: clean(raw.background, 2_048), logoImage: clean(raw.logo, 2_048),
    trailer: raw.trailers?.find((entry) => entry?.source)?.source ? { id: String(raw.trailers.find((entry) => entry?.source).source).slice(0, 40), site: 'youtube' } : undefined,
    ratings: Number.isFinite(rating) && rating > 0 ? [{ source: 'IMDb', score: rating, scale: 10 }] : undefined,
  }
}

async function stremioManifests(addons) {
  const settled = await Promise.allSettled(addons.map(async (base) => ({ base, manifest: await fetchJson(endpoint(base, '/manifest.json'), {}, 5_000) })))
  return settled.filter((entry) => entry.status === 'fulfilled' && entry.value.manifest?.catalogs?.length).map((entry) => entry.value)
}

function catalogUrl(base, catalog, query, genre) {
  const extras = `${genre ? `/genre=${encodeURIComponent(genre)}` : ''}${query ? `/search=${encodeURIComponent(query)}` : ''}`
  return endpoint(base, `/catalog/${encodeURIComponent(catalog.type)}/${encodeURIComponent(catalog.id)}${extras}.json`)
}

async function stremioHome(addons) {
  const manifests = await stremioManifests(addons)
  const specs = manifests.flatMap(({ base, manifest }) => (manifest.catalogs || []).slice(0, 3).map((catalog) => ({ base, catalog, name: manifest.name }))).slice(0, 6)
  const settled = await Promise.allSettled(specs.map(async ({ base, catalog, name }) => {
    const value = await fetchJson(catalogUrl(base, catalog), {}, 8_000)
    return { id: `${fnv(base)}:${catalog.type}:${catalog.id}`, title: clean(catalog.name ?? name, 120) || 'Stremio', kind: 'catalog', items: (value.metas || []).slice(0, 20).map((raw) => stremioMedia(raw, base, catalog.type)).filter(Boolean) }
  }))
  const rows = settled.filter((entry) => entry.status === 'fulfilled' && entry.value.items.length).map((entry) => entry.value)
  return { rows, hero: rows[0]?.items[0] }
}

async function stremioSearch(addons, query) {
  const manifests = await stremioManifests(addons)
  const specs = manifests.flatMap(({ base, manifest }) => (manifest.catalogs || []).filter((catalog) => (catalog.extra || []).some((extra) => extra.name === 'search')).slice(0, 3).map((catalog) => ({ base, catalog }))).slice(0, 8)
  const settled = await Promise.allSettled(specs.map(async ({ base, catalog }) => {
    const value = await fetchJson(catalogUrl(base, catalog, query), {}, 8_000)
    return (value.metas || []).map((raw) => stremioMedia(raw, base, catalog.type)).filter(Boolean)
  }))
  return settled.filter((entry) => entry.status === 'fulfilled').flatMap((entry) => entry.value)
}

async function stremioGenre(addons, genre) {
  const manifests = await stremioManifests(addons)
  const specs = manifests.flatMap(({ base, manifest }) => (manifest.catalogs || []).filter((catalog) => {
    const extra = (catalog.extra || []).find((entry) => entry.name === 'genre')
    return extra && (!Array.isArray(extra.options) || extra.options.some((option) => String(option).toLowerCase() === genre.toLowerCase()))
  }).slice(0, 3).map((catalog) => ({ base, catalog }))).slice(0, 8)
  const settled = await Promise.allSettled(specs.map(async ({ base, catalog }) => {
    const value = await fetchJson(catalogUrl(base, catalog, undefined, genre), {}, 8_000)
    return (value.metas || []).map((raw) => stremioMedia(raw, base, catalog.type)).filter(Boolean)
  }))
  return settled.filter((entry) => entry.status === 'fulfilled').flatMap((entry) => entry.value)
}

async function tmdbGenre(profile, genre) {
  const [movieGenres, televisionGenres] = await Promise.all([
    tmdbRequest(profile.tmdbToken, '/genre/movie/list'),
    tmdbRequest(profile.tmdbToken, '/genre/tv/list'),
  ])
  const idFor = (value) => (value.genres || []).find((entry) => String(entry.name || '').toLowerCase() === genre.toLowerCase())?.id
  const movieId = idFor(movieGenres)
  const televisionId = idFor(televisionGenres)
  const [movies, television] = await Promise.all([
    movieId ? tmdbRequest(profile.tmdbToken, '/discover/movie', { with_genres: movieId, sort_by: 'popularity.desc', include_adult: profile.showAdult }) : { results: [] },
    televisionId ? tmdbRequest(profile.tmdbToken, '/discover/tv', { with_genres: televisionId, sort_by: 'popularity.desc', include_adult: profile.showAdult }) : { results: [] },
  ])
  return dedupe([
    ...(movies.results || []).map((entry) => tmdbMedia(entry, 'movie')).filter(Boolean),
    ...(television.results || []).map((entry) => tmdbMedia(entry, 'tv')).filter(Boolean),
  ])
}

function dedupe(items) {
  const seen = new Set()
  return items.filter((item) => {
    const key = `${item.ref.provider}:${item.ref.type}:${item.ref.id}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  }).slice(0, 40)
}

const label = (screen) => ({ auto: 'Automatic anime', anilist: 'AniList', kitsu: 'Kitsu', tmdb: 'TMDB', stremio: 'Stremio', merged: 'Merged' })[screen] || screen
const ANIME_GENRES = ['Action', 'Adventure', 'Comedy', 'Drama', 'Fantasy', 'Horror', 'Mecha', 'Music', 'Mystery', 'Psychological', 'Romance', 'Sci-Fi', 'Slice of Life', 'Sports', 'Supernatural', 'Thriller']
const TMDB_GENRES = ['Action', 'Adventure', 'Animation', 'Comedy', 'Crime', 'Documentary', 'Drama', 'Family', 'Fantasy', 'History', 'Horror', 'Kids', 'Music', 'Mystery', 'Reality', 'Romance', 'Science Fiction', 'Thriller', 'War', 'Western']

function snapshotGenres(profile, screen, home) {
  const visible = home.rows.flatMap((row) => row.items.flatMap((item) => item.genres || []))
  const sources = screen === 'merged' ? profile.screens : [screen]
  const configured = sources.flatMap((source) => source === 'tmdb' ? TMDB_GENRES : ['auto', 'anilist', 'kitsu'].includes(source) ? ANIME_GENRES : [])
  return [...new Set([...visible, ...configured].map((value) => clean(value, 80)).filter(Boolean))].slice(0, 40)
}

async function providerHome(profile, screen) {
  if (screen === 'auto' || screen === 'anilist') return aniHome(profile.showAdult)
  if (screen === 'kitsu') return kitsuHome()
  if (screen === 'tmdb') return tmdbHome(profile)
  if (screen === 'stremio') return stremioHome(profile.addons)
  return null
}

export async function catalogSnapshot(profile, requestedScreen) {
  const screen = profile.screens.includes(requestedScreen) && requestedScreen !== 'jvm' ? requestedScreen : profile.defaultScreen
  if (screen === 'merged') {
    const sources = profile.screens.filter((entry) => !['merged', 'jvm'].includes(entry))
    const settled = await Promise.allSettled(sources.map((entry) => providerHome(profile, entry)))
    const rows = settled.filter((entry) => entry.status === 'fulfilled' && entry.value).flatMap((entry) => entry.value.rows)
    return snapshot(profile, screen, { rows, hero: rows[0]?.items[0] })
  }
  const home = await providerHome(profile, screen)
  return home ? snapshot(profile, screen, home) : null
}

function snapshot(profile, screen, home) {
  const generatedAt = Date.now()
  return {
    app: 'izumi', kind: 'companion-home', version: 1,
    revision: `cloud-${screen}-${generatedAt}`, generatedAt,
    catalog: {
      screen,
      label: label(screen),
      options: profile.screens.filter((entry) => entry !== 'jvm').map((entry) => ({ screen: entry, label: label(entry) })),
      genres: snapshotGenres(profile, screen, home),
    },
    spoilersHidden: profile.hideSpoilers,
    hero: home.hero,
    rows: home.rows.slice(0, 12).map((row) => ({ ...row, items: dedupe(row.items).slice(0, 20) })).filter((row) => row.items.length),
  }
}

export async function catalogSearch(profile, requestedScreen, query, person, genre) {
  const cleanQuery = clean(query, 80)
  const cleanGenre = clean(genre, 80)
  const cleanPerson = person && typeof person === 'object'
    && /^\d{1,12}$/.test(String(person.id || ''))
    && (person.credit === 'cast' || person.credit === 'crew')
    ? { id: String(person.id), provider: String(person.provider || ''), credit: person.credit }
    : null
  if (!cleanQuery && !cleanPerson && !cleanGenre) return []
  if (cleanPerson?.provider === 'anilist') return dedupe(await aniPersonMedia(cleanPerson, profile.showAdult))
  if (cleanPerson?.provider === 'tmdb') return tmdbPersonMedia(profile, cleanPerson)
  if (!cleanQuery && !cleanGenre) return []
  const screen = profile.screens.includes(requestedScreen) ? requestedScreen : profile.defaultScreen
  if (screen === 'merged') {
    const settled = await Promise.allSettled(profile.screens.filter((entry) => !['merged', 'jvm'].includes(entry)).map((entry) => catalogSearch(profile, entry, cleanQuery, cleanPerson, cleanGenre)))
    return dedupe(settled.filter((entry) => entry.status === 'fulfilled').flatMap((entry) => entry.value))
  }
  if (screen === 'auto' || screen === 'anilist') return aniSearch(cleanGenre ? '' : cleanQuery, profile.showAdult, cleanGenre)
  if (screen === 'kitsu') return kitsuPage(cleanGenre
    ? { 'filter[categories]': cleanGenre.toLowerCase(), sort: '-userCount' }
    : { 'filter[text]': cleanQuery, sort: '-userCount' })
  if (screen === 'tmdb') {
    if (cleanGenre) return tmdbGenre(profile, cleanGenre)
    const value = await tmdbRequest(profile.tmdbToken, '/search/multi', { query: cleanQuery, include_adult: profile.showAdult })
    return dedupe((value.results || []).map((entry) => tmdbMedia(entry)).filter(Boolean))
  }
  if (screen === 'stremio') return dedupe(cleanGenre ? await stremioGenre(profile.addons, cleanGenre) : await stremioSearch(profile.addons, cleanQuery))
  return []
}

export function decodeStremioRef(value) {
  try {
    const parsed = JSON.parse(decodeURIComponent(value))
    return Array.isArray(parsed) && parsed.length === 3 && parsed.every((entry) => typeof entry === 'string')
      ? { addonId: parsed[0], type: parsed[1], id: parsed[2] } : null
  } catch { return null }
}

export const catalogInternals = { fetchJson, aniDetail, kitsuMedia, tmdbMedia, stremioMedia, normalizeBase, fnv, tmdbRequest }
