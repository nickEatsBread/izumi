import { get, writable } from 'svelte/store'
import { invoke } from '@tauri-apps/api/core'
import { nowPlaying, nowPlayingUrl, playerNotice } from '$lib/player/session'
import { playerTracks } from '$lib/player/native'
import { parseSubtitle, subtitleText, type SyncableTrack } from '$lib/player/subtitle-sync'
import { checkPluginUrl } from './network'
import type { PluginScope } from './manifest'
import {
  installedPlugins, loadPluginCode, pluginSettingValues, pluginStorage, pluginsEnabled, writePluginStorage,
  type InstalledPlugin,
} from './registry'
import { createSandbox, runConformance } from './sandbox'

export interface PanelItem { id: string; label: string; detail?: string }
export interface PanelState { status?: string; busy?: boolean; items?: PanelItem[] }
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

function cleanPanel(value: unknown): PanelState {
  const raw = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>
  const str = (v: unknown, max: number) => (typeof v === 'string' ? v.slice(0, max) : undefined)
  const items = Array.isArray(raw.items) ? raw.items.slice(0, 20).flatMap((item) => {
    const i = (item && typeof item === 'object' ? item : {}) as Record<string, unknown>
    const id = str(i.id, 100), label = str(i.label, 200)
    return id && label ? [{ id, label, detail: str(i.detail, 300) }] : []
  }) : undefined
  return { status: str(raw.status, 300), busy: raw.busy === true, items }
}

async function playerProperty(name: string): Promise<string> {
  return invoke<string>('player_get_property', { name }).catch(() => '')
}

/** The selected text subtitle track as cues. Tracks izumi loaded from a file or URL (addon, online
 *  search, added by the viewer) can be read; tracks inside the video file cannot yet. */
async function currentSubtitles() {
  let tracks: SyncableTrack[] = []
  try { tracks = JSON.parse(await playerTracks()) as SyncableTrack[] } catch { tracks = [] }
  const subs = tracks.filter((t) => t.type === 'sub')
  const list = subs.map((t) => ({ id: t.id, title: t.title, lang: t.lang, selected: !!t.selected, readable: !!(t.external && t.externalFilename) }))
  const selected = subs.find((t) => t.selected)
  if (!selected) return { available: false, reason: 'no-subtitles', tracks: list }
  if (!selected.external || !selected.externalFilename) return { available: false, reason: 'embedded', tracks: list }
  const cues = parseSubtitle(await subtitleText(selected.externalFilename))
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
