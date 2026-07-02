import { persisted } from 'svelte-persisted-store'
export { anilistToken } from '$lib/anilist/auth'
export const anilistClientId = persisted('anilist-client-id', '44873')
export const anilistUserName = persisted('anilist-viewer-name', '')
export const malToken = persisted<string | null>('mal-token', null)
export const malRefresh = persisted<string | null>('mal-refresh', null)
export const malClientId = persisted('mal-client-id', '7f0da88adf3778aa346db0315ebe85f5')
export const malUserName = persisted('mal-viewer-name', '')
export const REDIRECT_URI = 'https://animeclient.quack.co.uk/callback'
