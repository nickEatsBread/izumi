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
function aniZipArt(anilistId: number): Promise<Pick<TitleExtras, 'keyart' | 'logo'>> {
  const hit = artCache.get(anilistId)
  if (hit) return hit
  const promise = fetchAniZip(anilistId)
    .then((record) => pickTitleArt(record?.images), () => ({}))
    .then((art: Pick<TitleExtras, 'keyart' | 'logo'>) => {
      if (!art.keyart && !art.logo) artCache.delete(anilistId)
      return art
    })
  artCache.set(anilistId, promise)
  return promise
}

/** Test hook: forget the session cache. */
export function clearTitleExtrasCache(): void {
  artCache.clear()
}

/** Load the requested extras for one title. Never rejects; an extra whose source fails is absent. */
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
    tasks.push(getScheduleInfo(anilistId, scheduleTitles(media.title)).then((info) => { out.audio = audioLabel(info) }, () => {}))
  }
  await Promise.all(tasks)
  return Object.fromEntries(Object.entries(out).filter(([, value]) => value)) as TitleExtras
}

/** Warm the batchable lookups for a list (the hero's slides): AnimeSchedule answers up to 18 titles
 *  per request, and `getScheduleInfo` then reads them from its memo. */
export function primeTitleExtras(medias: Media[], needs: ReadonlySet<TitleExtra>): void {
  if (!needs.has('audio')) return
  const items = medias.flatMap((media) => {
    const id = anilistIdOf(media)
    return id ? [{ id, titles: scheduleTitles(media.title) }] : []
  })
  if (items.length) void getScheduleInfoMany(items).catch(() => {})
}
