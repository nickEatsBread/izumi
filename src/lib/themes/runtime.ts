import { derived } from 'svelte/store'
import { activeStudioTheme, themeStudioPreview } from '$lib/settings/theme-studio'
import { themePreset } from '$lib/settings/ui'
import { isMobile, isTv } from '$lib/platform'
import { gameMode } from '$lib/player/session'
import { resolvePlayerControls, resolvePlayerDock, resolvePresentation, resolveSearch, shellNavFor, type ThemeNavPlacement } from './presentation'
import { themeSafeMode } from './safe-mode'

/** API 6: a TV surface — an Android TV, or Game mode on a handheld — gets the theme's `tv` block. */
export const tvSurface = derived([isTv, gameMode], ([tv, gm]) => tv || gm)

// The theme's presentation before any surface block is layered (safe mode: none at all).
const activeLayout = derived([activeStudioTheme, themeStudioPreview, themePreset, themeSafeMode], ([theme, preview, preset, safe]) =>
  safe ? undefined : preview?.presentation ?? (preview ? undefined : preset === 'custom' ? theme.presentation : undefined))

// The active presentation for THIS surface: a package's `mobile` block is layered over its shared layout
// on phones, its `tv` block on TV surfaces, and both are dropped everywhere else, so every consumer reads
// one already-resolved tree. Safe mode drops it entirely so every consumer falls back to izumi's default.
export const themePresentation = derived([activeLayout, isMobile, tvSurface], ([layout, mobile, tv]) => resolvePresentation(layout, mobile, tv))

/** API 6: the TV block's `search.keyboard: "grid"` docks the grid keyboard on the Search page, and its
 *  search field then takes no other keyboard. */
export const searchGridKeyboard = derived([tvSurface, themePresentation], ([tv, presentation]) => tv && resolveSearch(presentation).keyboard === 'grid')

/** API 6: `player.window: "full"` gives the windowed desktop player the whole window, as full screen does
 *  (the app shell hides its navigation and the player and the video drop their insets). Not for a docked
 *  player, which is laid out inside the browse chrome, and not on phones or Android TV. */
export const playerCoversWindow = derived([isMobile, isTv, themePresentation], ([mobile, tv, presentation]) =>
  !mobile && !tv && resolvePlayerControls(presentation).window === 'full' && !resolvePlayerDock(presentation).docked)

// Where the navigation chrome sits on THIS surface: phones always use the bottom bar, Android TVs the side
// rail (or the top bar their TV block asks for), and desktops and Game mode follow the theme's `shell.nav`.
// The app shell and the player both read it, so the video is inset from exactly the edge the chrome occupies.
export const shellNav = derived([isMobile, isTv, activeLayout, themePresentation], ([mobile, tv, layout, presentation]): ThemeNavPlacement =>
  shellNavFor(mobile, tv, layout, presentation))
