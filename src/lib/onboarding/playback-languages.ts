import { LANGUAGE_DATA } from '$lib/shared/languages'
import type { OnboardingIntent } from '$lib/settings/onboarding'

export interface PlaybackLanguages {
  audio: string
  subtitle: string
}

/** ISO 639-1 (what a browser locale carries) to the ISO 639-2 code the playback settings store. */
export function iso639_2(locale: string | undefined): string | undefined {
  const short = locale?.trim().toLowerCase().split(/[-_]/)[0]
  if (!short || short.length !== 2) return undefined
  return LANGUAGE_DATA.find((language) => language.iso1 === short)?.code
}

/**
 * The audio and subtitle defaults setup should apply, without asking.
 *
 * Anime is overwhelmingly watched subbed, so an anime library gets Japanese audio with English
 * subtitles — the pairing the old wizard shipped as its defaults anyway. A films-only library has
 * no such convention, so it follows the system language for both and shows no subtitles by
 * preference, which is what someone watching in their own language expects.
 *
 * Falls back to English when the system language is one the ISO table cannot resolve.
 */
export function defaultPlaybackLanguages(intent: OnboardingIntent, locale?: string): PlaybackLanguages {
  if (intent.anime) return { audio: 'jpn', subtitle: 'eng' }
  const system = iso639_2(locale) ?? 'eng'
  return { audio: system, subtitle: system }
}
