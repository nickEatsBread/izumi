/** Plugin package format, API 2 (docs/navigator-player-and-ai-jump.md, "Plugin runtime"). A plugin is
 *  `plugin.json` plus one `main.js` module whose SHA-256 the manifest pins. API 2 added the `signin`
 *  permission, plugin secrets, the settings account block and setting links; API 1 plugins still run. */

export const PLUGIN_API = 2
export const MAX_MANIFEST_BYTES = 64 * 1024
export const MAX_MAIN_BYTES = 2 * 1024 * 1024

/** Scopes a plugin can ask for. Everything else (its own panel, settings, storage, timers) needs none. */
export const PLUGIN_SCOPES = ['network', 'signin', 'player.events', 'player.control', 'player.subtitles', 'player.panel'] as const
export type PluginScope = (typeof PLUGIN_SCOPES)[number]

export const SCOPE_TEXT: Record<PluginScope, string> = {
  network: 'Connect to the internet (only the addresses listed below)',
  signin: 'Open your browser to sign in at the addresses listed below, and receive the sign-in',
  'player.events': 'See what is playing and where you are in it',
  'player.control': 'Seek the player',
  'player.subtitles': 'Read the text of the subtitle track you have on',
  'player.panel': 'Show a panel in the player',
}

export type PluginSettingType = 'text' | 'secret' | 'toggle' | 'select' | 'number' | 'url'
export interface PluginSetting {
  id: string
  type: PluginSettingType
  label: string
  description?: string
  placeholder?: string
  default?: string | number | boolean
  options?: { value: string; label: string }[]
  /** Pages izumi opens in the browser, such as where to get an API key. https only. */
  links?: { label: string; url: string }[]
}

export interface PluginManifest {
  id: string
  name: string
  version: string
  author: string
  description: string
  main: { path: string; sha256: string }
  permissions: {
    scopes: PluginScope[]
    /** Fixed hosts (`*.example.com` allowed) and/or a `url` setting whose host the viewer chooses. */
    network?: { domains: string[]; fromSetting?: string; reason: string }
  }
  settings: PluginSetting[]
  /** The player panel's button and prompt. Needs `player.panel`. */
  panel?: { label: string; placeholder: string }
}

const ID = /^[a-z0-9]+(?:[.-][a-z0-9]+)+$/
const VERSION = /^\d{1,6}\.\d{1,6}\.\d{1,6}$/
const HEX64 = /^[0-9a-f]{64}$/
const DOMAIN = /^(\*\.)?(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/
const SETTING_ID = /^[A-Za-z][A-Za-z0-9_-]{0,39}$/

function text(value: unknown, name: string, max = 200): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw new Error(`Plugin ${name} is missing or too long.`)
  return value.trim()
}

function record(value: unknown, name: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`Plugin ${name} must be an object.`)
  return value as Record<string, unknown>
}

function parseSetting(value: unknown): PluginSetting {
  const raw = record(value, 'setting')
  const id = text(raw.id, 'setting id', 40)
  if (!SETTING_ID.test(id)) throw new Error(`Plugin setting id "${id}" is not valid.`)
  const type = raw.type as PluginSettingType
  if (!['text', 'secret', 'toggle', 'select', 'number', 'url'].includes(type)) throw new Error(`Plugin setting ${id} has an unknown type.`)
  const setting: PluginSetting = { id, type, label: text(raw.label, 'setting label', 80) }
  if (raw.description !== undefined) setting.description = text(raw.description, 'setting description', 300)
  if (raw.placeholder !== undefined) setting.placeholder = text(raw.placeholder, 'setting placeholder', 200)
  if (type === 'select') {
    if (!Array.isArray(raw.options) || !raw.options.length || raw.options.length > 50) throw new Error(`Plugin setting ${id} needs options.`)
    setting.options = raw.options.map((option) => {
      const o = record(option, 'setting option')
      return { value: text(o.value, 'option value', 100), label: text(o.label, 'option label', 100) }
    })
  }
  if (raw.links !== undefined) {
    if (!Array.isArray(raw.links) || raw.links.length > 4) throw new Error(`Plugin setting ${id} has too many links.`)
    setting.links = raw.links.map((link) => {
      const l = record(link, 'setting link')
      const url = text(l.url, 'link url', 300)
      if (!url.startsWith('https://') || !URL.canParse(url)) throw new Error(`Plugin setting ${id} links must be https.`)
      return { label: text(l.label, 'link label', 40), url }
    })
  }
  if (raw.default !== undefined) {
    if (type === 'secret') throw new Error(`Plugin secret ${id} cannot have a default.`)
    if (!['string', 'number', 'boolean'].includes(typeof raw.default)) throw new Error(`Plugin setting ${id} has an invalid default.`)
    setting.default = raw.default as string | number | boolean
  }
  return setting
}

