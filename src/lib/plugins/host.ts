import { get, writable } from 'svelte/store'
import { invoke } from '@tauri-apps/api/core'
import { nowPlaying, nowPlayingUrl, playerNotice } from '$lib/player/session'
import { playerTracks } from '$lib/player/native'
import { cleanText, parseSubtitle, subtitleText, type SubtitleCue, type SyncableTrack } from '$lib/player/subtitle-sync'
import { checkPluginUrl } from './network'
import type { PluginScope } from './manifest'
import {
  installedPlugins, loadPluginCode, pluginSettingValues, pluginStorage, pluginsEnabled, writePluginStorage,
  type InstalledPlugin,
} from './registry'
import { createSandbox, runConformance } from './sandbox'

/** A plugin's player panel, drawn by izumi in Navigator's Ask style: a conversation of turns, each a
 *  question and the steps that answered it, with result cards under them. Images are never URLs from
 *  the plugin: `poster` is the playing title's cover, filled in by izumi. */
export type PanelIcon = 'search' | 'subtitles' | 'languages' | 'tv' | 'sparkles'
export interface PanelCard { id?: string; title: string; subtitle?: string; meta?: string[]; quote?: string; image?: 'poster'; icon?: PanelIcon }
export interface PanelStep { label: string; icon?: PanelIcon; state: 'running' | 'completed' | 'error'; cards?: PanelCard[] }
export interface PanelTurn { id: string; question: string; steps: PanelStep[]; text?: string; seconds?: number }
export interface PanelState { activity?: string; turns: PanelTurn[] }
export interface PluginRun { id: string; name: string; panel?: { label: string; placeholder: string }; state: 'starting' | 'ready' | 'failed'; error?: string }

export const pluginRuns = writable<PluginRun[]>([])
export const pluginPanels = writable<Record<string, PanelState>>({})
/** The plugin whose player panel is open. */
export const openPluginPanel = writable<string | null>(null)
export const pluginLogs = writable<Record<string, string[]>>({})
/** null until checked; `failed` lists every way out the sandbox did not block on this engine. */
export const pluginConformance = writable<{ ok: boolean; failed: string[] } | null>(null)

interface Live { plugin: InstalledPlugin; frame: HTMLIFrameElement; port: MessagePort; lastPong: number; heartbeat: ReturnType<typeof setInterval> }
const live = new Map<string, Live>()

const HEARTBEAT_MS = 10_000
const UNRESPONSIVE_MS = 25_000
const MAX_CUES = 5000

function setRun(id: string, patch: Partial<PluginRun>) {
  pluginRuns.update((runs) => runs.map((run) => (run.id === id ? { ...run, ...patch } : run)))
}

export function pluginLog(id: string, level: string, line: string) {
  pluginLogs.update((logs) => ({ ...logs, [id]: [...(logs[id] ?? []), `${new Date().toLocaleTimeString()} ${level} ${line.slice(0, 2000)}`].slice(-200) }))
}

function need(plugin: InstalledPlugin, scope: PluginScope) {
  if (!plugin.manifest.permissions.scopes.includes(scope)) throw new Error(`permission "${scope}" was not granted`)
}

