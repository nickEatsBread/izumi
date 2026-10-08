import type { Media } from '$lib/anilist/types'
import type { AniZipImage } from '$lib/anizip/types'
import { fetchAniZip } from '$lib/anizip'
import { fetchMalRating } from '$lib/anilist/jikan'
import { getScheduleInfo, getScheduleInfoMany, scheduleTitles, type ScheduleInfo } from '$lib/anime/animeschedule'
import { anilistIdOf } from '$lib/catalog/identity'
import { env as publicEnv } from '$env/dynamic/public'
import { get } from 'svelte/store'
import { getLocale } from '$lib/paraglide/runtime.js'
import { tmdbReadToken } from '$lib/settings/catalog'
import type { ThemeNode } from './presentation'

/** Per-title data a theme template can bind that catalog responses do not carry. Loaded only for
 *  the extras an active template binds, cached for the session, and never fatal. */
export interface TitleExtras {
  /** 16:9 key art: a TVDB background for AniList titles, the TMDB or add-on backdrop otherwise. */
  keyart?: string
  /** A transparent title logo. */
  logo?: string
  /** Portrait artwork at full resolution: the TVDB poster for AniList titles (Theme API 4 `posterHd`). */
  posterHd?: string
  /** A short maturity badge: the provider certification, else MyAnimeList's rating ("13+"). */
  ageRating?: string
  /** "Sub | Dub" when a dub has premiered, "Subtitled" when the title is known to have none. */
  audio?: string
}
export type TitleExtra = keyof TitleExtras
const EXTRAS: readonly string[] = ['keyart', 'logo', 'posterHd', 'ageRating', 'audio'] satisfies TitleExtra[]

/** The extras drawn as artwork. They decide how a slide or a series page first paints, so callers
 *  load them on their own instead of waiting for the rate-limited rating and schedule lookups. */
export const ART_EXTRAS: readonly TitleExtra[] = ['keyart', 'logo', 'posterHd']
/** The artwork among `needs`. */
export const artNeeds = (needs: ReadonlySet<TitleExtra>): Set<TitleExtra> =>
  new Set([...needs].filter((need) => ART_EXTRAS.includes(need)))
/** Everything among `needs` that is not artwork: the age rating and audio. */
export const metaNeeds = (needs: ReadonlySet<TitleExtra>): Set<TitleExtra> =>
  new Set([...needs].filter((need) => !ART_EXTRAS.includes(need)))

/** The extras the given templates bind — as artwork, as a text field or in a `when` test. */
export function templateNeeds(...nodes: (ThemeNode | undefined)[]): Set<TitleExtra> {
  const needs = new Set<TitleExtra>()
  const visit = (node: ThemeNode) => {
    for (const key of [node.artwork, node.field, node.when?.field]) if (key && EXTRAS.includes(key)) needs.add(key as TitleExtra)
    node.children?.forEach(visit)
  }
  for (const node of nodes) if (node) visit(node)
  return needs
}

/** The artwork extras one ani.zip record answers. */
type TitleArt = Pick<TitleExtras, 'keyart' | 'logo' | 'posterHd'>

/** An image record as ani.zip copies it from TVDB. ani.zip does not say which language a logo is
 *  in today; a record that names one (`language`, as TVDB does: `eng`, `jpn`, or `en`, `ja`) is
 *  honoured, so a language-tagged logo can be chosen the day the field appears. */
type ArtImage = AniZipImage & { language?: unknown; lang?: unknown }

const LANGUAGE_CODES: Record<string, string> = { eng: 'en', jpn: 'ja', kor: 'ko', zho: 'zh', chi: 'zh', fra: 'fr', fre: 'fr', deu: 'de', ger: 'de', spa: 'es', por: 'pt', ita: 'it', rus: 'ru' }
/** A language tag as a bare ISO 639-1 code ("eng", "en-US" → "en"); undefined when there is none. */
export function languageCode(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const base = value.trim().toLowerCase().split(/[-_]/)[0]
  if (!base) return undefined
  return LANGUAGE_CODES[base] ?? (base.length === 2 ? base : undefined)
}

