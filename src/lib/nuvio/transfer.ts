import { get } from 'svelte/store'
import { persisted } from 'svelte-persisted-store'
import type { Media } from '$lib/anilist/types'
import { localLibrary, WATCHLIST_ID, setMediaInLocalList } from '$lib/library/local-lists'
import { durableHistory, mediaSnapshot } from '$lib/player/history'
import { durablePositions, progressKey } from '$lib/player/progress'
import { activeProfile } from '$lib/profiles/store'
import { profileAllowsMedia } from '$lib/profiles/content'
import { enabledAddonUrls, addonUrls, disabledSources, normalizeBase } from '$lib/stremio/sources'
import { fetchManifest } from '$lib/stremio/manifest'
import { incognito } from '$lib/stores/incognito'
import { SYNCED_SETTING_KEYS } from '$lib/sync/manual'
import { mediaToCloud, cloudToMedia, cloudMatchesMedia, cloudEpisode, localEpisode } from './media'
import { cloudIdentity, nuvioProgressKey, type CloudItem, type CloudAddon, type Resource, type JsonRecord } from './cloud'

const origin = persisted<string>('nuvio-client-id-v1', '')
export function nuvioOrigin(): string {
  let value = get(origin)
  if (!value) { value = crypto.randomUUID(); origin.set(value) }
  return value
}
function check(signal?: AbortSignal) {
  if (signal?.aborted) throw new DOMException('Transfer cancelled', 'AbortError')
  if (get(incognito)) throw new Error('Leave incognito mode before transferring library or playback data.')
}
export async function knownMedia(): Promise<Media[]> {
  await Promise.all([localLibrary.ready, durableHistory.ready])
  return [...Object.values(get(localLibrary).entries).map((row) => row.media), ...Object.values(get(durableHistory)).map((row) => row.media)]
}
export async function resolveCloudMedia(row: CloudItem, signal?: AbortSignal): Promise<Media | null> {
  const known = (await knownMedia()).find((media) => cloudMatchesMedia(row, media))
  if (known) return profileAllowsMedia(known, get(activeProfile)) ? known : null
  const mapped = cloudToMedia(row, get(enabledAddonUrls))
  if (!mapped) {
    // Older Nuvio entries may omit addon_base_url. Try only user-installed metadata sources.
    const { mapStremioMeta } = await import('$lib/catalog/providers/stremio')
    const { loadCatalogProvider } = await import('$lib/catalog/registry')
    const provider = await loadCatalogProvider('stremio')
    for (const url of get(enabledAddonUrls).slice(0, 100)) {
      if (signal?.aborted) throw new DOMException('Transfer cancelled', 'AbortError')
      const manifest = await fetchManifest(url)
      if (!manifest?.resources?.some((resource) => (typeof resource === 'string' ? resource : resource.name) === 'meta')) continue
      const candidate = mapStremioMeta({ id: row.content_id, type: row.content_type, name: row.name || row.title || row.content_id }, url, row.content_type)
      if (!candidate?.catalog) continue
      const detailed = await provider.detail(candidate.catalog, signal)
      if (detailed && profileAllowsMedia(detailed, get(activeProfile))) return detailed
    }
    return null
  }
  if (!mapped.catalog) return mapped
  const { loadCatalogProvider } = await import('$lib/catalog/registry')
  const provider = await loadCatalogProvider(mapped.catalog.provider as 'tmdb' | 'stremio')
  const detailed = await provider.detail(mapped.catalog, signal)
  return detailed && profileAllowsMedia(detailed, get(activeProfile)) ? detailed : null
}

/** A reviewed, additive transfer. Cloud removals never erase unrelated local lists/history. */
export async function importCloudItems(kind: Resource, values: CloudItem[], signal?: AbortSignal): Promise<{ imported: number; skipped: number }> {
  await Promise.all([localLibrary.ready, durableHistory.ready])
  let imported = 0, skipped = 0
  for (const row of values) {
    check(signal)
    let media: Media | null
    try { media = await resolveCloudMedia(row, signal) } catch (error) { check(signal); skipped++; continue }
    check(signal)
    if (!media) { skipped++; continue }
    if (kind === 'library') { setMediaInLocalList(media, WATCHLIST_ID, true); imported++; continue }
    const episode = cloudEpisode(media, row)
    if (episode == null) { skipped++; continue }
    const when = Number(kind === 'history' ? row.watched_at : row.last_watched)
    if (!Number.isFinite(when) || when <= 0) { skipped++; continue }
    const oldHistory = get(durableHistory)[media.id]
    if (oldHistory && oldHistory.updatedAt > when) { skipped++; continue }
    if (kind === 'progress') {
      if (!Number.isFinite(row.position) || !Number.isFinite(row.duration) || row.position! < 0 || row.duration! <= 0) { skipped++; continue }
      const key = progressKey(media.id, episode), old = get(durablePositions)[key]
      if (old?.updatedAt && old.updatedAt > when) { skipped++; continue }
      durablePositions.update((positions) => Object.fromEntries(Object.entries({ ...positions, [key]: { pos: Math.min(row.position!, row.duration!) / 1000, dur: row.duration! / 1000, updatedAt: when } }).sort((a, b) => (b[1].updatedAt ?? 0) - (a[1].updatedAt ?? 0)).slice(0, 500)))
    }
    // izumi tracks watched-through counts, not sparse episode flags. Do not mark gaps watched.
    const progress = oldHistory?.progress ?? 0
    const nextProgress = kind === 'history' && episode === progress + 1 ? episode : progress
    if (kind === 'history' && episode > progress + 1) { skipped++; continue }
    durableHistory.update((history) => ({ ...history, [media.id]: { ...oldHistory, media: mediaSnapshot(media), episode, progress: nextProgress, updatedAt: when } }))
    imported++
  }
  return { imported, skipped }
}

