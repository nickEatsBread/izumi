import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { get } from 'svelte/store'
import { addonUrls } from './sources'
import { getIndex, lookupKitsu } from './idmap'
import { getStreams, streamId } from './addon'
import { getKitsuId } from '$lib/anizip'
import { kitsuIdFromMal } from './kitsu'
import { updateProgress } from '$lib/trackers'
import { savePosition, getPosition, clearPosition, watched } from '$lib/player/progress'
import { title } from '$lib/anilist/media'
import type { Media } from '$lib/anilist/types'

export type PlayState = { status: 'idle' | 'resolving' | 'playing' | 'error'; message?: string }

// Module-level listener handles from the *previous* play. We unlisten these
// before attaching new ones so repeated plays don't stack listeners (this is a
// plain module, not a component — no runes/lifecycle to lean on).
let stop: Array<() => void> = []

// Wire the mpv event stream (emitted from Rust) to progress tracking, resume,
// and auto next-episode. Called once per play, after playback has started.
async function attach(media: Media, episode: number, onState: (s: PlayState) => void) {
  // Tear down any listeners from the previous play first.
  stop.forEach((f) => f())
  stop = []
  let marked = false
  let lastSave = 0
  stop.push(
    await listen<[number, number]>('player-progress', (e) => {
      const [pos, dur] = e.payload
      // Throttle position writes to ~once every 5s to avoid store churn.
      if (Date.now() - lastSave > 5000) {
        savePosition(media.id, episode, pos, dur)
        lastSave = Date.now()
      }
      // Once we cross the watch threshold, mark this episode on the tracker(s)
      // exactly once (guarded by `marked`).
      if (!marked && watched(pos, dur)) {
        marked = true
        updateProgress(media, episode, 'CURRENT').then((t) => t.length && console.log('tracked on', t.join(', ')))
      }
    }),
  )
  stop.push(
    await listen('player-ended', () => {
      // Finished: forget the resume point, then auto-advance if there's a next
      // episode (bounded by the known total, if any).
      clearPosition(media.id, episode)
      // Advance only within *aired* episodes (nextAiringEpisode-1 for ongoing shows).
      const airedTotal = media.nextAiringEpisode?.episode ? media.nextAiringEpisode.episode - 1 : (media.episodes ?? 0)
      if (episode < airedTotal) playEpisode(media, episode + 1, onState)
    }),
  )
}

export async function playEpisode(media: Media, episode: number | undefined, onState: (s: PlayState) => void) {
  const bases = get(addonUrls)
  if (!bases.length) return onState({ status: 'error', message: 'No sources configured — add an addon URL in Settings.' })
  onState({ status: 'resolving' })
  const idx = await getIndex()
  // Prefer the Fribb id list; fall back to AniZip's mapping when it misses
  // (some titles, e.g. "Rakudai Kenja no Gakuin Musou…", aren't in Fribb).
  let kitsu = lookupKitsu(idx, media.id)
  if (!kitsu) kitsu = await getKitsuId(media.id)
  if (!kitsu) kitsu = await kitsuIdFromMal(media.idMal)
  if (!kitsu) return onState({ status: 'error', message: 'No stream mapping for this title (no Kitsu id).' })
  const streams = await getStreams(bases, streamId(kitsu, episode), media.format === 'MOVIE' ? 'movie' : 'series')
  if (!streams.length) return onState({ status: 'error', message: 'No debrid streams found (check your debrid addon + key).' })
  try {
    // Resume from the last saved position for this exact episode, if any.
    const startSeconds = episode != null ? getPosition(media.id, episode) : 0
    // Play into the dedicated transparent player window, which shows the custom
    // controls over the video. The now-playing title drives the overlay header.
    const nowPlaying = episode != null ? `${title(media)} — Episode ${episode}` : title(media)
    await invoke('play_in_player', { url: streams[0].url, startSeconds: startSeconds || undefined, title: nowPlaying })
    onState({ status: 'playing' })
    // Progress now fires on *actual watch* (~85%), not on play — see attach().
    if (episode != null) await attach(media, episode, onState)
  }
  catch (e) { onState({ status: 'error', message: String(e) }) }
}
