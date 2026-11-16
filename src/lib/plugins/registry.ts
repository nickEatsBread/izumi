import { get as storeGet } from 'svelte/store'
import { persisted } from 'svelte-persisted-store'
import { createStore, del, get, set, type UseStore } from 'idb-keyval'
import { grantText, parseManifest, sha256Hex, MAX_MAIN_BYTES, MAX_MANIFEST_BYTES, type PluginManifest } from './manifest'

/** Plugins ship behind this switch (Settings → Sources and store → Plugins). Per device. */
export const pluginsEnabled = persisted<boolean>('plugins-enabled-v1', false)

export interface InstalledPlugin {
  manifest: PluginManifest
  /** Where it came from: an https plugin.json URL, or `file` for one picked from disk. */
  origin: string
  enabled: boolean
  /** SHA-256 of the permissions the viewer approved (grantText). */
  grantHash: string
  /** Non-secret setting values; secrets live under `plugin-secret-<id>`. */
  settings: Record<string, string | number | boolean>
  installedAt: number
}

/** Per device, never synced (key-policy: device). */
export const installedPlugins = persisted<InstalledPlugin[]>('installed-plugins-v1', [])

let codeDb: UseStore | undefined
const codeStore = () => (codeDb ??= createStore('izumi-plugins', 'code'))
let dataDb: UseStore | undefined
const dataStore = () => (dataDb ??= createStore('izumi-plugin-storage', 'data'))

export const secretKey = (id: string) => `plugin-secret-${id}`

export interface PreparedPlugin { manifest: PluginManifest; code: string; origin: string; grantHash: string }

/** Checks a manifest and its code (size and pinned hash) before anything is installed. */
export async function preparePlugin(manifestText: string, code: string, origin: string): Promise<PreparedPlugin> {
  if (manifestText.length > MAX_MANIFEST_BYTES) throw new Error('plugin.json is larger than 64 KB.')
  if (code.length > MAX_MAIN_BYTES) throw new Error('The plugin code is larger than 2 MB.')
  let json: unknown
  try { json = JSON.parse(manifestText) } catch { throw new Error('plugin.json is not valid JSON.') }
  const manifest = parseManifest(json)
  if ((await sha256Hex(code)) !== manifest.main.sha256) throw new Error(`${manifest.main.path} does not match the hash in plugin.json.`)
  return { manifest, code, origin, grantHash: await sha256Hex(grantText(manifest)) }
}

/** Fetches `plugin.json` and the file it names from the same https folder. */
export async function preparePluginFromUrl(url: string, fetchText: (url: string) => Promise<string>): Promise<PreparedPlugin> {
  const base = new URL(url)
  if (base.protocol !== 'https:') throw new Error('Install plugins from an https address.')
  const manifestText = await fetchText(base.href)
  const main = parseManifest(JSON.parse(manifestText)).main.path
  return preparePlugin(manifestText, await fetchText(new URL(main, base).href), base.href)
}

/** Installs (or updates) after the viewer approved its permissions. Keeps existing settings. */
export async function installPlugin(prepared: PreparedPlugin): Promise<InstalledPlugin> {
  await set(prepared.manifest.id, prepared.code, codeStore())
  const existing = storeGet(installedPlugins).find((p) => p.manifest.id === prepared.manifest.id)
  const defaults = Object.fromEntries(prepared.manifest.settings.filter((s) => s.type !== 'secret' && s.default !== undefined).map((s) => [s.id, s.default!]))
  const item: InstalledPlugin = {
    manifest: prepared.manifest,
    origin: prepared.origin,
    enabled: existing?.enabled ?? true,
    grantHash: prepared.grantHash,
    settings: { ...defaults, ...existing?.settings },
    installedAt: Date.now(),
  }
  installedPlugins.update((list) => [...list.filter((p) => p.manifest.id !== item.manifest.id), item])
  return item
}

export async function removePlugin(id: string): Promise<void> {
  installedPlugins.update((list) => list.filter((p) => p.manifest.id !== id))
  localStorage.removeItem(secretKey(id))
  await del(id, codeStore())
  await del(id, dataStore())
}

export function setPluginEnabled(id: string, enabled: boolean) {
  installedPlugins.update((list) => list.map((p) => (p.manifest.id === id ? { ...p, enabled } : p)))
}

export function setPluginSetting(id: string, key: string, value: string | number | boolean) {
  installedPlugins.update((list) => list.map((p) => (p.manifest.id === id ? { ...p, settings: { ...p.settings, [key]: value } } : p)))
}

export function readSecrets(id: string): Record<string, string> {
  try { return JSON.parse(localStorage.getItem(secretKey(id)) ?? '{}') as Record<string, string> } catch { return {} }
}

export function setPluginSecret(id: string, key: string, value: string) {
  const secrets = readSecrets(id)
  if (value) secrets[key] = value
  else delete secrets[key]
  localStorage.setItem(secretKey(id), JSON.stringify(secrets))
}

/** The values the plugin's own code sees: its settings and its own secrets. */
export function pluginSettingValues(plugin: InstalledPlugin): Record<string, string | number | boolean> {
  return { ...plugin.settings, ...readSecrets(plugin.manifest.id) }
}

export const loadPluginCode = (id: string) => get<string>(id, codeStore())

/** A plugin's own key-value storage, capped at 5 MB. */
export async function pluginStorage(id: string): Promise<Record<string, unknown>> {
  return (await get<Record<string, unknown>>(id, dataStore())) ?? {}
}
export async function writePluginStorage(id: string, data: Record<string, unknown>) {
  if (JSON.stringify(data).length > 5 * 1024 * 1024) throw new Error('Plugin storage is full (5 MB).')
  await set(id, data, dataStore())
}
