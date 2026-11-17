/** Theme API 9: settings a theme declares and its stylesheet reads. Each one becomes, on <html>:
 *  - a toggle: `data-theme-setting-<key>="on"` or `"off"`;
 *  - a choice: `data-theme-setting-<key>="<option value>"`;
 *  - a colour: `--theme-setting-<key>: #rrggbb`.
 *  The viewer changes them on the theme's page and in Settings → Appearance. Pure, with no imports, so
 *  izumi-themes can copy this file into its validator unchanged. */

export type ThemeSettingType = 'toggle' | 'choice' | 'color'
export type ThemeSettingValue = boolean | string
export interface ThemeSettingOption { value: string; label: string }
export interface ThemeSetting {
  key: string
  label: string
  description?: string
  type: ThemeSettingType
  default: ThemeSettingValue
  /** A choice's options, 2 to 8. */
  options?: ThemeSettingOption[]
}

export const MAX_THEME_SETTINGS = 16
const KEY = /^[a-z][a-z0-9-]{0,31}$/
const VALUE = /^[a-z0-9][a-z0-9-]{0,31}$/
const COLOR = /^#[0-9a-f]{6}$/i

function invalid(message: string): never {
  throw new Error(`Theme settings: ${message}`)
}

function label(value: unknown, max: number, what: string): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max) invalid(`${what} must be text of up to ${max} characters.`)
  return value.trim()
}

/** A theme's `settings`, checked. Throws on anything this client can't show. */
export function parseThemeSettings(value: unknown): ThemeSetting[] {
  if (!Array.isArray(value) || value.length > MAX_THEME_SETTINGS) invalid(`a list of up to ${MAX_THEME_SETTINGS} settings is expected.`)
  const keys = new Set<string>()
  return value.map((item): ThemeSetting => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) invalid('each setting is an object.')
    const raw = item as Record<string, unknown>
    const allowed = ['key', 'label', 'description', 'type', 'default', 'options']
    const extra = Object.keys(raw).find((key) => !allowed.includes(key))
    if (extra) invalid(`unknown field "${extra}".`)
    if (typeof raw.key !== 'string' || !KEY.test(raw.key)) invalid('a key is lowercase letters, digits and hyphens, starting with a letter (up to 32).')
    if (keys.has(raw.key)) invalid(`the key "${raw.key}" is used twice.`)
    keys.add(raw.key)
    const base = {
      key: raw.key,
      label: label(raw.label, 48, `"${raw.key}" label`),
      ...(raw.description !== undefined ? { description: label(raw.description, 160, `"${raw.key}" description`) } : {}),
    }
    if (raw.type === 'toggle') {
      if (typeof raw.default !== 'boolean' || raw.options !== undefined) invalid(`"${raw.key}" is a toggle: its default is true or false, with no options.`)
      return { ...base, type: 'toggle', default: raw.default }
    }
    if (raw.type === 'color') {
      if (typeof raw.default !== 'string' || !COLOR.test(raw.default) || raw.options !== undefined) invalid(`"${raw.key}" is a colour: its default is #rrggbb, with no options.`)
      return { ...base, type: 'color', default: raw.default.toLowerCase() }
    }
    if (raw.type === 'choice') {
      if (!Array.isArray(raw.options) || raw.options.length < 2 || raw.options.length > 8) invalid(`"${raw.key}" is a choice of 2 to 8 options.`)
      const values = new Set<string>()
      const options = raw.options.map((option): ThemeSettingOption => {
        const entry = option && typeof option === 'object' ? option as Record<string, unknown> : {}
        if (typeof entry.value !== 'string' || !VALUE.test(entry.value) || values.has(entry.value)) invalid(`"${raw.key}" options need distinct values of lowercase letters, digits and hyphens.`)
        values.add(entry.value)
        return { value: entry.value, label: label(entry.label, 48, `"${raw.key}" option label`) }
      })
      if (typeof raw.default !== 'string' || !values.has(raw.default)) invalid(`"${raw.key}" default must be one of its options.`)
      return { ...base, type: 'choice', default: raw.default, options }
    }
    return invalid(`"${raw.key}" type must be toggle, choice or color.`)
  })
}

/** A stored value, or the default when it is missing or no longer fits the setting. */
export function settingValue(setting: ThemeSetting, stored: unknown): ThemeSettingValue {
  if (setting.type === 'toggle') return typeof stored === 'boolean' ? stored : setting.default
  if (setting.type === 'color') return typeof stored === 'string' && COLOR.test(stored) ? stored.toLowerCase() : setting.default
  return typeof stored === 'string' && setting.options?.some((option) => option.value === stored) ? stored : setting.default
}

/** What <html> carries for a theme's settings: attributes for toggles and choices, custom properties
 *  for colours. */
export function themeSettingHooks(settings: readonly ThemeSetting[] | undefined, stored: Record<string, unknown> | undefined): {
  attributes: Record<string, string>
  properties: Record<string, string>
} {
  const attributes: Record<string, string> = {}
  const properties: Record<string, string> = {}
  for (const setting of settings ?? []) {
    const value = settingValue(setting, stored?.[setting.key])
    if (setting.type === 'color') properties[`--theme-setting-${setting.key}`] = String(value)
    else attributes[`data-theme-setting-${setting.key}`] = setting.type === 'toggle' ? (value ? 'on' : 'off') : String(value)
  }
  return { attributes, properties }
}
