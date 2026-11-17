// A source's own profiles ("Who's watching?"): the settings field its document marks `role: "profile"`,
// a select whose options are the account's profiles (with avatars). izumi offers them outside the
// settings sheet, as the source's own handheld app does at launch and from its menu.
import type { ServiceSettingField, ServiceSettingValue, ServiceSettingsDocument } from './manager'

export interface SourceProfile {
  id: string
  name: string
  image?: string
  backdrop?: string
  current: boolean
}

export interface SourceProfiles {
  field: ServiceSettingField
  profiles: SourceProfile[]
}

/** The document's profile picker, when it has one with more than one profile to choose from. */
export function sourceProfiles(document: ServiceSettingsDocument): SourceProfiles | undefined {
  const field = document.fields.find((item) => item.role === 'profile' && item.type === 'select')
  const options = field?.options ?? []
  if (!field || options.length < 2) return undefined
  const current = document.values[field.key]
  return {
    field,
    profiles: options.map((option) => ({
      id: option.value,
      name: option.label,
      ...(option.image ? { image: option.image } : {}),
      ...(option.backdrop ? { backdrop: option.backdrop } : {}),
      current: option.value === current,
    })),
  }
}

/** What to save to switch to `profileId`: the field, plus the value its `visibleWhen` waits on (the
 *  account action that shows the picker in the settings sheet), so the source reads it as chosen there. */
export function profileChoice(field: ServiceSettingField, profileId: string): Record<string, ServiceSettingValue> {
  const condition = field.visibleWhen
  const wanted = condition ? (Array.isArray(condition.equals) ? condition.equals[0] : condition.equals) : undefined
  return {
    ...(condition && wanted !== undefined ? { [condition.key]: wanted } : {}),
    [field.key]: profileId,
  }
}
