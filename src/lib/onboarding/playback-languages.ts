import { LANGUAGE_DATA } from '$lib/shared/languages'

/** ISO 639-1 (what a browser locale carries) to the ISO 639-2 code the playback settings store. */
export function iso639_2(locale: string | undefined): string | undefined {
  const short = locale?.trim().toLowerCase().split(/[-_]/)[0]
  if (!short || short.length !== 2) return undefined
  return LANGUAGE_DATA.find((language) => language.iso1 === short)?.code
}
