import { persisted } from 'svelte-persisted-store'
export const addonUrls = persisted<string[]>('stremio-addon-urls', [])
export const normalizeBase = (u: string) => u.trim().replace(/\/manifest\.json\/?$/i, '').replace(/\/$/, '')
