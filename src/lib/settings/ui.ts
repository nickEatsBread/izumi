import { persisted } from 'svelte-persisted-store'

/** How the episode list renders. Names are intentionally generic. */
export type EpisodeLayout = 'cards' | 'compact'

/** Persisted episode-list layout preference (default: rich cards). */
export const episodeLayout = persisted<EpisodeLayout>('episode-layout', 'cards')