/** The languages a title logo is wanted in, best first: the app's language, then English. */
export function logoLanguages(appLanguage?: string): string[] {
  let ui = appLanguage
  if (!ui) {
    try { ui = getLocale() } catch { ui = 'en' }
  }
  return [...new Set([languageCode(ui) ?? 'en', 'en'])]
}

/** The title's own language from its country of origin (Japanese for anime without one). */
export function nativeLanguage(country: string | null | undefined): string {
  return ({ KR: 'ko', CN: 'zh', TW: 'zh', HK: 'zh' } as Record<string, string>)[country ?? ''] ?? 'ja'
}

/** The title logo among TVDB images: one in a wanted language (`languages`, best first), else one
 *  in the title's own language or of an unknown language (ani.zip names none, and a title's TVDB
 *  logo is most often its own), else none, so the title shows as text. A logo in any other language
 *  is never used. ani.zip also labels square icons `Clearlogo`; only files under `/clearlogo/` are
 *  title logos. */
export function pickTitleLogo(images: ArtImage[] | undefined, languages: readonly string[] = ['en'], native = 'ja'): string | undefined {
  if (!Array.isArray(images)) return undefined
  const logos = images.filter((image) => image?.coverType === 'Clearlogo' && typeof image.url === 'string' && image.url.startsWith('https://') && image.url.includes('/clearlogo/'))
  const language = (image: ArtImage) => languageCode(image.language ?? image.lang)
  for (const wanted of languages) {
    const match = logos.find((image) => language(image) === wanted)
    if (match) return match.url
  }
  return logos.find((image) => { const code = language(image); return !code || code === native })?.url
}

/** TVDB artwork from an ani.zip record: the background as key art, the clear logo (`pickTitleLogo`)
 *  and the poster. */
export function pickTitleArt(images: ArtImage[] | undefined, languages: readonly string[] = ['en'], native = 'ja'): TitleArt {
  const list = Array.isArray(images) ? images : []
  const find = (type: string) =>
    list.find((image) => image?.coverType === type && typeof image.url === 'string' && image.url.startsWith('https://'))?.url
  return { keyart: find('Fanart'), logo: pickTitleLogo(list, languages, native), posterHd: find('Poster') }
}

/** A logo in one of the wanted languages from TMDB, for a title ani.zip maps there. Only while the
 *  viewer has TMDB set up (Settings → Catalog, or a packaged token): TMDB is never asked otherwise.
 *  Only explicitly tagged logos count, so a mislabelled one never replaces the title's own. */
const tmdbLogoCache = new Map<string, Promise<string | undefined>>()
function tmdbTitleLogo(kind: 'tv' | 'movie', id: string, languages: readonly string[]): Promise<string | undefined> {
  const token = get(tmdbReadToken).trim() || (publicEnv as Record<string, string | undefined>).PUBLIC_TMDB_READ_TOKEN?.trim()
  if (!token || !/^\d+$/.test(id)) return Promise.resolve(undefined)
  const key = `${kind}:${id}:${languages.join(',')}`
  const hit = tmdbLogoCache.get(key)
  if (hit) return hit
  const request = import('$lib/catalog/providers/tmdb')
    .then(({ tmdb }) => tmdb<{ logos?: { file_path?: string | null; iso_639_1?: string | null; vote_average?: number }[] }>(`/${kind}/${id}/images`, { include_image_language: languages.join(',') }))
    .then((images) => {
      const logos = (images.logos ?? []).filter((logo) => logo.file_path)
      for (const wanted of languages) {
        const best = logos.filter((logo) => logo.iso_639_1 === wanted).sort((left, right) => (right.vote_average ?? 0) - (left.vote_average ?? 0))[0]
        if (best?.file_path) return `https://image.tmdb.org/t/p/w500${best.file_path}`
      }
      return undefined
    })
    .catch(() => {
      tmdbLogoCache.delete(key)
      return undefined
    })
  tmdbLogoCache.set(key, request)
  return request
}

