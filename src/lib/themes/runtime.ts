import { derived } from 'svelte/store'
import { activeStudioTheme, themeStudioPreview } from '$lib/settings/theme-studio'
import { themePreset } from '$lib/settings/ui'
export const themePresentation = derived([activeStudioTheme, themeStudioPreview, themePreset], ([theme, preview, preset]) =>
  preview?.presentation ?? (preview ? undefined : preset === 'custom' ? theme.presentation : undefined))
