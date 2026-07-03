import { persisted } from 'svelte-persisted-store'

/** How the episode list renders. Names are intentionally generic. */
export type EpisodeLayout = 'cards' | 'compact'

/** Persisted episode-list layout preference (default: rich cards). */
export const episodeLayout = persisted<EpisodeLayout>('episode-layout', 'cards')

/**
 * Auto-skip OP/ED/recap segments (from AniSkip) during playback. When on, the
 * player seeks past a segment automatically the first time the playhead enters it
 * (seeking back in still lets you watch it). When off, only the manual "Skip"
 * button shows. Default off.
 */
export const autoSkip = persisted<boolean>('player-auto-skip', false)

// --- Playback language preferences (mpv alang/slang auto-selection) ---
// ISO 639-2 codes. Default JP audio + EN subs, like izumi.
export type AudioLang = 'jpn' | 'eng'
export type SubLang = 'eng' | 'jpn' | 'none'
export const preferredAudioLang = persisted<AudioLang>('preferred-audio-lang', 'jpn')
export const preferredSubLang = persisted<SubLang>('preferred-sub-lang', 'eng')

// --- Source selection ---
/** Skip the source picker and auto-play the best source at (or near) the preferred
 *  quality. Off = always show the picker. */
export const autoSelectSource = persisted<boolean>('auto-select-source', false)
export type Quality = '2160' | '1080' | '720' | '480' | 'any'
export const preferredQuality = persisted<Quality>('preferred-quality', '1080')
