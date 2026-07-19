import { persisted } from 'svelte-persisted-store'
import {
  PUBLIC_ANILIST_CLIENT_ID,
  PUBLIC_MAL_CLIENT_ID,
  PUBLIC_OAUTH_REDIRECT_URI,
} from '$env/static/public'

export { anilistToken } from '$lib/anilist/auth'

// App OAuth config from .env — public client IDs + the redirect URI. Not secrets
// (AniList uses implicit grant, MAL uses PKCE). Baked in, never asked from the user.
export const anilistClientId = PUBLIC_ANILIST_CLIENT_ID
export const malClientId = PUBLIC_MAL_CLIENT_ID
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

// Read-only (no login): a public MyAnimeList username to source lists from, mirroring
// `anilistUser` for AniList. MAL's official API serves any user's PUBLIC list with just the
// app's X-MAL-CLIENT-ID header — no OAuth token — so this needs no sign-in. Writes still
// require an OAuth token (malToken), so a username alone is inherently read-only.
export const malUser = persisted<string>('mal-username', '')