/** MyAnimeList's rating ("PG-13 - Teens 13 or older") as a badge. */
export function malAgeRating(rating: string | null | undefined): string | undefined {
  const value = rating?.trim() ?? ''
  if (/^rx\b/i.test(value) || /^r\+/i.test(value)) return '18+'
  if (/^r\b/i.test(value)) return '17+'
  if (/^pg-13\b/i.test(value)) return '13+'
  if (/^pg\b/i.test(value)) return 'PG'
  if (/^g\b/i.test(value)) return 'G'
  return undefined
}

/** Audio wording from the schedule record. A title the schedule does not know shows nothing
 *  rather than a guess. */
export function audioLabel(info: ScheduleInfo | null | undefined): string | undefined {
  if (!info) return undefined
  return info.dubbed ? 'Sub | Dub' : 'Subtitled'
}

// ani.zip records are cached in IndexedDB already; this keeps one parsed lookup per title (and logo
// languages) for the session. Empty results are dropped so a title that failed offline is retried.
// `tmdb` is where a logo in a wanted language may still be found, when ani.zip's own is not one.
interface ZipArt { art: TitleArt; tmdb?: { kind: 'tv' | 'movie'; id: string; languages: string[] } }
const artCache = new Map<string, Promise<ZipArt>>()
// The same lookups once they have answered with artwork, readable without waiting.
const artFound = new Map<number, TitleArt>()
function aniZipArt(anilistId: number, media: Pick<Media, 'format' | 'countryOfOrigin'>): Promise<ZipArt> {
  const languages = logoLanguages()
  const key = `${anilistId}|${languages.join(',')}`
  const hit = artCache.get(key)
  if (hit) return hit
  const native = nativeLanguage(media.countryOfOrigin)
  const promise = fetchAniZip(anilistId)
    .then((record): ZipArt => {
      const images = record?.images as ArtImage[] | undefined
      const art = pickTitleArt(images, languages, native)
      // ani.zip names no logo language, so its logo is the title's own (or of unknown language). A
      // logo in the app's language or English from TMDB wins over it when the viewer has TMDB set up.
      const tagged = Array.isArray(images) && images.some((image) => image?.url === art.logo && languages.includes(languageCode(image.language ?? image.lang) ?? ''))
      const tmdbId = record?.mappings?.themoviedb_id
      const kind = media.format === 'MOVIE' || (record?.mappings as { type?: string } | undefined)?.type === 'MOVIE' ? 'movie' : 'tv'
      return { art, ...(!tagged && tmdbId ? { tmdb: { kind, id: String(tmdbId), languages } } : {}) }
    })
    // A failed fetch and a record that cannot be read are both simply no art: the cache must never
    // hold a rejected lookup, which would fail every later load of the title.
    .catch((): ZipArt => ({ art: {} }))
    .then((zip) => {
      const { art } = zip
      if (!art.keyart && !art.logo && !art.posterHd && !zip.tmdb) artCache.delete(key)
      else if (art.keyart || art.logo || art.posterHd) artFound.set(anilistId, { ...art })
      return zip
    })
  artCache.set(key, promise)
  return promise
}

/** The title logo for an ani.zip lookup: TMDB's in a wanted language when there is one (only asked
 *  for when a logo is needed, so key art never waits on it), else ani.zip's own. */
async function zipLogo(anilistId: number, zip: ZipArt): Promise<string | undefined> {
  const tmdb = zip.tmdb ? await tmdbTitleLogo(zip.tmdb.kind, zip.tmdb.id, zip.tmdb.languages) : undefined
  if (tmdb) {
    // A page opened again paints the same logo on its first frame.
    artFound.set(anilistId, { ...artFound.get(anilistId), ...zip.art, logo: tmdb })
    return tmdb
  }
  return zip.art.logo
}

/** The key art, logo and poster an earlier lookup found for an AniList title, without waiting, so a
 *  page opened again paints them on its first frame. Undefined until a lookup has found artwork. */
export function peekTitleArt(anilistId: number | undefined): TitleArt | undefined {
  return anilistId ? artFound.get(anilistId) : undefined
}

