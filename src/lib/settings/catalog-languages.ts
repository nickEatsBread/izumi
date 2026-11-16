/**
 * Audio and subtitle language order per catalog.
 *
 * Each catalog (the anime catalog, TMDB, Stremio add-ons, every source catalog) plays in its own
 * language order. For one kind (audio or subtitles) the first of these that says anything wins:
 *  1. the source account's own preference (source catalogs that report one; kept in sync both ways),
 *  2. the order chosen for that catalog in Settings → Languages,
 *  3. the global order in Settings → Languages, unless it is Automatic,
 *  4. the catalog's default: Japanese audio and English subtitles (then the system language) for
 *     anime, the system language for everything else.
 *
 * Orders hold language tags: ISO 639-2 (`jpn`) or BCP-47 (`es-419`) as a source reports them. A
 * subtitle order of `['none']` turns subtitles off.
 */
import { get } from 'svelte/store'
import { persisted } from 'svelte-persisted-store'
import type { Media } from '$lib/anilist/types'
import type { ServiceSettingsDocument } from '$lib/extensions/manager'
import { iso639_2 } from '$lib/onboarding/playback-languages'
import { profiledPersisted } from '$lib/profiles/store'
import { normalizeLang } from '$lib/stremio/sublang'
import { preferredAudioLang, preferredSubLang } from './ui'

export type LanguageKind = 'audio' | 'subtitle'
export interface LanguageOrder { audio: string[]; subtitle: string[] }
export type LanguageCatalog = 'anime' | 'tmdb' | 'stremio' | `source:${string}`

/** A source account's languages, as its settings document last reported them. */
export interface SourceLanguages extends Partial<LanguageOrder> {
  /** When izumi last heard them, ms. */
  at: number
}

export const SUBTITLES_OFF = 'none'
/** The global rows' value when no order is set: each catalog uses its own default. */
export const AUTOMATIC = 'auto'

/** The order picked per catalog in Settings. A missing kind follows the global order or the default. */
export const catalogLanguages = profiledPersisted<Record<string, Partial<LanguageOrder>>>('catalog-languages-v1', {})
/** Source accounts' preferences, by package id, as each source last reported them. */
export const sourceAccountLanguages = persisted<Record<string, SourceLanguages>>('source-languages-v1', {})

const isSourceCatalog = (catalog: LanguageCatalog): catalog is `source:${string}` => catalog.startsWith('source:')

/** The language catalog a title plays under. */
export function catalogOfMedia(media: Pick<Media, 'catalog'> | null | undefined): LanguageCatalog {
  const catalog = media?.catalog
  if (catalog?.addonId?.startsWith('source-')) return `source:${catalog.addonId.slice('source-'.length)}`
  if (catalog?.provider === 'tmdb' || catalog?.provider === 'stremio') return catalog.provider
  return 'anime'
}

/** A global row's stored value as an order: `auto` (or nothing) is no order at all. */
export function storedOrder(value: string | undefined): string[] | undefined {
  const order = (value ?? '').split(',').map((tag) => tag.trim()).filter(Boolean)
  return !order.length || order[0] === AUTOMATIC ? undefined : order
}

const unique = (tags: Array<string | undefined>): string[] => {
  const seen = new Set<string>()
  return tags.filter((tag): tag is string => {
    const key = tag?.toLowerCase()
    if (!key || seen.has(key)) return false
    seen.add(key)
    return true
  })
}

/** A catalog's own default order for a system locale such as `fr-FR`. */
export function catalogDefaults(catalog: LanguageCatalog, locale?: string): LanguageOrder {
  const system = iso639_2(locale)
  if (catalog === 'anime') return { audio: ['jpn'], subtitle: unique(['eng', system]) }
  const own = system ?? 'eng'
  return { audio: [own], subtitle: [own] }
}

