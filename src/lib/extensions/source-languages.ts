/** A source account's playback languages, through the service settings protocol: the document's
 *  `languages` names the fields holding them, and fields marked `section: 'languages'` make up the
 *  Language section izumi shows in Settings › Languages. Reading a document keeps izumi's copy
 *  (manager.ts); saving a field of the section writes izumi's change back to the account. */
import { get } from 'svelte/store'
import { sourceAccountLanguages, SUBTITLES_OFF, type LanguageKind } from '$lib/settings/catalog-languages'
import { langsEqual } from '$lib/stremio/sublang'
import {
  extensionServiceSettings,
  saveExtensionServiceSettings,
  type ServiceSettingField,
  type ServiceSettingsDocument,
  type ServiceSettingValue,
} from './manager'

const FRESH_MS = 10 * 60_000
const checked = new Map<string, number>()
const inflight = new Map<string, Promise<void>>()

/** The fields a source shows in izumi's Language settings. A field's `visibleWhen` counts only when
 *  it names another field of the same section: the rest belong to the source's own sheet. */
export function languageSectionFields(document: Pick<ServiceSettingsDocument, 'fields' | 'values'>): ServiceSettingField[] {
  const fields = document.fields.filter((field) => field.section === 'languages')
  const keys = new Set(fields.map((field) => field.key))
  return fields.filter((field) => {
    const condition = field.visibleWhen
    if (!condition || !keys.has(condition.key)) return true
    const current = document.values[condition.key]
    return Array.isArray(condition.equals) ? condition.equals.includes(current) : condition.equals === current
  })
}

/** Ask the source again when what izumi holds is older than ten minutes. Never throws: a source
 *  without settings, or one that is down, leaves the catalog on its other languages. */
export function refreshSourceLanguages(packageId: string, maxAgeMs = FRESH_MS): Promise<void> {
  const at = Math.max(get(sourceAccountLanguages)[packageId]?.at ?? 0, checked.get(packageId) ?? 0)
  if (Date.now() - at < maxAgeMs) return Promise.resolve()
  let job = inflight.get(packageId)
  if (!job) {
    job = extensionServiceSettings(packageId)
      .then(() => undefined, () => undefined)
      .finally(() => {
        checked.set(packageId, Date.now())
        inflight.delete(packageId)
      })
    inflight.set(packageId, job)
  }
  return job
}

/** Save one field of the Language section, posting only that field: re-sending the section's other
 *  values could put back an older one when the last reply was read before the account caught up.
 *  Returns the refreshed document (re-read when the source answered with a short result). */
export async function saveSourceLanguageSection(
  packageId: string,
  key: string,
  value: ServiceSettingValue,
): Promise<ServiceSettingsDocument> {
  const result = await saveExtensionServiceSettings(packageId, { [key]: value })
  if (result?.ok === false) throw new Error(result.message || 'The source did not save the change.')
  return result?.version === 1 && Array.isArray(result.fields) && result.values
    ? result as ServiceSettingsDocument
    : extensionServiceSettings(packageId)
}

/** The account's option for a picked language: the exact tag, else the current value when it is the
 *  same language, else the first option of that language (`ja` → `ja-JP`). */
export function accountOption(options: ReadonlyArray<{ value: string }>, tag: string, current: unknown): string | undefined {
  if (tag === SUBTITLES_OFF) return options.find((option) => option.value.toLowerCase() === SUBTITLES_OFF)?.value
  const exact = options.find((option) => option.value.toLowerCase() === tag.toLowerCase())
  if (exact) return exact.value
  if (typeof current === 'string' && current && langsEqual(current, tag)) return current
  return options.find((option) => option.value && langsEqual(option.value, tag))?.value
}

/** A language picked in the player, saved to the account field that holds that kind
 *  (player/language-memory.ts). Nothing is sent when the account has no such option or already
 *  holds it. */
export async function saveSourceLanguagePick(packageId: string, kind: LanguageKind, tag: string): Promise<void> {
  const document = await extensionServiceSettings(packageId)
  const key = document.languages?.[kind]
  const field = key ? document.fields.find((candidate) => candidate.key === key && candidate.type === 'select') : undefined
  const option = field ? accountOption(field.options ?? [], tag, document.values[field.key]) : undefined
  if (field && option !== undefined && option !== document.values[field.key]) await saveSourceLanguageSection(packageId, field.key, option)
}
