import { invoke } from '@tauri-apps/api/core'
import { get } from 'svelte/store'
import {
  audioProcessing,
  subtitleStripSdh,
  subtitleStripSdhHarder,
  subtitleRegexFilter,
  windowsVsr,
  videoQualityPreset,
  rawMpvOptions,
  type AudioProcessing,
  type WindowsVsr,
} from '$lib/settings/ui'
import { userFilterChains } from './quality'

export function audioFilter(mode: AudioProcessing): string {
  if (mode === 'dialogue') return 'lavfi=[dynaudnorm=f=150:g=12:p=0.9]'
  if (mode === 'night') return 'lavfi=[loudnorm=I=-18:LRA=7:TP=-2]'
  return ''
}

export function vsrFilter(mode: WindowsVsr): string {
  return mode === 'off' ? '' : `d3d11vpp=scaling-mode=${mode}`
}

/** Compose the user's own audio chain (Custom mpv-options) with our normalisation filter rather
 *  than replacing it — `af` is a comma-separated CHAIN, so both can coexist. Normalisation is a
 *  mastering stage, so it goes last, after whatever the user set up. */
export function audioChain(userChain: string, mode: AudioProcessing): string {
  return [userChain, audioFilter(mode)].filter(Boolean).join(',')
}

/** Same composition for `vf`, but the upscaling filter goes FIRST: it is a hardware (d3d11) filter
 *  and has to see hardware frames, which any software filter ahead of it would have downloaded to
 *  system memory. */
export function videoChain(userChain: string, mode: WindowsVsr): string {
  return [vsrFilter(mode), userChain].filter(Boolean).join(',')
}

export function subtitleFilterOptions(strip: boolean, harder: boolean, regex: string): [string, string][] {
  return [
    ['sub-filter-sdh', strip ? 'yes' : 'no'],
    ['sub-filter-sdh-harder', strip && harder ? 'yes' : 'no'],
    // Passed through verbatim apart from surrounding whitespace. The backend writes it into mpv's
    // regex LIST with the list API, so commas — `.{2,}` and friends — survive intact; rewriting
    // characters here would silently change what the user's pattern means.
    ['sub-filter-regex', regex.trim()],
  ]
}

/** The full enhancement option set for the current settings. */
export function enhancementOpts(): [string, string][] {
  const user = userFilterChains(get(videoQualityPreset), get(rawMpvOptions))
  return [
    ['af', audioChain(user.af, get(audioProcessing))],
    ['vf', videoChain(user.vf, get(windowsVsr))],
    ...subtitleFilterOptions(get(subtitleStripSdh), get(subtitleStripSdhHarder), get(subtitleRegexFilter)),
  ]
}

export async function applyPlaybackEnhancements(): Promise<void> {
  await invoke('player_set_enhancement_opts', { opts: enhancementOpts() }).catch(() => {})
}

let started = false
/** Push the enhancement options once on startup, then on every change. Idempotent.
 *
 *  The startup push is the load-bearing part. These options only ever reached a LIVE mpv core, and
 *  the desktop core is created on the first play and destroyed on stop — so night mode, SDH
 *  stripping, the subtitle regex filter and driver upscaling did nothing unless the user toggled
 *  them mid-playback, and the effect died with the player. The backend stashes what we push here
 *  and replays it into every core it builds. */
export function startEnhancementSync(): void {
  if (started) return
  started = true
  void applyPlaybackEnhancements()
  let first = true
  // The quality stores are in this list because Custom mode's raw options can carry the user's own
  // `af`/`vf`, which we compose with — editing them has to recompose the chains.
  for (const store of [
    audioProcessing, windowsVsr, subtitleStripSdh, subtitleStripSdhHarder, subtitleRegexFilter,
    videoQualityPreset, rawMpvOptions,
  ]) {
    store.subscribe(() => { if (!first) void applyPlaybackEnhancements() })
  }
  first = false
}
