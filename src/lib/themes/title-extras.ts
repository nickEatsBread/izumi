import type { Media } from '$lib/anilist/types'
import type { AniZipImage } from '$lib/anizip/types'
import { fetchAniZip } from '$lib/anizip'
import { fetchMalRating } from '$lib/anilist/jikan'
import { getScheduleInfo, getScheduleInfoMany, scheduleTitles, type ScheduleInfo } from '$lib/anime/animeschedule'
import { anilistIdOf } from '$lib/catalog/identity'
import type { ThemeNode } from './presentation'

/** Per-title data a theme template can bind that catalog responses do not carry. Loaded only for
 *  the extras an active template binds, cached for the session, and never fatal. */
export interface TitleExtras {
  /** 16:9 key art: a TVDB background for AniList titles, the TMDB or add-on backdrop otherwise. */
  keyart?: string
  /** A transparent title logo. */
  logo?: string
  /** A short maturity badge: the provider certification, else MyAnimeList's rating ("13+"). */
  ageRating?: string
  /** "Sub | Dub" when a dub has premiered, "Subtitled" when the title is known to have none. */
  audio?: string
}
export type TitleExtra = keyof TitleExtras
const EXTRAS: readonly string[] = ['keyart', 'logo', 'ageRating', 'audio'] satisfies TitleExtra[]

/** The extras drawn as artwork. They decide how a slide or a series page first paints, so callers
 *  load them on their own instead of waiting for the rate-limited rating and schedule lookups. */
export const ART_EXTRAS: readonly TitleExtra[] = ['keyart', 'logo']
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

/** TVDB artwork from an ani.zip record: the background as key art and the clear logo. ani.zip also
 *  labels square icons `Clearlogo`; only files under `/clearlogo/` are title logos. */
export function pickTitleArt(images: AniZipImage[] | undefined): Pick<TitleExtras, 'keyart' | 'logo'> {
  const find = (type: string, test: (url: string) => boolean = () => true) =>
    images?.find((image) => image.coverType === type && typeof image.url === 'string' && image.url.startsWith('https://') && test(image.url))?.url
  return { keyart: find('Fanart'), logo: find('Clearlogo', (url) => url.includes('/clearlogo/')) }
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

// ani.zip records are cached in IndexedDB already; this keeps one parsed lookup per title for the
// session. Empty results are dropped so a title that failed offline is retried next time.
const artCache = new Map<number, Promise<Pick<TitleExtras, 'keyart' | 'logo'>>>()
// The same lookups once they have answered with artwork, readable without waiting.
const artFound = new Map<number, Pick<TitleExtras, 'keyart' | 'logo'>>()
function aniZipArt(anilistId: number): Promise<Pick<TitleExtras, 'keyart' | 'logo'>> {
  const hit = artCache.get(anilistId)
  if (hit) return hit
  const promise = fetchAniZip(anilistId)
    .then((record) => pickTitleArt(record?.images))
    // A failed fetch and a record that cannot be read are both simply no art: the cache must never
    // hold a rejected lookup, which would fail every later load of the title.
    .catch((): Pick<TitleExtras, 'keyart' | 'logo'> => ({}))
    .then((art) => {
      if (!art.keyart && !art.logo) artCache.delete(anilistId)
      else artFound.set(anilistId, art)
      return art
    })
  artCache.set(anilistId, promise)
  return promise
}

/** The key art and logo an earlier lookup found for an AniList title, without waiting, so a page
 *  opened again paints them on its first frame. Undefined until a lookup has found artwork. */
export function peekTitleArt(anilistId: number | undefined): Pick<TitleExtras, 'keyart' | 'logo'> | undefined {
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
  if (anilistId && ((needs.has('keyart') && !out.keyart) || (needs.has('logo') && !out.logo))) {
    tasks.push(aniZipArt(anilistId).then((art) => {
      if (needs.has('keyart')) out.keyart ??= art.keyart
      if (needs.has('logo')) out.logo ??= art.logo
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
