import { derived } from 'svelte/store'
import { activeStudioTheme, themeStudioPreview } from '$lib/settings/theme-studio'
import { themePreset } from '$lib/settings/ui'
import { isMobile, isTv } from '$lib/platform'
import { resolvePresentation, type ThemeNavPlacement } from './presentation'
// The active presentation for THIS surface: a package's `mobile` block is layered over its shared
// layout on phones and dropped everywhere else, so every consumer reads one already-resolved tree.
export const themePresentation = derived([activeStudioTheme, themeStudioPreview, themePreset, isMobile], ([theme, preview, preset, mobile]) =>
  resolvePresentation(preview?.presentation ?? (preview ? undefined : preset === 'custom' ? theme.presentation : undefined), mobile))

// Where the navigation chrome sits on THIS surface: phones always use the bottom bar, TVs the side
// rail, and desktops follow the theme's `shell.nav`. The app shell and the player both read it, so
// the video is inset from exactly the edge the chrome occupies.
export const shellNav = derived([isMobile, isTv, themePresentation], ([mobile, tv, presentation]): ThemeNavPlacement =>
  mobile ? 'bottom' : tv ? 'sidebar' : (presentation?.shell?.nav ?? 'sidebar'))
