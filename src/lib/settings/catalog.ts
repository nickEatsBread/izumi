import { persisted } from 'svelte-persisted-store'
import { derived, get, writable } from 'svelte/store'

export type CatalogSelection = 'auto' | 'anilist' | 'kitsu' | 'tmdb' | 'stremio' | 'jvm'
/** A user-made screen: a named Merged screen with a Home layout (and optionally a theme) of its own. */
export type CustomScreenId = `custom:${string}`
export type CatalogScreen = CatalogSelection | 'merged' | CustomScreenId
export type CatalogDefaultSelection = CatalogScreen | 'adaptive'
export type CatalogMode = 'separate' | 'merged'
export type ContinueWatchingCatalogScope = 'provider' | 'all'
export type CatalogSwitcherPlacement = 'automatic' | 'integrated' | 'below'
export type StremioHeroArtwork = 'backdrop' | 'cover'

export const CATALOG_SELECTIONS: CatalogSelection[] = ['auto', 'anilist', 'kitsu', 'tmdb', 'stremio', 'jvm']

export interface CustomScreen { id: string; name: string }
export const CUSTOM_SCREEN_LIMIT = 12
const CUSTOM_SCREEN_ID = /^[a-z0-9]{1,24}$/

export function normalizeCustomScreens(value: unknown): CustomScreen[] {
  if (!Array.isArray(value)) return []
  const screens = new Map<string, CustomScreen>()
  for (const item of value) {
    const raw = item && typeof item === 'object' ? item as Partial<CustomScreen> : {}
    const name = typeof raw.name === 'string' ? raw.name.trim().replace(/\s+/g, ' ').slice(0, 32) : ''
    if (typeof raw.id !== 'string' || !CUSTOM_SCREEN_ID.test(raw.id) || !name || screens.has(raw.id)) continue
    screens.set(raw.id, { id: raw.id, name })
    if (screens.size >= CUSTOM_SCREEN_LIMIT) break
  }
  return [...screens.values()]
}

export const customScreens = persisted<CustomScreen[]>('catalog-custom-screens-v1', [], { beforeRead: normalizeCustomScreens })
export const customScreenId = (id: string): CustomScreenId => `custom:${id}`
export const isCustomScreen = (screen: unknown): screen is CustomScreenId => typeof screen === 'string' && screen.startsWith('custom:')
/** Screens that compose rows from every enabled catalog: Merged, and every custom screen. */
export const isMergedScreen = (screen: unknown): screen is 'merged' | CustomScreenId => screen === 'merged' || isCustomScreen(screen)

const CATALOG_LABELS: Record<Exclude<CatalogDefaultSelection, CustomScreenId>, string> = {
  adaptive: 'Adaptive',
  merged: 'Merged',
  auto: 'Automatic anime',
  anilist: 'AniList',
  kitsu: 'Kitsu',
  tmdb: 'TMDB',
  stremio: 'Stremio',
  jvm: 'Aniyomi sources',
}

/** Pass `custom` from a component's `$customScreens`, so a renamed screen relabels at once. */
export function catalogLabel(provider: CatalogDefaultSelection, custom: CustomScreen[] = get(customScreens)): string {
  if (!isCustomScreen(provider)) return CATALOG_LABELS[provider]
  return custom.find((screen) => customScreenId(screen.id) === provider)?.name ?? 'Custom screen'
}

export function normalizeCatalogProviders(value: unknown, fallback: CatalogSelection = 'auto'): CatalogSelection[] {
  if (!Array.isArray(value)) return [fallback]
  const valid = value.filter((item): item is CatalogSelection =>
    typeof item === 'string' && CATALOG_SELECTIONS.includes(item as CatalogSelection))
  return [...new Set(valid)].length ? [...new Set(valid)] : [fallback]
}

function adjacentCatalogProvider(
  current: CatalogSelection,
  providers: unknown,
  direction: 1 | -1,
): CatalogSelection {
  const enabled = normalizeCatalogProviders(providers, current)
  const index = enabled.indexOf(current)
  if (index < 0) return enabled[0]
  return enabled[(index + direction + enabled.length) % enabled.length]
}

export const nextCatalogProvider = (current: CatalogSelection, providers: unknown): CatalogSelection =>
  adjacentCatalogProvider(current, providers, 1)

export const previousCatalogProvider = (current: CatalogSelection, providers: unknown): CatalogSelection =>
  adjacentCatalogProvider(current, providers, -1)

