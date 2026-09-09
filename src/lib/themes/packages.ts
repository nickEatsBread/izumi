import { defaultStudioTheme, normalizeStudioTheme, validHslToken, type StudioTheme } from '$lib/settings/theme-studio'
import { parsePresentation, record } from './presentation'

export const THEME_API = 1
export const MAX_THEME_BYTES = 256_000
export const THEME_CATALOG_URL = 'https://raw.githubusercontent.com/nickEatsBread/izumi-themes/main/index.json'
export interface ThemePackage {
  app: 'izumi'; kind: 'theme-package'; schemaVersion: 1; themeApi: 1
  id: string; name: string; version: string; author: string; description: string
  design: StudioTheme
}
export interface ThemeRelease {
  id: string; name: string; version: string; author: string; description: string
  themeApi: number; tags: string[]; preview?: string; project?: string
  download: string; sha256: string; bytes: number
}
export interface ThemeCatalog { app: 'izumi'; kind: 'theme-catalog'; schemaVersion: 1; themes: ThemeRelease[] }
export interface PreparedTheme { package: ThemePackage; origin: string; release?: ThemeRelease; updateUrl?: string }
export function text(value: unknown, max = 160): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw new Error('A theme is missing valid metadata.')
  return value.trim()
}
export function themeUrl(value: unknown): string {
  const url = new URL(text(value, 2048))
  if (url.protocol !== 'https:' || url.username || url.password) throw new Error('Use a public HTTPS theme link.')
  url.hash = ''
  // File links copied from GitHub can point at its HTML viewer. Do not guess ambiguous branch names.
  const parts = url.pathname.split('/').filter(Boolean)
  if (url.hostname === 'github.com' && parts[2] === 'blob' && parts.length >= 5) {
    url.hostname = 'raw.githubusercontent.com'; parts.splice(2, 1); url.pathname = '/' + parts.join('/'); url.search = ''
  }
  return url.href
}
export function version(value: unknown): string {
  const result = text(value, 30)
  if (!/^\d{1,6}\.\d{1,6}\.\d{1,6}$/.test(result)) throw new Error('Use a theme version such as 1.0.0.')
  return result
}
export function newerVersion(candidate: string, current: string): boolean {
  const left = version(candidate).split('.').map(Number), right = version(current).split('.').map(Number)
  for (let i = 0; i < 3; i++) if (left[i] !== right[i]) return left[i] > right[i]
  return false
}
function identity(value: unknown, allowSharedId = false): string {
  const id = text(value, 64)
  // `shared.` is minted client-side when a Theme Studio export becomes installable (parseSharedTheme),
  // so a catalog or release package must not squat it.
  if (!/^[a-z0-9][a-z0-9.-]{1,63}$/.test(id) || id === 'constructor' || id === 'prototype' || (!allowSharedId && id.startsWith('shared.'))) throw new Error('Invalid theme identity.')
  return id
}
/** Shared IDs are allowed only when minting personal exports or reading saved installations. */
export function parseThemePackage(value: unknown, { allowSharedId = false }: { allowSharedId?: boolean } = {}): ThemePackage {
  const raw = record(value)
  if (raw.app !== 'izumi' || raw.kind !== 'theme-package' || raw.schemaVersion !== 1 || raw.themeApi !== THEME_API) throw new Error('This theme requires a different theme API. Check for a client update.')
  const id = identity(raw.id, allowSharedId), name = text(raw.name, 48), design = record(raw.design)
  const allowed = ['tokens', 'radius', 'font', 'fontScale', 'backdrop', 'backdropStrength', 'glassBlur', 'presentation']
  if (Object.keys(design).some(key => !allowed.includes(key))) throw new Error('This theme contains unsupported design settings.')
  if (design.presentation !== undefined) parsePresentation(design.presentation)
  const base: StudioTheme = { ...defaultStudioTheme(0), radius: 0.5, backdrop: 'solid', backdropStrength: 0, glassBlur: 0 }
  if (design.tokens !== undefined) {
    for (const [key, value] of Object.entries(record(design.tokens))) {
      if (!Object.hasOwn(base.tokens, key) || (key === 'scheme' ? value !== 'light' && value !== 'dark' : !validHslToken(value))) throw new Error('The theme contains an invalid color.')
    }
  }
  const normalized = normalizeStudioTheme({ ...base, ...design, id: 'package-design', name })
  for (const key of allowed.filter(key => key !== 'presentation' && key !== 'tokens')) {
    if (design[key] !== undefined && design[key] !== (normalized as unknown as Record<string, unknown>)[key]) throw new Error('The theme contains an unsupported appearance value.')
  }
  return { app: 'izumi', kind: 'theme-package', schemaVersion: 1, themeApi: 1, id, name,
    version: version(raw.version), author: text(raw.author, 80), description: text(raw.description, 600), design: normalized }
}
/** Existing Theme Studio exports remain shareable through files and direct links. */
export function parseSharedTheme(value: unknown): ThemePackage {
  const raw = record(value)
  if (raw.app !== 'izumi' || raw.kind !== 'theme' || raw.version !== 1) return parseThemePackage(value)
  const theme = record(raw.theme)
  if (theme.presentation !== undefined) parsePresentation(theme.presentation)
  const normalized = normalizeStudioTheme(theme)
  const { id, name, createdAt: _created, updatedAt: _updated, ...design } = normalized
  return parseThemePackage({ app: 'izumi', kind: 'theme-package', schemaVersion: 1, themeApi: 1,
    id: `shared.${id.toLowerCase().slice(0, 48)}`, name, author: 'Shared theme', description: 'A personal Theme Studio design. Customize it after installing.', version: '1.0.0', design }, { allowSharedId: true })
}
export function parseRelease(value: unknown): ThemeRelease {
  const raw = record(value)
  const bytes = raw.bytes
  if (typeof bytes !== 'number' || !Number.isSafeInteger(bytes) || bytes < 1 || bytes > MAX_THEME_BYTES) throw new Error('The theme package is too large.')
  if (typeof raw.sha256 !== 'string' || !/^[a-f0-9]{64}$/i.test(raw.sha256)) throw new Error('The theme listing needs a valid package checksum.')
  if (!Number.isSafeInteger(raw.themeApi) || Number(raw.themeApi) < 1) throw new Error('Missing theme API version.')
  if (!Array.isArray(raw.tags) || raw.tags.length > 12) throw new Error('Invalid theme tags.')
  return { id: identity(raw.id), name: text(raw.name, 48), version: version(raw.version), author: text(raw.author, 80),
    description: text(raw.description, 600), themeApi: Number(raw.themeApi), tags: raw.tags.map(tag => text(tag, 32)),
    download: themeUrl(raw.download), sha256: raw.sha256.toLowerCase(), bytes,
    ...(raw.preview ? { preview: themeUrl(raw.preview) } : {}), ...(raw.project ? { project: themeUrl(raw.project) } : {}) }
}
export function parseCatalog(value: unknown): ThemeCatalog {
  const raw = record(value)
  if (raw.app !== 'izumi' || raw.kind !== 'theme-catalog' || raw.schemaVersion !== 1 || !Array.isArray(raw.themes) || raw.themes.length > 500) throw new Error('The theme catalog is not supported.')
  const themes = raw.themes.map(parseRelease)
  if (new Set(themes.map(theme => theme.id)).size !== themes.length) throw new Error('The theme catalog has duplicate identities.')
  return { app: 'izumi', kind: 'theme-catalog', schemaVersion: 1, themes }
}
export function portablePackage(pkg: ThemePackage): Record<string, unknown> {
  const { id: _id, name: _name, createdAt: _created, updatedAt: _updated, ...design } = pkg.design
  return { ...pkg, design }
}
