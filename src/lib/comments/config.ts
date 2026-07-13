import { persisted } from 'svelte-persisted-store'

// Optional discussion MAPPER backend — a generic endpoint that maps an anime id + episode to
// per-platform discussion threads (reddit/forum/youtube/…). izumi ships NO default (user-provided
// only, mirroring the zero-default stream-source policy); an empty value means "AniList threads only".
// Used by the aggregation providers (phase 2+).
export const commentsBackendUrl = persisted<string>('comments-backend-url', '')

// Master toggle for the in-player discussion panel + its comment button.
export const commentsEnabled = persisted<boolean>('comments-enabled', true)

// Which discussion source the panel opens on. 'auto' = the aggregated multi-source list; a specific
// platform (reddit | anilist | mal | youtube | disqus | forum) opens filtered to that source and, when
// it provides an embed (Disqus/forum), renders the embed inline instead of a link-out.
export const defaultDiscussionPlatform = persisted<string>('comments-default-platform', 'auto')
