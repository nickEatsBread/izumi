import { writable, get } from 'svelte/store'
import { debridProvider, debridKey } from '$lib/settings/ui'
import { listFiles, resolveFile, providerName } from './index'
import { debridCaching } from '$lib/player/session'
import { playRawUrl, type PlayState } from '$lib/stremio/play'
import type { DebridItem, DebridFile } from './types'

// Open in-torrent file browser: set with an item + its playable files; null = closed.
export const cloudFiles = writable<null | { item: DebridItem; files: DebridFile[] }>(null)

/** Open a ready item: fetch its files. A single video plays immediately; multiple
 *  open the file browser so the user picks the episode. */
export async function openItem(item: DebridItem, onState: (s: PlayState) => void) {
  const prov = get(debridProvider), key = get(debridKey)
  onState({ status: 'resolving' })
  try {
    const files = await listFiles(prov, key, item)
    const vids = files.filter((f) => f.playable)
    const pool = vids.length ? vids : files
    if (pool.length <= 1) {
      const f = pool[0]
      if (!f) return onState({ status: 'error', message: 'No files in that torrent.' })
      return await playFile(item, f, onState)
    }
    onState({ status: 'idle' })
    cloudFiles.set({ item, files: pool })
  }
  catch (e) { onState({ status: 'error', message: e instanceof Error ? e.message : String(e) }) }
}

/** Resolve one chosen file → play it. Shows the full-screen debridCaching screen while
 *  resolving (instant for an already-cached file; cancelable). */
export async function playFile(item: DebridItem, file: DebridFile, onState: (s: PlayState) => void) {
  const prov = get(debridProvider), key = get(debridKey)
  cloudFiles.set(null)
  const controller = new AbortController()
  debridCaching.set({
    provider: providerName(prov),
    title: file.name,
    info: { stage: 'queued' },
    cancel: () => { debridCaching.set(null); controller.abort() },
  })
  try {
    const url = await resolveFile(prov, key, item, file, {
      signal: controller.signal,
      timeoutMs: 30 * 60 * 1000,
      onStatus: (i) => debridCaching.update((c) => (c ? { ...c, info: i } : c)),
    })
    debridCaching.set(null)
    await playRawUrl(url, file.name, onState)
  }
  catch (e) {
    debridCaching.set(null)
    if (e instanceof Error && e.name === 'AbortError') return onState({ status: 'idle' })
    onState({ status: 'error', message: e instanceof Error ? e.message : String(e) })
  }
}