/** What `loadTitleExtras` reads from a record, as one comparable string. A page that loads extras
 *  for a partial record (the card the user tapped) loads them again when the full record changes
 *  this, and not when it only repeats it. */
export function titleExtrasKey(media: Media): string {
  const provider = media.catalog?.provider
  return JSON.stringify([
    media.id, anilistIdOf(media) ?? null, media.idMal ?? null, media.contentRating ?? null, media.logoImage ?? null,
    provider ?? null, provider === 'tmdb' || provider === 'stremio' ? media.bannerImage ?? null : null,
    media.title?.romaji ?? null, media.title?.english ?? null, media.title?.native ?? null,
  ])
}

// The batch schedule lookup `primeTitleExtras` started, per title. A title's own lookup waits for it
// and then reads the schedule module's memo, instead of racing the batch with a request of its own
// (AnimeSchedule answers such bursts with 429s).
const primedSchedule = new Map<number, Promise<unknown>>()

/** Test hook: forget the session cache. */
export function clearTitleExtrasCache(): void {
  artCache.clear()
  tmdbLogoCache.clear()
  artFound.clear()
  primedSchedule.clear()
}

/** Load the requested extras for one title. Never rejects; an extra whose source fails is absent.
 *  Everything asked for is awaited together, so ask for the artwork (`artNeeds`) and the rest
 *  (`metaNeeds`) in separate calls when the artwork must not wait for the slower lookups. */
export async function loadTitleExtras(media: Media, needs: ReadonlySet<TitleExtra>): Promise<TitleExtras> {
  const out: TitleExtras = {}
  const anilistId = anilistIdOf(media)
  const provider = media.catalog?.provider
  const tasks: Promise<unknown>[] = []
  if (needs.has('logo') && media.logoImage) out.logo = media.logoImage
  // TMDB and add-on catalogs already carry 16:9 backdrops as their banner.
  if (needs.has('keyart') && (provider === 'tmdb' || provider === 'stremio') && media.bannerImage) out.keyart = media.bannerImage
  if (anilistId && ((needs.has('keyart') && !out.keyart) || (needs.has('logo') && !out.logo) || needs.has('posterHd'))) {
    tasks.push(aniZipArt(anilistId, media).then(async (zip) => {
      if (needs.has('keyart')) out.keyart ??= zip.art.keyart
      if (needs.has('posterHd')) out.posterHd ??= zip.art.posterHd
      if (needs.has('logo') && !out.logo) out.logo = await zipLogo(anilistId, zip)
    }))
  }
  if (needs.has('ageRating')) {
    if (media.contentRating) out.ageRating = media.contentRating
    else if (media.idMal) tasks.push(fetchMalRating(media.idMal).then((rating) => { out.ageRating = malAgeRating(rating) }, () => {}))
  }
  if (needs.has('audio') && anilistId) {
    const primed = primedSchedule.get(anilistId) ?? Promise.resolve()
    tasks.push(primed.catch(() => {})
      .then(() => getScheduleInfo(anilistId, scheduleTitles(media.title)))
      .then((info) => { out.audio = audioLabel(info) }, () => {}))
  }
  await Promise.all(tasks)
  return Object.fromEntries(Object.entries(out).filter(([, value]) => value)) as TitleExtras
}

/** Warm the batchable lookups for a list (the hero's slides): AnimeSchedule answers up to 18 titles
 *  per request, and `getScheduleInfo` then reads them from its memo. Call it before loading the
 *  titles' extras: their schedule lookups wait for this batch. */
export function primeTitleExtras(medias: Media[], needs: ReadonlySet<TitleExtra>): void {
  if (!needs.has('audio')) return
  const items = medias.flatMap((media) => {
    const id = anilistIdOf(media)
    return id ? [{ id, titles: scheduleTitles(media.title) }] : []
  })
  if (!items.length) return
  const batch: Promise<unknown> = getScheduleInfoMany(items).catch(() => {})
  for (const item of items) primedSchedule.set(item.id, batch)
  void batch.then(() => {
    for (const item of items) if (primedSchedule.get(item.id) === batch) primedSchedule.delete(item.id)
  })
}
