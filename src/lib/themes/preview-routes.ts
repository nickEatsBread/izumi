import type { ThemePlatform, ThemeScreen } from './packages'

/** The stops of the preview tour, in order. */
export const PREVIEW_SCREENS: readonly ThemeScreen[] = ['home', 'series', 'search', 'schedule']

/** The newest Continue Watching title: the tour's Series stop opens a series the viewer knows. */
export function newestSeriesId(entries: readonly { media: { id: number }; updatedAt: number }[]): number | null {
  let newest: (typeof entries)[number] | undefined
  for (const entry of entries) if (!newest || entry.updatedAt > newest.updatedAt) newest = entry
  return newest?.media.id ?? null
}

export function screenRoute(screen: ThemeScreen, seriesId: number | null): string {
  if (screen === 'series') return seriesId == null ? '/app/home' : `/app/anime/${seriesId}`
  return `/app/${screen}`
}

export function screenOf(pathname: string): ThemeScreen | null {
  if (pathname.startsWith('/app/anime/')) return 'series'
  const name = pathname.replace(/^\/app\//, '').replace(/\/$/, '')
  return (['home', 'search', 'schedule'] as const).find((screen) => screen === name) ?? null
}

/** The theme page a preview returns to; without a store (a link or file import) the store front. */
export function themePageUrl(storeId: string | undefined, themeId: string | undefined, screen?: ThemeScreen | null, platform?: ThemePlatform): string {
  if (!storeId || !themeId) return '/app/settings/themes'
  const params = new URLSearchParams({ store: storeId, theme: themeId })
  if (screen) params.set('screen', screen)
  if (platform) params.set('platform', platform)
  return `/app/settings/themes?${params}`
}
