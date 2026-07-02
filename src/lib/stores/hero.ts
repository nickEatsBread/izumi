import { writable } from 'svelte/store'
import type { Media } from '$lib/anilist/types'

// The media whose banner the shared BannerBg layer paints behind the shell.
// Pages set this on mount (home = rotating trending, detail = the title) and
// clear it (null) when they have no hero, so the banner never sticks.
export const heroMedia = writable<Media | null>(null)