export function resolveCatalogStartup(
  defaultProvider: unknown,
  lastProvider: unknown,
  providers: unknown,
): CatalogSelection {
  const enabled = normalizeCatalogProviders(providers)
  if (defaultProvider === 'adaptive'
      && typeof lastProvider === 'string'
      && CATALOG_SELECTIONS.includes(lastProvider as CatalogSelection)
      && enabled.includes(lastProvider as CatalogSelection)) return lastProvider as CatalogSelection
  if (typeof defaultProvider === 'string'
      && CATALOG_SELECTIONS.includes(defaultProvider as CatalogSelection)
      && enabled.includes(defaultProvider as CatalogSelection)) return defaultProvider as CatalogSelection
  return enabled[0]
}

/** `auto` preserves Izumi's anime-first experience and uses the existing AniList → Kitsu → Jikan
 * circuit breaker. Kitsu/TMDB/Stremio selections use their native adapters and identities. */
const legacyCatalogProvider = persisted<CatalogSelection>('catalog-provider', 'auto')

/** The platform selected when a new app session starts. Existing installs inherit their previous
 * single-platform choice once; changing the active platform through the logo does not rewrite it. */
export const catalogDefaultProvider = persisted<CatalogDefaultSelection>(
  'catalog-default-provider',
  get(legacyCatalogProvider),
)

/** Platforms available to the user. The original single-provider store remains the active tab so
 * existing installs and all provider-specific filters keep their behaviour. */
export const catalogProviders = persisted<CatalogSelection[]>('catalog-providers', [get(legacyCatalogProvider)])
export const enabledCatalogProviders = derived(catalogProviders, ($providers) => normalizeCatalogProviders($providers))

/** Automatic anime already queries AniList, so a separately enabled AniList entry would duplicate
 * every result in a merged view. Keep the user's stored choices intact and collapse only at use. */
export function mergedCatalogProviders(value: unknown): CatalogSelection[] {
  const providers = normalizeCatalogProviders(value)
  return providers.includes('auto') ? providers.filter((provider) => provider !== 'anilist') : providers
}

/** The old release made Merged a global mode. Keep its value only as a one-time migration seed;
 * Merged is now a normal destination beside the enabled providers in the Home picker. */
const legacyCatalogMode = persisted<CatalogMode>('catalog-mode', 'separate')
const legacyWasMerged = get(legacyCatalogMode) === 'merged'
// Carry the old global choice into the equivalent fixed Home destination exactly once.
if (legacyWasMerged) catalogDefaultProvider.set('merged')

/** Merged is useful only when it can combine at least two distinct provider experiences. Automatic
 * anime already contains AniList, so enabling both does not manufacture a duplicate screen. */
/** Custom screens follow the built-in ones. Callers that must only see built-in screens (the TV
 *  companion) leave `custom` out. */
export function catalogScreens(value: unknown, custom: CustomScreen[] = []): CatalogScreen[] {
  const providers = normalizeCatalogProviders(value)
  const builtIn: CatalogScreen[] = mergedCatalogProviders(providers).length > 1 ? [...providers, 'merged'] : providers
  return [...builtIn, ...custom.map((screen) => customScreenId(screen.id))]
}

export const enabledCatalogScreens = derived([catalogProviders, customScreens], ([$providers, $custom]) => catalogScreens($providers, $custom))

function adjacentCatalogScreen(
  current: CatalogScreen,
  providers: unknown,
  direction: 1 | -1,
  custom: CustomScreen[],
): CatalogScreen {
  const screens = catalogScreens(providers, custom)
  const index = screens.indexOf(current)
  if (index < 0) return screens[0]
  return screens[(index + direction + screens.length) % screens.length]
}

export const nextCatalogScreen = (current: CatalogScreen, providers: unknown, custom: CustomScreen[] = []): CatalogScreen =>
  adjacentCatalogScreen(current, providers, 1, custom)

export const previousCatalogScreen = (current: CatalogScreen, providers: unknown, custom: CustomScreen[] = []): CatalogScreen =>
  adjacentCatalogScreen(current, providers, -1, custom)

/** The last platform the user actually selected. It is written at switch time rather than only on
 * exit, so Adaptive also survives a crash or forced Steam shutdown. A fixed default does not alter
 * this value merely by being restored at launch. */
export const catalogLastProvider = persisted<CatalogSelection>('catalog-last-provider', get(legacyCatalogProvider))

/** Current platform for this app session. Only explicit switches update `catalogLastProvider`;
 * startup resolves either the fixed default or Adaptive's remembered platform. */
export const catalogProvider = writable<CatalogSelection>(resolveCatalogStartup(
  get(catalogDefaultProvider),
  get(catalogLastProvider),
  get(catalogProviders),
))