const ICONS: readonly PanelIcon[] = ['search', 'subtitles', 'languages', 'tv', 'sparkles']
function cleanPanel(value: unknown): PanelState {
  const obj = (v: unknown) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {}) as Record<string, unknown>
  const str = (v: unknown, max: number) => (typeof v === 'string' && v.trim() ? v.slice(0, max) : undefined)
  const icon = (v: unknown) => (ICONS.includes(v as PanelIcon) ? (v as PanelIcon) : undefined)
  const card = (v: unknown): PanelCard[] => {
    const c = obj(v)
    const title = str(c.title, 200)
    if (!title) return []
    const meta = Array.isArray(c.meta) ? c.meta.slice(0, 4).flatMap((m) => str(m, 60) ?? []) : undefined
    return [{ id: str(c.id, 100), title, subtitle: str(c.subtitle, 200), meta, quote: str(c.quote, 400), image: c.image === 'poster' ? 'poster' : undefined, icon: icon(c.icon) }]
  }
  const step = (v: unknown): PanelStep[] => {
    const s = obj(v)
    const label = str(s.label, 160)
    const state = ['running', 'completed', 'error'].includes(s.state as string) ? (s.state as PanelStep['state']) : undefined
    if (!label || !state) return []
    return [{ label, state, icon: icon(s.icon), cards: Array.isArray(s.cards) ? s.cards.slice(0, 6).flatMap(card) : undefined }]
  }
  const raw = obj(value)
  const turns = Array.isArray(raw.turns) ? raw.turns.slice(-20).flatMap((v) => {
    const t = obj(v)
    const id = str(t.id, 100), question = str(t.question, 500)
    if (!id || !question) return []
    const seconds = typeof t.seconds === 'number' && Number.isFinite(t.seconds) ? t.seconds : undefined
    return [{ id, question, steps: Array.isArray(t.steps) ? t.steps.slice(0, 8).flatMap(step) : [], text: str(t.text, 1000), seconds }]
  }) : []
  return { activity: str(raw.activity, 80), turns }
}

async function playerProperty(name: string): Promise<string> {
  return invoke<string>('player_get_property', { name }).catch(() => '')
}

/** The selected text subtitle track as cues. Tracks izumi loaded from a file or URL (addon, online
 *  search, added by the viewer) are parsed here. Tracks inside the video file are read from the
 *  file in Rust when it is local or a torrent izumi streams; http streams are refused. */
async function currentSubtitles() {
  let tracks: SyncableTrack[] = []
  try { tracks = JSON.parse(await playerTracks()) as SyncableTrack[] } catch { tracks = [] }
  const subs = tracks.filter((t) => t.type === 'sub')
  const list = subs.map((t) => ({ id: t.id, title: t.title, lang: t.lang, selected: !!t.selected }))
  const selected = subs.find((t) => t.selected)
  if (!selected) return { available: false, reason: 'no-subtitles', tracks: list }
  let cues: SubtitleCue[]
  if (selected.external && selected.externalFilename) {
    cues = parseSubtitle(await subtitleText(selected.externalFilename))
  } else {
    // mpv's src-id is the Matroska TrackNumber, with its own demuxer and with FFmpeg's.
    const [source, number] = await Promise.all([playerProperty('path'), playerProperty(`track-list/${tracks.indexOf(selected)}/src-id`)])
    try {
      const raw = await invoke<SubtitleCue[]>('embedded_subtitle_cues', { source, track: Number(number) })
      cues = raw.map((cue) => ({ ...cue, text: cleanText(cue.text) })).filter((cue) => cue.text)
    } catch (error) {
      // The command answers with a short code (remote-stream, not-text, …), never a path.
      return { available: false, reason: typeof error === 'string' ? error : 'unreadable', tracks: list }
    }
  }
  const delay = Number(await playerProperty('sub-delay')) || 0
  return {
    available: true,
    track: { id: selected.id, title: selected.title, lang: selected.lang },
    // Shifted by the viewer's subtitle delay, so a cue's start is where it shows in this video.
    cues: cues.slice(0, MAX_CUES).map((cue) => ({ start: cue.start + delay, end: cue.end + delay, text: cue.text })),
    tracks: list,
  }
}

