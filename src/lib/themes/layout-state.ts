// Which theme layout applies. A theme's layout (its Home and navigation) applies automatically while
// the theme is active; `theme-layout-enabled-v1` remembers, per design, when the user turned it off.
import { derived } from 'svelte/store'
import { persisted } from 'svelte-persisted-store'
import { activeStudioTheme, activeStudioThemeId, themeStudioPreview } from '$lib/settings/theme-studio'
import { themePreset } from '$lib/settings/ui'
import type { ThemeLayout } from './presentation'
import { themePresentation } from './runtime'

export const themeLayoutEnabled = persisted<Record<string, boolean>>('theme-layout-enabled-v1', {})

/** The design whose layout would apply: a previewed design, else the active custom or installed one. */
export const activeThemeKey = derived([themeStudioPreview, themePreset, activeStudioThemeId], ([preview, preset, id]) =>
  preview?.id ?? (preset === 'custom' ? id : null))

export const activeThemeName = derived([themeStudioPreview, activeStudioTheme], ([preview, theme]) => preview?.name ?? theme.name)

/** The layout the active theme offers, whether or not its switch is on. */
export const offeredThemeLayout = derived([themePresentation, activeThemeKey], ([presentation, key]): ThemeLayout | null =>
  key && presentation?.layout ? presentation.layout : null)

/** The layout in force: offered and not switched off. */
export const activeThemeLayout = derived([offeredThemeLayout, activeThemeKey, themeLayoutEnabled], ([layout, key, enabled]): ThemeLayout | null =>
  layout && key && enabled[key] !== false ? layout : null)

export function setThemeLayoutEnabled(key: string, on: boolean): void {
  themeLayoutEnabled.update((all) => ({ ...all, [key]: on }))
}
