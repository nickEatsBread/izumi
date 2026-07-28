import { invoke } from '@tauri-apps/api/core'
import { join, tempDir } from '@tauri-apps/api/path'
import { get } from 'svelte/store'
import { phttp } from '$lib/net/http'
import { nowPlayingStream, playerNotice } from '$lib/player/session'

export type SubtitleCue = { start: number; end: number; text: string }
export type SyncableTrack = {
  id: number
  type: string
  title?: string
  lang?: string
  selected?: boolean
  external?: boolean
  externalFilename?: string
}

export type NativeSyncResult = { offsetSec: number; ratio: number; confidence: number }

const timing = /(?:(\d{1,2}):)?(\d{1,2}):(\d{2})[,.](\d{1,3})\s*-->\s*(?:(\d{1,2}):)?(\d{1,2}):(\d{2})[,.](\d{1,3})/

function seconds(hours: string | undefined, minutes: string, secs: string, millis: string) {
  return Number(hours ?? 0) * 3600 + Number(minutes) * 60 + Number(secs) + Number((millis + '000').slice(0, 3)) / 1000
}

function cleanText(text: string) {
  return text
    .replace(/<[^>]+>/g, '')
    .replace(/\{[^}]*\}/g, '')
    .replace(/\\[Nn]/g, '\n')
    .trim()
}

function parseTimedBlocks(text: string): SubtitleCue[] {
  const stripped = text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').replace(/^WEBVTT[^\n]*\n+/i, '')
  const cues: SubtitleCue[] = []
  for (const block of stripped.split(/\n{2,}/)) {
    const lines = block.split('\n')
    const index = lines.findIndex((line) => line.includes('-->'))
    if (index < 0) continue
    const match = lines[index].match(timing)
    if (!match) continue
    const body = cleanText(lines.slice(index + 1).join('\n'))
    if (!body) continue
    cues.push({
      start: seconds(match[1], match[2], match[3], match[4]),
      end: seconds(match[5], match[6], match[7], match[8]),
      text: body,
    })
  }
  return cues.sort((a, b) => a.start - b.start)
}

function parseAss(text: string): SubtitleCue[] {
  const cues: SubtitleCue[] = []
  let fields: string[] = []
  for (const line of text.replace(/\r\n?/g, '\n').split('\n')) {
    if (/^Format:/i.test(line)) {
      fields = line.slice(line.indexOf(':') + 1).split(',').map((field) => field.trim().toLowerCase())
      continue
    }
    if (!/^Dialogue:/i.test(line) || !fields.length) continue
    const parts = line.slice(line.indexOf(':') + 1).split(/,(?=(?:[^,]*,){0,8}[^,]*$)/)
    const startIndex = fields.indexOf('start')
    const endIndex = fields.indexOf('end')
    const textIndex = fields.indexOf('text')
    const parseTime = (value: string) => {
      const match = value?.trim().match(/(\d+):(\d{2}):(\d{2})[.](\d{1,3})/)
      return match ? seconds(match[1], match[2], match[3], match[4]) : NaN
    }
    const start = parseTime(parts[startIndex])
    const end = parseTime(parts[endIndex])
    const body = cleanText(parts.slice(textIndex).join(','))
    if (Number.isFinite(start) && Number.isFinite(end) && body) cues.push({ start, end, text: body })
  }
  return cues.sort((a, b) => a.start - b.start)
}

export function parseSubtitle(text: string): SubtitleCue[] {
  return /\[Events\]/i.test(text) ? parseAss(text) : parseTimedBlocks(text)
}

function timestamp(value: number) {
  const millis = Math.max(0, Math.round(value * 1000))
  const hours = Math.floor(millis / 3_600_000)
  const minutes = Math.floor((millis % 3_600_000) / 60_000)
  const secs = Math.floor((millis % 60_000) / 1000)
  const ms = millis % 1000
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')},${String(ms).padStart(3, '0')}`
}

export function correctedSrt(cues: SubtitleCue[], result: NativeSyncResult) {
  return cues.map((cue, index) => {
    const start = Math.max(0, cue.start * result.ratio + result.offsetSec)
    const end = Math.max(start + 0.001, cue.end * result.ratio + result.offsetSec)
    return `${index + 1}\n${timestamp(start)} --> ${timestamp(end)}\n${cue.text}`
  }).join('\n\n') + '\n'
}

async function subtitleText(source: string) {
  if (/^https?:\/\//i.test(source)) {
    const response = await phttp(source, { timeoutMs: 15_000, maxBytes: 4 * 1024 * 1024 })
    if (!response.ok) throw new Error(`subtitle fetch ${response.status}`)
    return response.text()
  }
  return invoke<string>('read_subtitle_file', { path: source })
}

let activeKey = ''

/** Sync the currently selected external subtitle once per source/track. */
export async function autoSyncSelectedSubtitle(tracks: SyncableTrack[], duration: number, force = false) {
  const track = tracks.find((candidate) =>
    candidate.type === 'sub'
    && candidate.selected
    && candidate.external
    && candidate.externalFilename
    && !candidate.title?.startsWith('Auto-synced'),
  )
  const stream = get(nowPlayingStream)
  if (!track || !stream.url || duration < 60) return false
  const key = `${stream.url}|${track.id}|${track.externalFilename}`
  if (!force && key === activeKey) return false
  activeKey = key
  playerNotice.set('Synchronizing subtitles…')
  try {
    const cues = parseSubtitle(await subtitleText(track.externalFilename!))
    if (cues.length < 4) throw new Error('not-enough-subtitle-cues')
    const result = await invoke<NativeSyncResult | null>('sync_subtitle', {
      url: stream.url,
      headers: Object.keys(stream.headers).length ? stream.headers : undefined,
      cues: cues.map((cue) => [cue.start, cue.end]),
      durationSec: duration,
      infoHash: stream.infoHash,
    })
    if (!result) {
      playerNotice.set('Subtitle sync could not find a confident match')
      return false
    }
    const path = await join(await tempDir(), `izumi-synced-${Date.now()}.srt`)
    await invoke('write_text_file', { path, contents: correctedSrt(cues, result) })
    await invoke('player_command', {
      name: 'sub-add',
      args: [path, 'select', `Auto-synced ${track.title ?? track.lang ?? 'subtitle'}`, track.lang ?? 'und'],
    })
    playerNotice.set(`Subtitles synchronized (${result.offsetSec >= 0 ? '+' : ''}${result.offsetSec.toFixed(1)}s)`)
    return true
  } catch (error) {
    const message = String(error)
    playerNotice.set(message.includes('ffmpeg-unavailable')
      ? 'Automatic subtitle sync needs ffmpeg installed'
      : 'Automatic subtitle sync failed')
    return false
  }
}

export function resetSubtitleSync() {
  activeKey = ''
}
