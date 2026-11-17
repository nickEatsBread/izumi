import { persisted } from 'svelte-persisted-store'
import type { ThemeSettingValue } from './theme-settings'

/** The viewer's theme settings, by design id, then setting key. Per device, like the designs they
 *  belong to, so not synced. A missing value is the theme's default (theme-settings.ts). */
export const themeSettingValues = persisted<Record<string, Record<string, ThemeSettingValue>>>('theme-setting-values-v1', {})

export function setThemeSetting(designId: string, key: string, value: ThemeSettingValue): void {
  themeSettingValues.update((all) => ({ ...all, [designId]: { ...all[designId], [key]: value } }))
}

/** Back to every default the theme declares. */
export function resetThemeSettings(designId: string): void {
  themeSettingValues.update((all) => {
    if (!(designId in all)) return all
    const { [designId]: _dropped, ...rest } = all
    return rest
  })
}
