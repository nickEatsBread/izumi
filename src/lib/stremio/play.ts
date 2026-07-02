import { invoke } from '@tauri-apps/api/core'
import { get } from 'svelte/store'
import { addonUrls } from './sources'
import { getIndex, lookupKitsu } from './idmap'
import { getStreams, streamId } from './addon'

export type PlayState = { status: 'idle' | 'resolving' | 'playing' | 'error'; message?: string }
export async function playEpisode(anilistId: number, episode: number | undefined, onState: (s: PlayState) => void) {
  const bases = get(addonUrls)
  if (!bases.length) return onState({ status: 'error', message: 'No sources configured — add an addon URL in Settings.' })
  onState({ status: 'resolving' })
  const idx = await getIndex()
  const kitsu = lookupKitsu(idx, anilistId)
  if (!kitsu) return onState({ status: 'error', message: 'No Kitsu mapping for this title.' })
  const streams = await getStreams(bases, streamId(kitsu, episode))
  if (!streams.length) return onState({ status: 'error', message: 'No debrid streams found (check your debrid addon + key).' })
  try { await invoke('player_play', { url: streams[0].url }); onState({ status: 'playing' }) }
  catch (e) { onState({ status: 'error', message: String(e) }) }
}