export async function localCloudItems(kind: Resource): Promise<{ items: CloudItem[]; skipped: number }> {
  check()
  await Promise.all([localLibrary.ready, durableHistory.ready])
  const values: CloudItem[] = []; let skipped = 0
  if (kind === 'library') {
    for (const entry of Object.values(get(localLibrary).entries).filter((row) => row.listIds.includes(WATCHLIST_ID))) {
      const row = mediaToCloud(entry.media)
      if (row) values.push({ ...row, added_at: entry.addedAt }); else skipped++
    }
  } else {
    const positions = get(durablePositions)
    for (const entry of Object.values(get(durableHistory))) {
      const identity = mediaToCloud(entry.media)
      if (!identity) { skipped++; continue }
      if (kind === 'progress') {
        for (const [key, pos] of Object.entries(positions).filter(([key]) => key.startsWith(`${entry.media.id}:`))) {
          if (pos.cleared || pos.pos <= 0 || pos.dur <= 0) continue
          const coords = localEpisode(entry.media, Number(key.slice(key.indexOf(':') + 1)))
          if (!coords?.video_id) { skipped++; continue }
          const row = { content_id: identity.content_id, content_type: identity.content_type, ...coords, position: Math.round(pos.pos * 1000), duration: Math.round(pos.dur * 1000), last_watched: pos.updatedAt || entry.updatedAt }
          values.push({ ...row, progress_key: nuvioProgressKey(row) })
        }
      } else {
        const completed = identity.content_type === 'movie' ? Math.min(1, entry.progress) : entry.progress
        for (let episode = 1; episode <= completed; episode++) {
          const coords = localEpisode(entry.media, episode)
          if (!coords) { skipped++; continue }
          values.push({ content_id: identity.content_id, content_type: identity.content_type, title: identity.name, season: coords.season, episode: coords.episode, watched_at: entry.updatedAt })
        }
      }
    }
  }
  return { items: [...new Map(values.map((row) => [cloudIdentity(kind, row), row])).values()], skipped }
}
export function localCloudAddons(): CloudAddon[] {
  const disabled = get(disabledSources)
  return get(addonUrls).map((url, sort_order) => {
    const parsed = new URL(normalizeBase(url)); parsed.pathname = parsed.pathname.replace(/\/$/, '') + '/manifest.json'
    return { url: parsed.toString(), name: parsed.hostname, enabled: !disabled.includes(url), sort_order }
  })
}
export async function importCloudAddons(values: CloudAddon[], signal?: AbortSignal): Promise<number> {
  const urls = [...new Set(values.filter((row) => row.enabled !== false).map((row) => normalizeBase(row.url)))]
  if (urls.length > 100) throw new Error('Choose up to 100 sources at a time.')
  for (let i = 0; i < urls.length; i += 4) {
    check(signal)
    const results = await Promise.all(urls.slice(i, i + 4).map((url) => fetchManifest(url)))
    if (results.some((result) => !result || typeof result.id !== 'string' || !result.id || typeof result.name !== 'string' || !result.name)) throw new Error('A selected source did not return a valid manifest. No sources were added.')
  }
  check(signal)
  addonUrls.update((existing) => [...new Set([...existing, ...urls])])
  return urls.length
}
const homeKeys = ['catalog-home-layouts-v1', 'catalog-collections-v1', 'home-blocks-v1', 'home-aside-width-v1']
export function transferSettingKeys(kind: 'settings' | 'home'): readonly string[] {
  return kind === 'home' ? homeKeys : SYNCED_SETTING_KEYS.filter((key) => !homeKeys.includes(key))
}
export function localCloudSettings(kind: 'settings' | 'home'): JsonRecord {
  const result: JsonRecord = {}
  for (const key of transferSettingKeys(kind)) {
    const raw = localStorage.getItem(key)
    if (raw != null) { try { result[key] = JSON.parse(raw) } catch { /* Ignore damaged local preferences. */ } }
  }
  return result
}
export function importCloudSettings(kind: 'settings' | 'home', values: JsonRecord): number {
  let count = 0
  for (const key of transferSettingKeys(kind)) {
    if (!Object.hasOwn(values, key)) continue
    persisted<unknown>(key, values[key]).set(values[key]); count++
  }
  return count
}
