import { invoke } from '@tauri-apps/api/core'
import { writable } from 'svelte/store'
import { castSubtitleFormat, type CastTrack } from './android-cast'

export interface DesktopCastDevice {
  id: string
  name: string
  model?: string
  address: string
  port: number
}

export interface DesktopCastSession {
  deviceId: string
  deviceName: string
  subtitles: { trackId: number; title: string; lang?: string }[]
  activeTrackIds: number[]
}

export interface DesktopCastStatus {
  state: 'playing' | 'paused' | 'buffering' | 'idle'
  positionSeconds: number
  durationSeconds?: number
  volume?: number
  muted?: boolean
}

/** Survives the player's auto-hiding Controls component being unmounted and remounted. */
export const desktopCastSession = writable<DesktopCastSession | null>(null)

export interface CastSubtitleSource {
  url: string
  lang?: string
  title?: string
  headers?: Record<string, string>
}

export interface CastSourceWithSubtitles {
  url: string
  headers?: Record<string, string>
  manifest?: 'hls' | 'dash'
  subtitles?: CastSubtitleSource[]
}

export interface PreparedCastSource {
  url: string
  relayed: boolean
  subtitles: { url: string; lang?: string; title?: string; contentType: string }[]
}

/** Match mpv's selected external track back to the source sidecar that the LAN relay can fetch. */
export function selectedCastSubtitle(
  source: CastSourceWithSubtitles,
  tracks: CastTrack[],
): CastSubtitleSource | null {
  const selected = tracks.find((track) => track.type === 'sub' && track.selected)
  if (!selected) return null
  const external = selected.externalFilename
  return source.subtitles?.find((candidate) => {
    if (!castSubtitleFormat(candidate.url)) return false
    if (external) return candidate.url === external
    return (!!candidate.title && candidate.title === selected.title)
      || (!!candidate.lang && candidate.lang === selected.lang)
  }) ?? null
}

export function discoverDesktopCast(waitMs = 1_800): Promise<DesktopCastDevice[]> {
  return invoke('desktop_cast_discover', { request: { waitMs } })
}

export function prepareDesktopCast(
  source: CastSourceWithSubtitles,
  subtitles: CastSubtitleSource[],
): Promise<PreparedCastSource> {
  return invoke('cast_prepare_source', {
    request: {
      url: source.url,
      headers: source.headers ?? {},
      manifest: source.manifest,
      subtitles: subtitles.map((subtitle) => ({
        url: subtitle.url,
        lang: subtitle.lang,
        title: subtitle.title,
        format: castSubtitleFormat(subtitle.url),
        headers: subtitle.headers ?? {},
      })),
    },
  })
}

export function startDesktopCast(request: {
  deviceId: string
  url: string
  title?: string
  contentType: string
  positionSeconds: number
  subtitles: PreparedCastSource['subtitles']
  activeTrackIds: number[]
}): Promise<Omit<DesktopCastSession, 'subtitles' | 'activeTrackIds'>> {
  return invoke('desktop_cast_start', { request })
}

export function getDesktopCastStatus(): Promise<DesktopCastStatus> {
  return invoke('desktop_cast_status')
}

export function controlDesktopCast(request: {
  action: 'play' | 'pause' | 'seek' | 'volume' | 'tracks' | 'status'
  positionSeconds?: number
  volume?: number
  muted?: boolean
  activeTrackIds?: number[]
}): Promise<DesktopCastStatus> {
  return invoke('desktop_cast_control', { request })
}

export function stopDesktopCast(): Promise<void> {
  return invoke('desktop_cast_stop')
}