export const catalogLastScreen = persisted<CatalogScreen>(
  'catalog-last-screen',
  legacyWasMerged ? 'merged' : get(catalogLastProvider),
)

export function resolveCatalogScreenStartup(
  defaultProvider: unknown,
  lastScreen: unknown,
  providers: unknown,
  custom: CustomScreen[] = [],
): CatalogScreen {
  const screens = catalogScreens(providers, custom)
  if (defaultProvider === 'adaptive'
      && typeof lastScreen === 'string'
      && screens.includes(lastScreen as CatalogScreen)) return lastScreen as CatalogScreen
  if (typeof defaultProvider === 'string'
      && screens.includes(defaultProvider as CatalogScreen)) return defaultProvider as CatalogScreen
  return screens[0]
}

/** The active Home/Search destination. Provider state stays separate so playback history and
 * provider-specific filters always retain a concrete catalog while Merged is on screen. */
export const catalogScreen = writable<CatalogScreen>(resolveCatalogScreenStartup(
  get(catalogDefaultProvider),
  get(catalogLastScreen),
  get(catalogProviders),
  get(customScreens),
))

if (legacyWasMerged) legacyCatalogMode.set('separate')

/** Compatibility read for older call sites and persisted data. New UI should use catalogScreen. */
export const catalogMode = derived(catalogScreen, ($screen): CatalogMode =>
  $screen === 'merged' ? 'merged' : 'separate')

/** By default each catalog platform gets its own Continue Watching row. Users who prefer the old
 * combined row can opt into one list spanning every platform. */
export const continueWatchingCatalogScope = persisted<ContinueWatchingCatalogScope>(
  'continue-watching-catalog-scope',
  'provider',
)

/** Keep the branded picker as the default on every platform without taking either explicit
 * placement away from the user. */
export function resolveCatalogSwitcherPlacement(
  placement: unknown,
  _android: boolean,
): Exclude<CatalogSwitcherPlacement, 'automatic'> {
  if (placement === 'integrated' || placement === 'below') return placement
  return 'integrated'
}

/** Controls whether Home's catalog picker shares the Izumi brand control or gets its own,
 * more explicit row below it. Automatic keeps the original integrated brand picker. */
export const catalogSwitcherPlacement = persisted<CatalogSwitcherPlacement>(
  'catalog-switcher-placement',
  'automatic',
)

/** Stremio metadata normally supplies both a wide backdrop and portrait cover. Desktop users can
 * keep the cinematic backdrop treatment or deliberately retain the cover as the hero focal art. */
export const stremioHeroArtwork = persisted<StremioHeroArtwork>(
  'stremio-home-hero-artwork',
  'backdrop',
)

/** Per-source catalog visibility is independent from source/package enablement. Missing entries
 * default on, so installing a new JVM source makes it discoverable without silently changing the
 * user's explicit choices for sources they already configured. */
export const jvmCatalogSourceOverrides = persisted<Record<string, boolean>>(
  'jvm-catalog-source-overrides',
  {},
)

export function isJvmCatalogSourceEnabled(sourceId: string, overrides: unknown): boolean {
  if (!overrides || typeof overrides !== 'object' || Array.isArray(overrides)) return true
  return (overrides as Record<string, unknown>)[sourceId] !== false
}

export function selectCatalogProvider(provider: CatalogSelection): void {
  catalogProvider.set(provider)
  catalogLastProvider.set(provider)
  catalogScreen.set(provider)
  catalogLastScreen.set(provider)
}

export function selectCatalogScreen(screen: CatalogScreen): void {
  if (isMergedScreen(screen)) {
    catalogScreen.set(screen)
    catalogLastScreen.set(screen)
    return
  }
  selectCatalogProvider(screen)
}

/** The TV companion and cloud profile know only built-in screens: a custom one reads as its concrete provider. */
export const companionScreen = (screen: CatalogScreen): Exclude<CatalogScreen, CustomScreenId> =>
  isCustomScreen(screen) ? get(catalogProvider) : screen

/** A desktop app cannot safely embed a shared TMDB application credential in its distributable.
 * Users may supply their own read token; packaged/private builds can instead set PUBLIC_TMDB_READ_TOKEN. */
export const tmdbReadToken = persisted<string>('tmdb-read-token', '')

/** Optional enrichment credential for IMDb, Rotten Tomatoes and Metacritic ratings. */
export const omdbApiKey = persisted<string>('omdb-api-key', '')

export const isLegacyAniListCatalog = (provider: CatalogSelection): boolean =>
  provider === 'auto' || provider === 'anilist'
