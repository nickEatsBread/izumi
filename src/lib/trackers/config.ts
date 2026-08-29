import { persisted } from 'svelte-persisted-store'
import { get } from 'svelte/store'
import {
  PUBLIC_ANILIST_CLIENT_ID,
  PUBLIC_MAL_CLIENT_ID,
  PUBLIC_OAUTH_REDIRECT_URI,
} from '$env/static/public'
import * as publicEnv from '$env/static/public'
import { anilistToken } from '$lib/anilist/auth'
import {
  TRACKER_RATING_PROVIDERS,
  connectionOrderAfterLink,
  normalizeTrackerConnectionOrder,
  type TrackerRatingProvider,
} from './connection-order'

export { anilistToken }

// App OAuth config from ignored .env.local / CI — public client IDs + the redirect URI. Not secrets
// (AniList uses implicit grant, MAL uses PKCE). Baked in, never asked from the user.
export const anilistClientId = PUBLIC_ANILIST_CLIENT_ID
export const malClientId = PUBLIC_MAL_CLIENT_ID
// Simkl is optional in local builds. Namespace access keeps the static adapter build valid when
// a developer has not registered a public Simkl app yet.
export const simklClientId = (publicEnv as Record<string, string | undefined>).PUBLIC_SIMKL_CLIENT_ID?.trim() ?? ''
export const REDIRECT_URI = PUBLIC_OAUTH_REDIRECT_URI

// Runtime auth state (persisted to localStorage).
export const anilistUserName = persisted('anilist-viewer-name', '')
export const anilistUserAvatar = persisted('anilist-viewer-avatar', '')
export const malToken = persisted<string | null>('mal-token', null)
export const malRefresh = persisted<string | null>('mal-refresh', null)
// Unix ms when the current MAL access token expires. 0 = unknown (legacy sessions predating this) →
// proactive refresh is skipped and we fall back to the reactive 401 refresh.
export const malTokenExpiry = persisted<number>('mal-token-expiry', 0)
export const malUserName = persisted('mal-viewer-name', '')
export const malUserAvatar = persisted('mal-viewer-avatar', '')
export const kitsuToken = persisted<string | null>('kitsu-token', null)
export const kitsuRefresh = persisted<string | null>('kitsu-refresh', null)
export const kitsuTokenExpiry = persisted<number>('kitsu-token-expiry', 0)
export const kitsuUserId = persisted<string>('kitsu-viewer-id', '')
export const kitsuUserName = persisted('kitsu-viewer-name', '')
export const kitsuUserAvatar = persisted('kitsu-viewer-avatar', '')
export const simklToken = persisted<string | null>('simkl-token', null)
export const simklUserName = persisted('simkl-viewer-name', '')
export const simklUserAvatar = persisted('simkl-viewer-avatar', '')
export const trackerConnectionOrder = persisted<TrackerRatingProvider[]>('tracker-connection-order', [])

const trackerTokenStorageKey: Record<TrackerRatingProvider, string> = {
  anilist: 'anilist-token',
  mal: 'mal-token',
  kitsu: 'kitsu-token',
  simkl: 'simkl-token',
}

/** Current OAuth connections. For pre-existing installs, localStorage's stable key order is the
 * closest recoverable record of which token was first saved. */
export function connectedTrackerProviders(): TrackerRatingProvider[] {
  const connected: Record<TrackerRatingProvider, boolean> = {
    anilist: !!get(anilistToken),
    mal: !!get(malToken),
    kitsu: !!get(kitsuToken),
    simkl: !!get(simklToken),
  }
  const providers = TRACKER_RATING_PROVIDERS.filter((provider) => connected[provider])
  if (typeof localStorage === 'undefined') return providers
  const positions = new Map<string, number>()
  for (let index = 0; index < localStorage.length; index += 1) {
    const key = localStorage.key(index)
    if (key) positions.set(key, index)
  }
  return providers.sort((left, right) =>
    (positions.get(trackerTokenStorageKey[left]) ?? Number.MAX_SAFE_INTEGER)
    - (positions.get(trackerTokenStorageKey[right]) ?? Number.MAX_SAFE_INTEGER))
}

export function recordTrackerConnection(
  provider: TrackerRatingProvider,
  connectedBefore: readonly TrackerRatingProvider[] = connectedTrackerProviders().filter((item) => item !== provider),
) {
  trackerConnectionOrder.update((order) => connectionOrderAfterLink(order, provider, connectedBefore))
}

export function forgetTrackerConnection(provider: TrackerRatingProvider) {
  trackerConnectionOrder.update((order) => normalizeTrackerConnectionOrder(order).filter((item) => item !== provider))
}

// One-time migration for accounts connected before explicit link ordering existed.
if (typeof window !== 'undefined' && normalizeTrackerConnectionOrder(get(trackerConnectionOrder)).length === 0) {
  const existingConnections = connectedTrackerProviders()
  if (existingConnections.length) trackerConnectionOrder.set(existingConnections)
}

// Read-only (no login): a public MyAnimeList username to source lists from, mirroring
// `anilistUser` for AniList. MAL's official API serves any user's PUBLIC list with just the
// app's X-MAL-CLIENT-ID header — no OAuth token — so this needs no sign-in. Writes still
// require an OAuth token (malToken), so a username alone is inherently read-only.
export const malUser = persisted<string>('mal-username', '')
