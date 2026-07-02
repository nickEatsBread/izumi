import { persisted } from 'svelte-persisted-store'
import { get } from 'svelte/store'

export const anilistToken = persisted<string | null>('anilist-token', null)
export const getToken = () => get(anilistToken)
