import { persisted } from 'svelte-persisted-store'
export const anilistUser = persisted<string>('anilist-username', '')
