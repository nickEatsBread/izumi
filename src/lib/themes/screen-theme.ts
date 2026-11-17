// A theme chosen for one catalog screen (TMDB, Automatic anime, a custom screen…). While that screen is
// active it replaces the app theme (`themePreset` + the active design); safe mode and a Studio or install
// preview still win over it in theme.ts and runtime.ts. Writers of the app theme are untouched.
// The player theme (Settings → Appearance) works the same way while an episode opens or plays, but only
// paints: navigation, layout and every other presentation key stay with the screen or app theme.
import { derived } from 'svelte/store'
import { persisted } from 'svelte-persisted-store'
import { catalogScreen } from '$lib/settings/catalog'
import { connecting, playing } from '$lib/player/session'
import { androidMiniPlayer } from '$lib/player/android-mpv'
import { activeStudioTheme, studioThemes, type StudioTheme } from '$lib/settings/theme-studio'
import { themePreset, type ThemePreset } from '$lib/settings/ui'

export type ScreenThemeRef = Exclude<ThemePreset, 'custom'> | `design:${string}`

export const SCREEN_THEME_PRESETS: Array<{ value: Exclude<ThemePreset, 'custom'>; label: string }> = [
  { value: 'izumi', label: 'Izumi default' },
  { value: 'midnight', label: 'Midnight' },
  { value: 'sakura', label: 'Sakura' },
  { value: 'ocean', label: 'Ocean' },
  { value: 'light', label: 'Light' },
  { value: 'system', label: 'System' },
]

/** Keyed by catalog screen id. No entry: the screen follows the app theme. Designs are per device, so
 *  this map is not synced. */
export const screenThemes = persisted<Record<string, ScreenThemeRef>>('catalog-screen-themes-v1', {})

export function setScreenTheme(screen: string, ref: ScreenThemeRef | null): void {
  screenThemes.update((all) => {
    const next = { ...all }
    if (ref) next[screen] = ref
    else delete next[screen]
    return next
  })
}

/** null when the screen follows the app theme, or names a design that no longer exists. */
export function resolveScreenTheme(ref: unknown, designs: StudioTheme[]): { preset: ThemePreset; design?: StudioTheme } | null {
  if (typeof ref !== 'string') return null
  if (ref.startsWith('design:')) {
    const design = designs.find((theme) => theme.id === ref.slice('design:'.length))
    return design ? { preset: 'custom', design } : null
  }
  return SCREEN_THEME_PRESETS.some((preset) => preset.value === ref) ? { preset: ref as ThemePreset } : null
}

export function screenThemeOptions(designs: StudioTheme[]): Array<{ value: string; label: string }> {
  return [
    { value: '', label: 'Same as app' },
    ...SCREEN_THEME_PRESETS,
    ...designs.map((design) => ({ value: `design:${design.id}`, label: design.name })),
  ]
}

export const screenTheme = derived([catalogScreen, screenThemes, studioThemes], ([screen, all, designs]) => resolveScreenTheme(all[screen], designs))
/** The navigation theme: the active screen's own, else the app's. Layout, navigation and every presentation
 *  key but the player's read it. */
export const effectiveThemePreset = derived([themePreset, screenTheme], ([preset, screen]) => screen?.preset ?? preset)
/** A shipped-palette screen theme keeps the app's design here; it goes unused while the preset is not `custom`. */
export const effectiveStudioTheme = derived([activeStudioTheme, screenTheme], ([theme, screen]) => screen?.design ?? theme)

/** Settings → Appearance → Player theme. '' follows the app theme. Per device, so not synced. */
export const playerTheme = persisted<ScreenThemeRef | ''>('player-theme-v1', '')
/** An episode is opening or playing. The Android mini-player docked over the browse UI counts as browsing. */
export const playerSurfaceActive = derived([connecting, playing, androidMiniPlayer], ([opening, play, mini]) => !!opening || (play && !mini))
/** The player theme while it is in force; null when none is set or nothing is playing. */
export const activePlayerTheme = derived([playerTheme, studioThemes, playerSurfaceActive], ([ref, designs, on]) => (on ? resolveScreenTheme(ref, designs) : null))
/** The theme that paints the window (palette, fonts, stylesheet): the player theme while it is in force,
 *  else the navigation theme. */
export const shownThemePreset = derived([effectiveThemePreset, activePlayerTheme], ([preset, player]) => player?.preset ?? preset)
export const shownStudioTheme = derived([effectiveStudioTheme, activePlayerTheme], ([theme, player]) => player?.design ?? theme)
/** The active screen's own theme by name (null: it follows the app theme), for the Themes and Interface notices. */
export const screenThemeName = derived(screenTheme, (theme) => (theme
  ? theme.design?.name ?? SCREEN_THEME_PRESETS.find((preset) => preset.value === theme.preset)?.label ?? ''
  : null))
