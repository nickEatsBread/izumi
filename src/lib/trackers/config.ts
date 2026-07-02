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
export const malToken = persisted<string | null>('mal-token', null)
export const malRefresh = persisted<string | null>('mal-refresh', null)
export const malUserName = persisted('mal-viewer-name', '')