/** Validates `plugin.json`. Throws a readable error for anything izumi would not run. */
export function parseManifest(value: unknown): PluginManifest {
  const raw = record(value, 'manifest')
  if (raw.app !== 'izumi' || raw.kind !== 'plugin' || raw.schemaVersion !== 1) throw new Error('This is not an izumi plugin.')
  if (!Number.isInteger(raw.pluginApi) || (raw.pluginApi as number) < 1 || (raw.pluginApi as number) > PLUGIN_API) throw new Error('This plugin needs a different version of izumi.')
  const id = text(raw.id, 'id', 100)
  if (!ID.test(id)) throw new Error('Plugin id must look like "com.example.name".')
  const version = text(raw.version, 'version', 20)
  if (!VERSION.test(version)) throw new Error('Plugin version must be three numbers, like 1.0.0.')
  const main = record(raw.main, 'main')
  const sha256 = text(main.sha256, 'main.sha256', 64).toLowerCase()
  if (!HEX64.test(sha256)) throw new Error('Plugin main.sha256 must be a SHA-256 hex digest.')
  const mainPath = text(main.path, 'main.path', 100)
  if (!/^[A-Za-z0-9._-]+\.m?js$/.test(mainPath)) throw new Error('Plugin main.path must be a .js file next to plugin.json.')

  const permissions = record(raw.permissions ?? {}, 'permissions')
  const scopes = Array.isArray(permissions.scopes) ? permissions.scopes : []
  for (const scope of scopes) if (!PLUGIN_SCOPES.includes(scope as PluginScope)) throw new Error(`Unknown plugin permission "${String(scope)}".`)
  if (new Set(scopes).size !== scopes.length) throw new Error('A plugin permission is listed twice.')
  const settings = Array.isArray(raw.settings) ? raw.settings.slice(0, 40).map(parseSetting) : []
  if (new Set(settings.map((s) => s.id)).size !== settings.length) throw new Error('Two plugin settings share an id.')

  const manifest: PluginManifest = {
    id,
    name: text(raw.name, 'name', 60),
    version,
    author: text(raw.author, 'author', 80),
    description: text(raw.description, 'description', 400),
    main: { path: mainPath, sha256 },
    permissions: { scopes: scopes as PluginScope[] },
    settings,
  }
  if (permissions.network !== undefined) {
    if (!scopes.includes('network')) throw new Error('Network addresses need the "network" permission.')
    const network = record(permissions.network, 'permissions.network')
    const domains = Array.isArray(network.domains) ? network.domains.map((d) => text(d, 'domain', 253).toLowerCase()) : []
    for (const domain of domains) if (!DOMAIN.test(domain)) throw new Error(`"${domain}" is not a domain name.`)
    let fromSetting: string | undefined
    if (network.fromSetting !== undefined) {
      fromSetting = text(network.fromSetting, 'network.fromSetting', 40)
      if (settings.find((s) => s.id === fromSetting)?.type !== 'url') throw new Error('network.fromSetting must name a "url" setting.')
    }
    if (!domains.length && !fromSetting) throw new Error('A network permission must list domains or a url setting.')
    manifest.permissions.network = { domains, ...(fromSetting ? { fromSetting } : {}), reason: text(network.reason, 'network.reason', 300) }
  } else if (scopes.includes('network')) {
    throw new Error('The "network" permission needs permissions.network.')
  }
  // The browser only opens the fixed addresses the viewer approved.
  if (scopes.includes('signin') && !manifest.permissions.network?.domains.length) throw new Error('The "signin" permission needs network domains to sign in to.')
  if (raw.panel !== undefined) {
    if (!scopes.includes('player.panel')) throw new Error('A player panel needs the "player.panel" permission.')
    const panel = record(raw.panel, 'panel')
    manifest.panel = { label: text(panel.label, 'panel.label', 40), placeholder: text(panel.placeholder, 'panel.placeholder', 120) }
  }
  return manifest
}

export async function sha256Hex(data: string | ArrayBuffer): Promise<string> {
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : new Uint8Array(data)
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

/** What the viewer approved: the scopes and network addresses, canonical and hashed. An update whose
 *  hash differs needs approval again. */
export function grantText(manifest: PluginManifest): string {
  const network = manifest.permissions.network
  return JSON.stringify({
    scopes: [...manifest.permissions.scopes].sort(),
    domains: [...(network?.domains ?? [])].sort(),
    fromSetting: network?.fromSetting ?? null,
  })
}
