import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { get } from 'svelte/store'
import { addonUrls } from './sources'
import { getIndex, lookupKitsu } from './idmap'
import { getStreams, streamId, pickBest, type Stream } from './addon'
import { getKitsuId } from '$lib/anizip'
import { kitsuIdFromMal } from './kitsu'
import { updateProgress } from '$lib/trackers'
import { savePosition, getPosition, clearPosition, watched } from '$lib/player/progress'
import { playing, nowPlaying, streamPicker } from '$lib/player/session'
import { preferredAudioLang, preferredSubLang, autoSelectSource, preferredQuality } from '$lib/settings/ui'
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
      // episode (bounded by the known total, if any). Auto-advance plays the best
      // source directly — no picker between back-to-back episodes.
      clearPosition(media.id, episode)
      const airedTotal = media.nextAiringEpisode?.episode ? media.nextAiringEpisode.episode - 1 : (media.episodes ?? 0)
      if (episode < airedTotal) resolveAndPlayBest(media, episode + 1, onState)
    }),
  )
}

// Resolve the CACHED streams for an episode (kitsu id map → addons). Throws a
// user-facing message on failure; returns the ranked playable list otherwise.
async function resolveStreams(media: Media, episode: number | undefined): Promise<Stream[]> {
  const bases = get(addonUrls)
  if (!bases.length) throw new Error('No sources configured — add an addon URL in Settings.')
  const idx = await getIndex()
  // Prefer the Fribb id list; fall back to AniZip's mapping when it misses
  // (some titles, e.g. "Rakudai Kenja no Gakuin Musou…", aren't in Fribb).
  let kitsu = lookupKitsu(idx, media.id)
  if (!kitsu) kitsu = await getKitsuId(media.id)
  if (!kitsu) kitsu = await kitsuIdFromMal(media.idMal)
  if (!kitsu) throw new Error('No stream mapping for this title (no Kitsu id).')
  const { playable, total } = await getStreams(bases, streamId(kitsu, episode), media.format === 'MOVIE' ? 'movie' : 'series')
  if (!playable.length) {
    throw new Error(total > 0
      ? `Found ${total} torrents but none are cached on your debrid — only instantly-available streams play here (no "downloading to debrid"). Try another source or add it to your debrid first.`
      : 'No streams found for this title/episode yet.')
  }
  return playable
}

// User-initiated play: resolve, then show the source picker (izumi-style). The
// user picks a source and `playStream` starts it.
export async function playEpisode(media: Media, episode: number | undefined, onState: (s: PlayState) => void) {
  onState({ status: 'resolving' })
  try {
    const streams = await resolveStreams(media, episode)
    // Auto-select the best source at the preferred quality (skip the picker), or
    // show the picker so the user chooses.
    if (get(autoSelectSource)) {
      const best = pickBest(streams, get(preferredQuality))
      if (best) return await playStream(media, episode, best, onState)
    }
    streamPicker.set({ media, episode, streams })
    onState({ status: 'idle' })
  }
  catch (e) { onState({ status: 'error', message: e instanceof Error ? e.message : String(e) }) }
}

// Resolve + play the single best (highest-quality) source, skipping the picker —
// used for auto next-episode.
async function resolveAndPlayBest(media: Media, episode: number | undefined, onState: (s: PlayState) => void) {
  onState({ status: 'resolving' })
  try {
    const streams = await resolveStreams(media, episode)
    await playStream(media, episode, streams[0], onState)
  }
  catch (e) { onState({ status: 'error', message: e instanceof Error ? e.message : String(e) }) }
}

// Play a specific chosen stream: embed mpv into the main window + wire progress /
// resume / auto next-episode. Closes the picker.
export async function playStream(media: Media, episode: number | undefined, stream: Stream, onState: (s: PlayState) => void) {
  // Note: the picker closes itself on the 'playing' state (so an embed error stays
  // visible in it); auto-next calls this with no picker open.
  if (!stream?.url) return onState({ status: 'error', message: 'That source has no playable link.' })
  try {
    // Resume from the last saved position for this exact episode, if any.
    const startSeconds = episode != null ? getPosition(media.id, episode) : 0
    const label = episode != null ? `${title(media)} — Episode ${episode}` : title(media)
    nowPlaying.set({ title: label, malId: media.idMal ?? null, episode: episode ?? null })
    // Embed mpv FIRST — it renders behind the still-opaque webview — THEN reveal the
    // overlay + punch the transparent hole. Otherwise the window is briefly
    // transparent with nothing behind it and the desktop flashes through.
    // alang/slang drive mpv's preferred-language track auto-selection.
    await invoke('player_embed', {
      url: stream.url,
      startSeconds: startSeconds || undefined,
      alang: get(preferredAudioLang),
      slang: get(preferredSubLang),
    })
    playing.set(true)
    onState({ status: 'playing' })
    // Progress now fires on *actual watch* (~85%), not on play — see attach().
    if (episode != null) await attach(media, episode, onState)
  }
  catch (e) { onState({ status: 'error', message: String(e) }) }
}
