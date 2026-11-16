/** A source account's playback languages, through the service settings protocol: the document's
 *  `languages` names the fields holding them, and fields marked `section: 'languages'` make up the
 *  Language section izumi shows in Settings › Languages. Reading a document keeps izumi's copy
 *  (manager.ts); saving the section writes izumi's change back to the account. */
import { get } from 'svelte/store'
import { sourceAccountLanguages } from '$lib/settings/catalog-languages'
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

/** Save the Language section with one field changed, posting only that section's fields. Returns
 *  the refreshed document (re-read when the source answered with a short result). */
export async function saveSourceLanguageSection(
  packageId: string,
  document: ServiceSettingsDocument,
  key: string,
  value: ServiceSettingValue,
): Promise<ServiceSettingsDocument> {
  // Only fields the document has a value for: a missing one must not be posted as cleared.
  const values = Object.fromEntries(document.fields
    .filter((field) => field.section === 'languages' && field.key in document.values)
    .map((field) => [field.key, document.values[field.key]]))
  const result = await saveExtensionServiceSettings(packageId, { ...values, [key]: value })
  if (result?.ok === false) throw new Error(result.message || 'The source did not save the change.')
  return result?.version === 1 && Array.isArray(result.fields) && result.values
    ? result as ServiceSettingsDocument
    : extensionServiceSettings(packageId)
}