export function resolveLanguageOrder(input: {
  catalog: LanguageCatalog
  account?: Partial<LanguageOrder>
  own?: Partial<LanguageOrder>
  global?: Partial<LanguageOrder>
  locale?: string
}): LanguageOrder {
  const defaults = catalogDefaults(input.catalog, input.locale)
  const pick = (kind: LanguageKind) =>
    [input.account, input.own, input.global].find((order) => order?.[kind]?.length)?.[kind] ?? defaults[kind]
  return { audio: pick('audio'), subtitle: pick('subtitle') }
}

const systemLocale = (): string | undefined => (typeof navigator === 'undefined' ? undefined : navigator.language)

/** The order a catalog plays in right now. */
export function languagesFor(catalog: LanguageCatalog): LanguageOrder {
  return resolveLanguageOrder({
    catalog,
    account: isSourceCatalog(catalog) ? get(sourceAccountLanguages)[catalog.slice('source:'.length)] : undefined,
    own: get(catalogLanguages)[catalog],
    global: { audio: storedOrder(get(preferredAudioLang)), subtitle: storedOrder(get(preferredSubLang)) },
    locale: systemLocale(),
  })
}

export const languagesForMedia = (media: Pick<Media, 'catalog'> | null | undefined): LanguageOrder =>
  languagesFor(catalogOfMedia(media))

/** mpv's `alang`/`slang`: each tag plus its ISO 639-2 form, so `es-419` still matches a `spa` track.
 *  An order that turns subtitles off stays `none`, which the player maps to `sid=no`. */
export function mpvLanguageList(order: readonly string[]): string {
  if (order[0] === SUBTITLES_OFF) return SUBTITLES_OFF
  return unique(order.flatMap((tag) => [tag.toLowerCase(), normalizeLang(tag)])).join(',')
}

/** The single audio and subtitle language source ranking compares (ISO 639-2 where it can). */
export const rankingLanguages = (order: LanguageOrder): { audioLang?: string; subtitleLang?: string } => ({
  audioLang: normalizeLang(order.audio[0]) ?? order.audio[0],
  subtitleLang: order.subtitle[0] === SUBTITLES_OFF ? SUBTITLES_OFF : normalizeLang(order.subtitle[0]) ?? order.subtitle[0],
})

/** The account languages a source's settings document reports. A document names the fields that
 *  hold them in `languages`; each holds one language tag, `none` turns subtitles off and an empty
 *  value is not set (the catalog falls back to its other orders). A named field missing from
 *  `values` keeps what `previous` said for that kind. */
export function documentLanguages(
  document: Pick<ServiceSettingsDocument, 'languages' | 'values'>,
  now = Date.now(),
  previous?: SourceLanguages,
): SourceLanguages | undefined {
  const found: SourceLanguages = { at: now }
  for (const kind of ['audio', 'subtitle'] as const) {
    const key = document.languages?.[kind]
    if (!key) continue
    if (!document.values || !(key in document.values)) {
      if (previous?.[kind]) found[kind] = previous[kind]
      continue
    }
    const value = document.values[key]
    const tag = typeof value === 'string' ? value.trim() : ''
    if (tag.toLowerCase() === SUBTITLES_OFF) { if (kind === 'subtitle') found.subtitle = [SUBTITLES_OFF] }
    else if (tag) found[kind] = [tag]
  }
  return found.audio || found.subtitle ? found : undefined
}

/** Keep what a settings document says about the account's languages. A document that names no
 *  language fields (signed out, or a source without them) drops what was kept. */
export function rememberSourceLanguages(packageId: string, document: Pick<ServiceSettingsDocument, 'languages' | 'values'>): void {
  sourceAccountLanguages.update((all) => {
    const found = document.languages ? documentLanguages(document, Date.now(), all[packageId]) : undefined
    if (found) return { ...all, [packageId]: found }
    if (document.languages || !(packageId in all)) return all
    const { [packageId]: _dropped, ...rest } = all
    return rest
  })
}