async function pluginFetch(plugin: InstalledPlugin, rawUrl: unknown, init: unknown) {
  need(plugin, 'network')
  const network = plugin.manifest.permissions.network!
  const endpoint = network.fromSetting ? String(plugin.settings[network.fromSetting] ?? '') : undefined
  const url = checkPluginUrl(String(rawUrl), network.domains, endpoint)
  if (url instanceof Error) {
    pluginLog(plugin.manifest.id, 'warn', `${url.message}: ${String(rawUrl).slice(0, 200)}`)
    throw url
  }
  const options = (init && typeof init === 'object' ? init : {}) as { method?: string; headers?: Record<string, unknown>; body?: unknown }
  const method = (options.method ?? 'GET').toUpperCase()
  const headers = Object.fromEntries(Object.entries(options.headers ?? {}).filter(([, v]) => typeof v === 'string').slice(0, 40)) as Record<string, string>
  if (method === 'GET') {
    const reply = await invoke<{ status: number; body: string }>('http_get', { url: url.href, headers, requestId: crypto.randomUUID(), timeoutMs: 60_000, maxBytes: 10 * 1024 * 1024 })
    return { status: reply.status, headers: {}, body: reply.body }
  }
  if (method !== 'POST') throw new Error('only GET and POST are allowed')
  const body = typeof options.body === 'string' ? options.body : ''
  if (body.length > 2 * 1024 * 1024) throw new Error('request body is larger than 2 MB')
  const reply = await invoke<{ status: number; headers: Record<string, string>; body: string }>('http_post', { url: url.href, body, headers, requestId: crypto.randomUUID(), timeoutMs: 120_000, maxBytes: 10 * 1024 * 1024 })
  return { status: reply.status, headers: reply.headers, body: reply.body }
}

async function handleCall(entry: Live, method: string, args: unknown[]): Promise<unknown> {
  const plugin = entry.plugin
  const id = plugin.manifest.id
  switch (method) {
    case 'settings.get':
      return pluginSettingValues(plugin)
    case 'storage.get':
      return (await pluginStorage(id))[String(args[0])] ?? null
    case 'storage.set': {
      const data = await pluginStorage(id)
      data[String(args[0])] = args[1]
      await writePluginStorage(id, data)
      return null
    }
    case 'storage.delete': {
      const data = await pluginStorage(id)
      delete data[String(args[0])]
      await writePluginStorage(id, data)
      return null
    }
    case 'fetch':
      return pluginFetch(plugin, args[0], args[1])
    case 'player.status': {
      need(plugin, 'player.events')
      const np = get(nowPlaying)
      if (!get(nowPlayingUrl)) return { open: false }
      const [position, duration, paused] = await Promise.all(['time-pos', 'duration', 'pause'].map(playerProperty))
      return { open: true, title: np.animeTitle || np.title, episode: np.episode, anilistId: np.id, position: Number(position) || 0, duration: Number(duration) || 0, paused: paused === 'yes' }
    }
    case 'player.subtitles':
      need(plugin, 'player.subtitles')
      if (!get(nowPlayingUrl)) return { available: false, reason: 'not-playing', tracks: [] }
      return currentSubtitles()
    case 'player.seek': {
      need(plugin, 'player.control')
      const seconds = Number(args[0])
      if (!get(nowPlayingUrl) || !Number.isFinite(seconds) || seconds < 0) throw new Error('nothing to seek')
      await invoke('player_command', { name: 'seek', args: [String(seconds), 'absolute'] })
      return null
    }
    case 'ui.setPanel':
      need(plugin, 'player.panel')
      pluginPanels.update((panels) => ({ ...panels, [id]: cleanPanel(args[0]) }))
      return null
    case 'ui.notice':
      playerNotice.set(String(args[0] ?? '').slice(0, 200))
      return null
    case 'log':
      pluginLog(id, String(args[0]), String(args[1] ?? ''))
      return null
    default:
      throw new Error(`unknown call ${method}`)
  }
}

/** Sends a plugin one of its events (`prompt`, `select`). */
export function sendPluginEvent(id: string, name: string, payload: unknown) {
  live.get(id)?.port.postMessage({ type: 'event', name, payload })
}

