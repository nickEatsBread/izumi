// Which theme layout applies. A theme's layout (its Home and navigation) applies automatically while
// the theme is active; `theme-layout-enabled-v1` remembers, per design, when the user turned it off.
import { getContext, setContext } from 'svelte'
import { derived, type Readable } from 'svelte/store'
import { persisted } from 'svelte-persisted-store'
import { themeStudioPreview } from '$lib/settings/theme-studio'
import { MAX_THEME_SCREENS, type ThemeLayout, type ThemeLayoutScreen } from './presentation'
import { themePresentation } from './runtime'
import { effectiveStudioTheme, effectiveThemePreset } from './screen-theme'

export const themeLayoutEnabled = persisted<Record<string, boolean>>('theme-layout-enabled-v1', {})

/** The design whose layout would apply: a previewed design, else the active custom or installed one. */
export const activeThemeKey = derived([themeStudioPreview, effectiveThemePreset, effectiveStudioTheme], ([preview, preset, theme]) =>
  preview?.id ?? (preset === 'custom' ? theme.id : null))

export const activeThemeName = derived([themeStudioPreview, effectiveStudioTheme], ([preview, theme]) => preview?.name ?? theme.name)

/** The layout the active theme offers, whether or not its switch is on. */
export const offeredThemeLayout = derived([themePresentation, activeThemeKey], ([presentation, key]): ThemeLayout | null =>
  key && presentation?.layout ? presentation.layout : null)

/** The layout in force: offered and not switched off. */
export const activeThemeLayout = derived([offeredThemeLayout, activeThemeKey, themeLayoutEnabled], ([layout, key, enabled]): ThemeLayout | null =>
  layout && key && enabled[key] !== false ? layout : null)

/** API 8: the active theme's own screens, in its order and never more than the client's limit. They follow
 *  the layout switch like the rest of the theme layout. */
export const themeScreens = derived(activeThemeLayout, (layout): ThemeLayoutScreen[] => layout?.screens?.slice(0, MAX_THEME_SCREENS) ?? [])

const OPEN_SCREEN = Symbol('theme-screen')
/** The theme screen page hands its screen to the Home hosts it renders (call during component init). */
export function provideThemeScreen(screen: Readable<ThemeLayoutScreen | null>): void {
  setContext(OPEN_SCREEN, screen)
}
/** The theme screen this component sits under, when it does (call during component init). */
export function openThemeScreen(): Readable<ThemeLayoutScreen | null> | undefined {
  return getContext<Readable<ThemeLayoutScreen | null> | undefined>(OPEN_SCREEN)
}
/** The theme layout a Home host draws: on a theme screen its entries replace the theme's Home (the side
 *  column settings stay the theme's); elsewhere the theme layout itself. */
export function homeLayoutFor(screen: Readable<ThemeLayoutScreen | null> | undefined): Readable<ThemeLayout | null> {
  if (!screen) return activeThemeLayout
  return derived([activeThemeLayout, screen], ([layout, open]) => (open ? { ...layout, home: open.home } : null))
}

export function setThemeLayoutEnabled(key: string, on: boolean): void {
  themeLayoutEnabled.update((all) => ({ ...all, [key]: on }))
}
