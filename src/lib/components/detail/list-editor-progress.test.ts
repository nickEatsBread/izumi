import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

// The series page is only hidden while the player is up, never unmounted, so the list editor's
// "Episodes watched" and the header count must follow episodes recorded while it sat underneath.
// Before, they read the editor's optimistic patch and tracker reads from before playback, and
// showed 0 after watching episode 1 until a refresh.

const detail = readFileSync(fileURLToPath(new URL('./AnimeDetail.svelte', import.meta.url)), 'utf8')

describe('series page list entry after playback', () => {
  it('derives the status, count and score from seriesListEntry', () => {
    expect(detail).toContain("import { seriesListEntry, type ListEdit } from '$lib/detail/list-entry'")
    expect(detail).toContain('const listEntry = $derived(seriesListEntry({')
    expect(detail).toContain('edit: listOpt, local: localEntry, anilist: rawEntry, external: externalEntry,')
    expect(detail).toContain('const effStatus = $derived(listEntry.status)')
    expect(detail).toContain('const effProgress = $derived(listEntry.progress)')
    expect(detail).toContain('const effScore100 = $derived(listEntry.score100)')
    expect(detail).not.toContain('mergedProgress(localEntry?.progress, rawEntry?.progress, externalEntry?.progress)')
  })

  it('compares episodes this device records against the count when the page read its sources', () => {
    expect(detail).toContain('const watched = $derived(media ? recordedWatched(media, $localHistory, $sessionProgress) : 0)')
    expect(detail).toContain('let watchedBefore = $state<number | null>(null)')
    expect(detail).toContain('$effect(() => { if (media && untrack(() => watchedBefore) == null) watchedBefore = watched })')
  })

  it('starts a fresh comparison from each save and drops an edit a watch replaced', () => {
    expect(detail).toContain('onsaved={(patch) => { listOpt = { ...listEntry.edit, ...patch }; watchedBefore = watched }}')
  })

  it('opens the editor with the same count the header shows', () => {
    expect(detail).toContain('initProgress={effProgress}')
    expect(detail).toContain('initStatus={effStatus}')
  })
})
