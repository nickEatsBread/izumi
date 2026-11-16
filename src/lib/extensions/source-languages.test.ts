import { beforeEach, describe, expect, it, vi } from 'vitest'

const manager = vi.hoisted(() => ({
  extensionServiceSettings: vi.fn(),
  saveExtensionServiceSettings: vi.fn(),
}))
vi.mock('./manager', () => manager)

import { languageSectionFields, refreshSourceLanguages, saveSourceLanguageSection } from './source-languages'
import type { ServiceSettingsDocument } from './manager'

const document: ServiceSettingsDocument = {
  version: 1,
  fields: [
    { key: 'accountAction', label: 'Account action', type: 'select', role: 'action' },
    { key: 'audioLanguage', label: 'Audio language', type: 'select', section: 'languages', visibleWhen: { key: 'accountAction', equals: 'preferences' } },
    { key: 'subtitleLanguage', label: 'Subtitle language', type: 'select', section: 'languages' },
    { key: 'subtitleStyle', label: 'Style', type: 'select', section: 'languages', visibleWhen: { key: 'subtitleLanguage', equals: ['en-US', 'fr-FR'] } },
  ],
  values: { accountAction: 'keep', audioLanguage: 'ja-JP', subtitleLanguage: '' },
  languages: { audio: 'audioLanguage', subtitle: 'subtitleLanguage' },
}

beforeEach(() => {
  manager.extensionServiceSettings.mockReset()
  manager.saveExtensionServiceSettings.mockReset()
})

describe('Language section', () => {
  it('shows the section fields, honouring only conditions within the section', () => {
    expect(languageSectionFields(document).map((field) => field.key)).toEqual(['audioLanguage', 'subtitleLanguage'])
    expect(languageSectionFields({ ...document, values: { ...document.values, subtitleLanguage: 'fr-FR' } }).map((field) => field.key))
      .toEqual(['audioLanguage', 'subtitleLanguage', 'subtitleStyle'])
  })

  it('posts only the changed field', async () => {
    const next = { ...document, values: { ...document.values, audioLanguage: 'en-US' } }
    manager.saveExtensionServiceSettings.mockResolvedValue({ ...next, ok: true, message: 'Saved' })
    await expect(saveSourceLanguageSection('video.example', 'audioLanguage', 'en-US')).resolves.toMatchObject({ values: next.values })
    expect(manager.saveExtensionServiceSettings).toHaveBeenCalledWith('video.example', { audioLanguage: 'en-US' })
  })

  it('reads the document again after a short answer, and reports a refusal', async () => {
    manager.saveExtensionServiceSettings.mockResolvedValueOnce({ ok: true })
    manager.extensionServiceSettings.mockResolvedValueOnce(document)
    await expect(saveSourceLanguageSection('video.example', 'subtitleLanguage', 'en-US')).resolves.toBe(document)
    manager.saveExtensionServiceSettings.mockResolvedValueOnce({ ok: false, message: 'Sign in first.' })
    await expect(saveSourceLanguageSection('video.example', 'subtitleLanguage', 'en-US')).rejects.toThrow('Sign in first.')
  })
})

describe('refreshSourceLanguages', () => {
  it('asks once at a time, then not again while fresh, and never throws', async () => {
    manager.extensionServiceSettings.mockRejectedValue(new Error('no settings'))
    await Promise.all([refreshSourceLanguages('down.example'), refreshSourceLanguages('down.example')])
    await refreshSourceLanguages('down.example')
    expect(manager.extensionServiceSettings).toHaveBeenCalledTimes(1)
    await refreshSourceLanguages('down.example', 0)
    expect(manager.extensionServiceSettings).toHaveBeenCalledTimes(2)
  })
})
