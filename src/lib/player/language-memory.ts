/**
 * A language picked in the player becomes the catalog's language for the active profile, so the next
 * title from that catalog starts in it (Settings › Languages › Per catalog shows and changes it).
 *
 * - Anime, TMDB, Stremio: the pick goes first in the catalog's own order (`catalog-languages-v1`,
 *   per profile).
 * - A source catalog whose account reports its languages: the pick is also saved to the account,
 *   because the account's languages outrank the catalog's own order (catalog-languages.ts). A
 *   language the account can't hold (subtitles off on a service without "off") stays izumi's own.
 *
 * The series memory (`track-preferences.ts`) records the exact track for the series and still wins
 * inside that series: this only changes where other titles from the catalog start.
 */
import { get } from 'svelte/store'
import type { Media } from '$lib/anilist/types'
import { profiledPersisted } from '$lib/profiles/store'
import {
  catalogLanguages, catalogOfMedia, languagesFor, sourceAccountLanguages, SUBTITLES_OFF,
  type LanguageCatalog, type LanguageKind,
} from '$lib/settings/catalog-languages'
import { langsEqual } from '$lib/stremio/sublang'
import { nowPlayingMedia } from './session'

/** Settings › Languages › Per catalog: on unless turned off, per profile. */
export const rememberLanguagePicks = profiledPersisted<boolean>('remember-language-picks-v1', true)

const UNKNOWN = new Set(['und', 'unk', 'mul', 'zxx', 'qaa'])

/** The language a picked track stands for: its tag, `none` for subtitles off, undefined when the
 *  track names no language (nothing to remember). */
export function pickedLanguage(kind: LanguageKind, track: { lang?: string } | null): string | undefined {
  if (!track) return kind === 'subtitle' ? SUBTITLES_OFF : undefined
  const tag = track.lang?.trim()
  return tag && !UNKNOWN.has(tag.toLowerCase()) ? tag : undefined
}

/** The catalog's own order with `tag` first. Subtitles off replaces the order. */
export function withPick(order: readonly string[] | undefined, tag: string): string[] {
  if (tag === SUBTITLES_OFF) return [SUBTITLES_OFF]
  return [tag, ...(order ?? []).filter((other) => other !== SUBTITLES_OFF && !langsEqual(other, tag))]
}

/** Remember a pick for the catalog `media` plays from. A pick the catalog already starts in changes
 *  nothing: the defaults stay defaults until the viewer chooses something else. */
export function rememberLanguagePick(
  media: Pick<Media, 'catalog'> | null | undefined,
  kind: LanguageKind,
  track: { lang?: string } | null,
): void {
  if (!media || !get(rememberLanguagePicks)) return
  const tag = pickedLanguage(kind, track)
  if (!tag) return
  const catalog = catalogOfMedia(media)
  if (langsEqual(languagesFor(catalog)[kind][0], tag)) return
  catalogLanguages.update((all) => ({ ...all, [catalog]: { ...all[catalog], [kind]: withPick(all[catalog]?.[kind], tag) } }))
  saveToAccount(catalog, kind, tag)
}

/** The now-playing title's catalog, when `mediaId` is what plays. */
export function rememberNowPlayingLanguage(mediaId: number | null | undefined, kind: LanguageKind, track: { lang?: string } | null): void {
  const current = get(nowPlayingMedia)?.media
  if (current && mediaId != null && current.id === mediaId) rememberLanguagePick(current, kind, track)
}

function saveToAccount(catalog: LanguageCatalog, kind: LanguageKind, tag: string): void {
  if (!catalog.startsWith('source:')) return
  const packageId = catalog.slice('source:'.length)
  if (!get(sourceAccountLanguages)[packageId]) return
  // Loaded on demand: the settings protocol pulls in the extension manager. A failed save leaves the
  // pick izumi's own for the catalog and the account as it was.
  void import('$lib/extensions/source-languages')
    .then(({ saveSourceLanguagePick }) => saveSourceLanguagePick(packageId, kind, tag))
    .catch(() => {})
}
