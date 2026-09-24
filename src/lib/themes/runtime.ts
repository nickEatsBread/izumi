import { derived } from 'svelte/store'
import { activeStudioTheme, themeStudioPreview } from '$lib/settings/theme-studio'
import { themePreset } from '$lib/settings/ui'
import { isMobile } from '$lib/platform'
import { resolvePresentation } from './presentation'
// The active presentation for THIS surface: a package's `mobile` block is layered over its shared
// layout on phones and dropped everywhere else, so every consumer reads one already-resolved tree.
export const themePresentation = derived([activeStudioTheme, themeStudioPreview, themePreset, isMobile], ([theme, preview, preset, mobile]) =>
  resolvePresentation(preview?.presentation ?? (preview ? undefined : preset === 'custom' ? theme.presentation : undefined), mobile))
