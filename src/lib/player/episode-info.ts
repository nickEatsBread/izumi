import type { Media } from '$lib/anilist/types'
import type { EpMeta } from '$lib/anizip/types'
import { getEpisodeMeta } from '$lib/anizip'
import { animeEpisodeMetadata } from '$lib/catalog/anime-detail'
import { anilistIdOf } from '$lib/catalog/identity'
import { episodeNameText } from '$lib/themes/episode-fields'

/** The episode's own title for the player's title line and paused summary: nothing for a placeholder
 *  ("Episode 3") or while the viewer hides spoilers. */
export function episodeName(episode: number, meta: Pick<EpMeta, 'title'> | undefined, conceal: boolean): string | undefined {
  return episodeNameText(episode, meta?.title, conceal)
}

/** The last answers by `${anilistId}|${episode}`, newest last: the desktop controls remount on every
 *  reveal, so the episode name must be there at once instead of popping in after "E12". */
export const recentEpisodeMeta = new Map<string, EpMeta>()

/** Episode details for the playing episode: the last answer for it (or the catalog's own) first, then
 *  the cached episode lookup. Calls `onmeta` for each answer; returns a cancel function. */
export function loadEpisodeMeta(
  media: Media,
  episode: number,
  onmeta: (meta: EpMeta | undefined) => void,
  deps: { fetchMeta?: typeof getEpisodeMeta; anilistId?: typeof anilistIdOf } = {},
): () => void {
  const { fetchMeta = getEpisodeMeta, anilistId = anilistIdOf } = deps
  let live = true
  const known = animeEpisodeMetadata(media)
  const id = anilistId(media)
  const key = `${id}|${episode}`
  onmeta(recentEpisodeMeta.get(key) ?? known[episode])
  if (id) {
    const merge = (next: Record<number, EpMeta>) => {
      if (!live) return
      // Field by field: a lookup entry's missing synopsis must not blank the catalog's own.
      for (const [n, details] of Object.entries(next)) {
        known[Number(n)] = { ...known[Number(n)], ...Object.fromEntries(Object.entries(details).filter(([, v]) => v != null)) }
      }
      const meta = known[episode]
      if (meta) {
        recentEpisodeMeta.delete(key)
        recentEpisodeMeta.set(key, meta)
        if (recentEpisodeMeta.size > 8) recentEpisodeMeta.delete(recentEpisodeMeta.keys().next().value!)
      }
      onmeta(meta)
    }
    void fetchMeta(id, undefined, merge).then(merge).catch(() => {})
  }
  return () => { live = false }
}
