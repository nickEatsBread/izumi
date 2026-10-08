<script lang="ts">
  // The list editor for a title opened away from its series page (a hero template's `list` action).
  // It reads what the series page reads before it opens — this device's tracking, the AniList entry
  // and the other connected trackers — so a save never starts from a blank status or count. A title
  // without an AniList identity gets the Save sheet (this device's lists), as its own page offers.
  import { onMount } from 'svelte'
  import { getContextClient } from '@urql/svelte'
  import type { Media } from '$lib/anilist/types'
  import { ANIME_LIST_ENTRY } from '$lib/anilist/detail-queries'
  import { anilistToken } from '$lib/anilist/auth'
  import { totalEpisodes } from '$lib/anilist/media'
  import { recordedWatched } from '$lib/catalog/anime-detail'
  import { anilistIdOf, kitsuIdOf } from '$lib/catalog/identity'
  import { seriesListEntry, type ListEntryRead } from '$lib/detail/list-entry'
  import { localLibrary, localTrackingForMedia, localTrackingKey, localTrackingRemoved } from '$lib/library/local-lists'
  import { localHistory, manualProgressOverrides, sessionProgress } from '$lib/player/history'
  import { offlineMode } from '$lib/stores/offline'
  import { getExternalTrackerProgress } from '$lib/trackers'
  import ListEditor from './ListEditor.svelte'
  import LocalListPicker from '$lib/components/library/LocalListPicker.svelte'

  let { media, onclose }: { media: Media; onclose: () => void } = $props()

  const client = getContextClient()
  // The sheet is mounted per opening; its reads below run once, on mount.
  const anilistId = $derived(anilistIdOf(media))
  let reads = $state<{ anilist: ListEntryRead | null; external: ListEntryRead | null } | null>(null)

  onMount(() => {
    if (!anilistId) return
    let closed = false
    const offline = $offlineMode
    const anilist: Promise<ListEntryRead | null> = !offline && $anilistToken
      ? client.query(ANIME_LIST_ENTRY, { id: anilistId }).toPromise()
        .then((result) => (result.data as { Media?: Pick<Media, 'mediaListEntry'> | null } | undefined)?.Media?.mediaListEntry ?? media.mediaListEntry ?? null, () => media.mediaListEntry ?? null)
      : Promise.resolve(media.mediaListEntry ?? null)
    const external: Promise<ListEntryRead | null> = offline
      ? Promise.resolve(null)
      : getExternalTrackerProgress(anilistId, media.idMal ?? undefined, kitsuIdOf(media)).catch(() => null)
    void Promise.all([anilist, external]).then(([anilistEntry, externalEntry]) => {
      if (!closed) reads = { anilist: anilistEntry, external: externalEntry }
    })
    return () => { closed = true }
  })

  const watched = $derived(recordedWatched(media, $localHistory, $sessionProgress))
  const entry = $derived(reads ? seriesListEntry({
    edit: {},
    local: localTrackingForMedia($localLibrary, media),
    anilist: reads.anilist,
    external: reads.external,
    locallyRemoved: localTrackingRemoved($localLibrary, media),
    override: $manualProgressOverrides[media.id],
    watched,
    watchedBefore: watched,
  }) : null)
  const hasEntry = $derived(!!entry?.status)
  const canRemove = $derived(!!entry && !entry.removed && (hasEntry || Object.values($localHistory)
    .some((item) => localTrackingKey(item.media) === localTrackingKey(media))))
</script>

{#if !anilistId}
  <LocalListPicker {media} {onclose} />
{:else if entry}
  <ListEditor
    {media}
    initStatus={entry.status}
    initProgress={entry.progress}
    initScore0to100={entry.score100}
    total={totalEpisodes(media) || 0}
    {hasEntry}
    {canRemove}
    {onclose}
    onsaved={() => {}}
  />
{/if}
