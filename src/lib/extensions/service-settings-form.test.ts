import { describe, expect, it } from 'vitest'
import type { ServiceSettingsDocument } from './manager'
import {
  matchesServiceSettingCondition,
  serviceSubmitPresentation,
  visibleServiceSettingFields,
} from './service-settings-form'

const document: ServiceSettingsDocument = {
  version: 1,
  fields: [
    {
      key: 'action',
      label: 'Account action',
      type: 'select',
      role: 'action',
      options: [
        { value: 'keep', label: 'Keep account', hideSubmit: true },
        { value: 'code', label: 'TV code', submitLabel: 'Get TV code', submittingLabel: 'Getting code…' },
        { value: 'logout', label: 'Sign out', submitLabel: 'Sign out', intent: 'danger' },
      ],
    },
    { key: 'email', label: 'Email', type: 'text', visibleWhen: { key: 'action', equals: 'password' } },
    { key: 'codeHelp', label: 'Code help', type: 'text', visibleWhen: { key: 'action', equals: ['code', 'keep'] } },
  ],
  values: { action: 'keep', email: '', codeHelp: '' },
}

describe('reactive service settings', () => {
  it('matches scalar and list conditions', () => {
    expect(matchesServiceSettingCondition({ key: 'action', equals: 'code' }, { action: 'code' })).toBe(true)
    expect(matchesServiceSettingCondition({ key: 'action', equals: ['code', 'keep'] }, { action: 'keep' })).toBe(true)
    expect(matchesServiceSettingCondition({ key: 'action', equals: 'logout' }, { action: 'keep' })).toBe(false)
  })

  it('only returns fields relevant to current values', () => {
    expect(visibleServiceSettingFields(document, { ...document.values, action: 'password' }).map((field) => field.key))
      .toEqual(['action', 'email'])
    expect(visibleServiceSettingFields(document, document.values).map((field) => field.key))
      .toEqual(['action', 'codeHelp'])
  })

  it('derives the primary action from the selected option', () => {
    expect(serviceSubmitPresentation(document, document.values).hidden).toBe(true)
    expect(serviceSubmitPresentation(document, { ...document.values, action: 'code' })).toMatchObject({
      label: 'Get TV code',
      submittingLabel: 'Getting code…',
      intent: 'primary',
      hidden: false,
    })
    expect(serviceSubmitPresentation(document, { ...document.values, action: 'logout' })).toMatchObject({
      label: 'Sign out',
      intent: 'danger',
    })
  })
})