function stop(id: string, error?: string) {
  const entry = live.get(id)
  if (entry) {
    clearInterval(entry.heartbeat)
    entry.port.close()
    entry.frame.remove()
    live.delete(id)
  }
  if (error) setRun(id, { state: 'failed', error })
  else pluginRuns.update((runs) => runs.filter((run) => run.id !== id))
  pluginPanels.update(({ [id]: _, ...rest }) => rest)
  if (get(openPluginPanel) === id && !error) openPluginPanel.set(null)
}

async function start(plugin: InstalledPlugin) {
  const id = plugin.manifest.id
  pluginRuns.update((runs) => [...runs.filter((r) => r.id !== id), { id, name: plugin.manifest.name, panel: plugin.manifest.panel, state: 'starting' }])
  const code = await loadPluginCode(id)
  if (!code) return setRun(id, { state: 'failed', error: 'The plugin code is missing. Install it again.' })
  const { frame, port } = await createSandbox(code)
  const entry: Live = { plugin, frame, port, lastPong: Date.now(), heartbeat: setInterval(() => {
    if (Date.now() - entry.lastPong > UNRESPONSIVE_MS) {
      pluginLog(id, 'error', 'stopped: not responding')
      return stop(id, 'Stopped: it stopped responding.')
    }
    port.postMessage({ type: 'ping', n: Date.now() })
  }, HEARTBEAT_MS) }
  live.set(id, entry)
  port.onmessage = (event) => {
    const m = event.data as { type?: string; id?: number; method?: string; args?: unknown[]; error?: string }
    if (!m?.type) return
    if (m.type === 'pong') entry.lastPong = Date.now()
    else if (m.type === 'ready') setRun(id, { state: 'ready', error: undefined })
    else if (m.type === 'failed') {
      pluginLog(id, 'error', m.error ?? 'failed to start')
      stop(id, (m.error ?? 'It failed to start.').split('\n')[0])
    } else if (m.type === 'call' && typeof m.id === 'number' && typeof m.method === 'string') {
      const callId = m.id
      handleCall(entry, m.method, Array.isArray(m.args) ? m.args : [])
        .then((value) => port.postMessage({ type: 'reply', id: callId, value }))
        .catch((error) => port.postMessage({ type: 'reply', id: callId, error: error instanceof Error ? error.message : String(error) }))
    }
  }
}

let conformance: Promise<boolean> | undefined
async function sandboxIsSound(): Promise<boolean> {
  return (conformance ??= runConformance().then((results) => {
    const failed = results ? Object.entries(results).filter(([, r]) => r !== 'blocked').map(([name]) => name) : ['no answer from the sandbox']
    pluginConformance.set({ ok: failed.length === 0, failed })
    return failed.length === 0
  }))
}

let syncing: Promise<void> = Promise.resolve()
/** Starts enabled plugins and stops the rest; runs again whenever the list or the switch changes. */
export function syncPlugins(): Promise<void> {
  syncing = syncing.then(async () => {
    const wanted = get(pluginsEnabled) ? get(installedPlugins).filter((p) => p.enabled) : []
    for (const [id, entry] of [...live]) {
      const next = wanted.find((p) => p.manifest.id === id)
      if (!next || next.manifest.version !== entry.plugin.manifest.version || next.grantHash !== entry.plugin.grantHash) stop(id)
      else entry.plugin = next // settings changes apply to the running plugin
    }
    pluginRuns.update((runs) => runs.filter((run) => wanted.some((p) => p.manifest.id === run.id)))
    if (!wanted.some((p) => !live.has(p.manifest.id))) return
    if (!(await sandboxIsSound())) return
    for (const plugin of wanted) if (!live.has(plugin.manifest.id)) await start(plugin).catch((error) => setRun(plugin.manifest.id, { state: 'failed', error: String(error) }))
  }).catch((error) => console.warn('[plugins]', error))
  return syncing
}

let started = false
/** Called once from the app shell (desktop). */
export function initPlugins() {
  if (started) return
  started = true
  installedPlugins.subscribe(() => void syncPlugins())
  pluginsEnabled.subscribe(() => void syncPlugins())
}
