import { persisted } from 'svelte-persisted-store'
export { anilistToken } from '$lib/anilist/auth' // AniList access token (Bearer)
export const anilistClientId = persisted('anilist-client-id', '')
export const anilistClientSecret = persisted('anilist-client-secret', '')
export const anilistUserName = persisted('anilist-viewer-name', '') // display, from Viewer
export const malToken = persisted<string | null>('mal-token', null)
export const malRefresh = persisted<string | null>('mal-refresh', null)
export const malClientId = persisted('mal-client-id', '')
export const malUserName = persisted('mal-viewer-name', '')
export const REDIRECT_PORT = 41780
