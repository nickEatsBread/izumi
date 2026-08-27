import type {
  ServiceSettingCondition,
  ServiceSettingField,
  ServiceSettingOption,
  ServiceSettingValue,
  ServiceSettingsDocument,
} from './manager'

export interface ServiceSubmitPresentation {
  label: string
  submittingLabel: string
  intent: 'primary' | 'danger'
  hidden: boolean
  description?: string
}

export function matchesServiceSettingCondition(
  condition: ServiceSettingCondition | undefined,
  values: Record<string, ServiceSettingValue>,
): boolean {
  if (!condition) return true
  const expected = Array.isArray(condition.equals) ? condition.equals : [condition.equals]
  return expected.some((value) => value === values[condition.key])
}

export function visibleServiceSettingFields(
  document: Pick<ServiceSettingsDocument, 'fields'>,
  values: Record<string, ServiceSettingValue>,
): ServiceSettingField[] {
  return document.fields.filter((field) => matchesServiceSettingCondition(field.visibleWhen, values))
}

export function actionOption(
  document: Pick<ServiceSettingsDocument, 'fields'>,
  values: Record<string, ServiceSettingValue>,
): ServiceSettingOption | undefined {
  const field = document.fields.find((candidate) => candidate.role === 'action' && candidate.type === 'select')
  return field?.options?.find((option) => option.value === String(values[field.key] ?? ''))
}

export function serviceSubmitPresentation(
  document: Pick<ServiceSettingsDocument, 'fields' | 'submitLabel' | 'submittingLabel'>,
  values: Record<string, ServiceSettingValue>,
): ServiceSubmitPresentation {
  const option = actionOption(document, values)
  return {
    label: option?.submitLabel || document.submitLabel || 'Save settings',
    submittingLabel: option?.submittingLabel || document.submittingLabel || 'Saving…',
    intent: option?.intent || 'primary',
    hidden: option?.hideSubmit === true,
    description: option?.description,
  }
}
