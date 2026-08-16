import { persisted } from 'svelte-persisted-store'

// Kept only so existing settings/backups remain readable after the official Discuss Anime API
// migration. New discussion requests do not use this legacy mapper URL.
export const commentsBackendUrl = persisted<string>('comments-backend-url', '')

// Which discussion source the panel opens on. Default 'disqus' — it embeds inline, so the panel
// shows real comments instead of link-outs. 'auto' = the aggregated multi-source list; any other
// platform (reddit | anilist | mal | youtube | forum) opens filtered to that source and, when it
// provides an embed (Disqus/forum), renders the embed inline instead of a link-out.
// (Fresh key so the new default reaches installs that already stored the old 'auto'.)
export const defaultDiscussionPlatform = persisted<string>('comments-default-source', 'disqus')

// Discussion panel layout: false = docked side sheet (default), true = centered floating panel over a
// dimmed backdrop. Remembered across opens (the header toggle flips it).
export const discussionExpanded = persisted<boolean>('discussion-expanded', false)
