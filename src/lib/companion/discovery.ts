import { get } from 'svelte/store'
import { activeProfile } from '$lib/profiles/store'
import { profileAllowsMedia } from '$lib/profiles/content'
import { catalogProviders } from '$lib/settings/catalog'
import { showAdult } from '$lib/settings/ui'
import { durableHistory } from '$lib/player/history'
import { localLibrary } from '$lib/library/local-lists'
import { mediaKey } from '$lib/catalog/identity'
import type { Media } from '$lib/anilist/types'
import { loadDiscoveryCandidates } from '$lib/recommendations/candidates'
import {
  discoveryQueueFeedback, feedbackTasteSeeds, historyTasteSeeds,
  libraryTasteSeeds, rankDiscoveryQueue, discoveryTasteItem,
} from '$lib/recommendations/discovery-queue'
import { companionMedia, type CompanionDiscovery } from './protocol'

let cached: { key: string; at: number; media: Media[] } | undefined

/** A bounded, encrypted cross-catalog deck for TV. Metadata is cached, but taste is read fresh.
 * No incognito data, tokens, source URLs or account credentials enter this payload. */
export async function companionDiscovery(fallback: Media[]): Promise<CompanionDiscovery | undefined> {
  const viewer = get(activeProfile)
  const providers = get(catalogProviders)
  const now = Date.now()
  const key = JSON.stringify([viewer.id, providers, get(showAdult)])
  let media = cached?.key === key && now - cached.at < 15 * 60_000 ? cached.media : undefined
  if (!media) {
    const abort = new AbortController()
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      const result = await Promise.race([
        loadDiscoveryCandidates(providers, 1, abort.signal),
        new Promise<never>((_, reject) => { timer = setTimeout(() => { abort.abort(); reject(new Error('Catalog timeout')) }, 8_000) }),
      ])
      media = result.media
      cached = { key, at: now, media }
    } catch { media = fallback }
    finally { clearTimeout(timer) }
  }
  if (viewer.id !== get(activeProfile).id) return undefined
  const feedback = get(discoveryQueueFeedback)
  const signals = [...libraryTasteSeeds(get(localLibrary)), ...historyTasteSeeds(get(durableHistory)), ...feedbackTasteSeeds(feedback)]
  const known = [...Object.values(get(localLibrary).entries ?? {}), ...Object.values(get(durableHistory))]
  const excluded = known.filter(entry => feedback.records[mediaKey(entry.media)]?.action !== 'save')
    .flatMap(entry => {
      const item = discoveryTasteItem(entry.media)
      return [item.key, ...(item.aliases ?? [])]
    })
  const safe = media.filter(item => profileAllowsMedia(item, viewer) && (get(showAdult) || !item.isAdult))
  // Rank in the GPL client; the independently licensed TV consumes results, not engine code.
  // Discovery saves remain in the pool so a TV undo can restore them.
  const hidden = [...new Set(excluded)]
  const ranked = rankDiscoveryQueue(safe, signals, { records: {} }, { limit: 60, signalLimit: 100, excludedKeys: hidden })
  return {
    version: 2,
    candidates: ranked.map(({ media, reason, evidence, exploration }) => ({ ...companionMedia(media), recommendation: { reason, evidence, exploration } })),
    excluded: hidden.slice(0, 1000),
    decisions: [
      ...Object.entries(feedback.records).map(([key, value]) => ({ key, action: value.action, at: value.at })),
      ...Object.entries(feedback.removed ?? {}).map(([key, at]) => ({ key, action: 'undo' as const, at })),
    ].slice(0, 500),
  }
}
