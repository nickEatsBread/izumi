import { persisted } from 'svelte-persisted-store'
import { derived, get, writable, type Writable } from 'svelte/store'
import { THEME_PRESETS, type ThemeTokens } from '$lib/theme-tokens'
import { parsePresentation, type ThemePresentation } from '$lib/themes/presentation'

export type ThemeFont = 'nunito' | 'system' | 'serif' | 'mono'
export type ThemeBackdrop = 'solid' | 'aurora' | 'spotlight' | 'mesh'

export interface StudioTheme {
  id: string
  name: string
  createdAt: number
  updatedAt: number
  tokens: ThemeTokens
  radius: number
  font: ThemeFont
  fontScale: number
  backdrop: ThemeBackdrop
  backdropStrength: number
  glassBlur: number
  presentation?: ThemePresentation
}

export interface StudioThemeExport {
  app: 'izumi'
  kind: 'theme'
  version: 1
  theme: StudioTheme
}

const STUDIO_ID = 'izumi-studio'

export function defaultStudioTheme(now = Date.now()): StudioTheme {
  return {
    id: STUDIO_ID,
    name: 'My Izumi',
    createdAt: now,
    updatedAt: now,
    tokens: { ...THEME_PRESETS.izumi },
    radius: 0.75,
    font: 'nunito',
    fontScale: 1,
    backdrop: 'aurora',
    backdropStrength: 0.28,
    glassBlur: 16,
  }
}

export const activeStudioThemeId = persisted('theme-studio-active-v1', STUDIO_ID)
export const themeStudioPreview = writable<StudioTheme | null>(null)

function bounded(value: unknown, fallback: number, min: number, max: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback
}

const HSL = /^\s*(-?\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)%\s+(\d+(?:\.\d+)?)%\s*$/

export function validHslToken(value: unknown): value is string {
  if (typeof value !== 'string') return false
  const match = HSL.exec(value)
  if (!match) return false
  const [, hue, saturation, lightness] = match.map(Number)
  return Number.isFinite(hue) && saturation >= 0 && saturation <= 100 && lightness >= 0 && lightness <= 100
}

export function normalizeStudioTheme(value: unknown, fallback = defaultStudioTheme()): StudioTheme {
  if (!value || typeof value !== 'object') return fallback
  const raw = value as Partial<StudioTheme>
  const tokenInput = raw.tokens && typeof raw.tokens === 'object' ? raw.tokens as Partial<ThemeTokens> : {}
  const tokens = { ...fallback.tokens }
  for (const key of Object.keys(tokens) as Array<keyof ThemeTokens>) {
    if (key === 'scheme') continue
    const candidate = tokenInput[key]
    if (validHslToken(candidate)) tokens[key] = candidate as never
  }
  tokens.scheme = tokenInput.scheme === 'light' || tokenInput.scheme === 'dark' ? tokenInput.scheme : fallback.tokens.scheme
  const fonts: ThemeFont[] = ['nunito', 'system', 'serif', 'mono']
  const backdrops: ThemeBackdrop[] = ['solid', 'aurora', 'spotlight', 'mesh']
  let presentation: ThemePresentation | undefined
  try { if (raw.presentation) presentation = parsePresentation(raw.presentation) } catch { /* Recover old or damaged local preferences to the built-in layout. */ }
  return {
    id: typeof raw.id === 'string' && /^[a-z0-9][a-z0-9-]{0,63}$/i.test(raw.id) ? raw.id : fallback.id,
    name: typeof raw.name === 'string' && raw.name.trim() ? raw.name.trim().slice(0, 48) : fallback.name,
    createdAt: bounded(raw.createdAt, fallback.createdAt, 0, Number.MAX_SAFE_INTEGER),
    updatedAt: bounded(raw.updatedAt, fallback.updatedAt, 0, Number.MAX_SAFE_INTEGER),
    tokens,
    radius: bounded(raw.radius, fallback.radius, 0, 2),
    font: fonts.includes(raw.font as ThemeFont) ? raw.font as ThemeFont : fallback.font,
    fontScale: bounded(raw.fontScale, fallback.fontScale, 0.85, 1.2),
    backdrop: backdrops.includes(raw.backdrop as ThemeBackdrop) ? raw.backdrop as ThemeBackdrop : fallback.backdrop,
    backdropStrength: bounded(raw.backdropStrength, fallback.backdropStrength, 0, 0.65),
    glassBlur: bounded(raw.glassBlur, fallback.glassBlur, 0, 40),
    ...(presentation ? { presentation } : {}),
  }
}

function normalizeRecords(value: unknown): StudioTheme[] {
  if (!Array.isArray(value)) return [defaultStudioTheme(0)]
  const unique = new Map<string, StudioTheme>()
  for (const item of value.slice(0, 24)) {
    const normalized = normalizeStudioTheme(item)
    unique.set(normalized.id, normalized)
  }
  return unique.size ? [...unique.values()] : [defaultStudioTheme(0)]
}

const records = persisted<StudioTheme[]>('theme-studio-themes-v1', [defaultStudioTheme(0)], {
  beforeRead: normalizeRecords,
  onWriteError: () => { throw new Error('Could not save the theme. Free some device storage and try again.') },
})
const normalized = normalizeRecords(get(records))
if (JSON.stringify(normalized) !== JSON.stringify(get(records))) {
  try { records.set(normalized) } catch { /* Keep the normalized in-memory recovery state. */ }
}

function setStudioRecords(value: StudioTheme[]): void {
  const previous = get(records)
  try { records.set(normalizeRecords(value)) }
  catch (error) {
    try { records.set(previous) } catch { /* Restore in-memory state even if storage remains unavailable. */ }
    throw error
  }
}

export const studioThemes: Writable<StudioTheme[]> = {
  subscribe: records.subscribe,
  set: setStudioRecords,
  update: (updater) => setStudioRecords(updater(normalizeRecords(get(records)))),
}

export const activeStudioTheme = derived(
  [studioThemes, activeStudioThemeId],
  ([$themes, $active]) => $themes.find((theme) => theme.id === $active) ?? $themes[0] ?? defaultStudioTheme(0),
)

export function saveStudioTheme(theme: StudioTheme): StudioTheme {
  const normalizedTheme = normalizeStudioTheme({ ...theme, updatedAt: Date.now() })
  studioThemes.update((themes) => {
    const found = themes.some((candidate) => candidate.id === normalizedTheme.id)
    return found
      ? themes.map((candidate) => candidate.id === normalizedTheme.id ? normalizedTheme : candidate)
      : [...themes, normalizedTheme]
  })
  activeStudioThemeId.set(normalizedTheme.id)
  themeStudioPreview.set(null)
  return normalizedTheme
}

export function duplicateStudioTheme(source: StudioTheme, now = Date.now(), activate = true): StudioTheme {
  const id = `theme-${now.toString(36)}-${Math.random().toString(36).slice(2, 7)}`
  const copy = normalizeStudioTheme({
    ...source,
    id,
    name: `${source.name} Copy`.slice(0, 48),
    createdAt: now,
    updatedAt: now,
    tokens: { ...source.tokens },
  })
  studioThemes.update((themes) => [...themes, copy])
  if (activate) activeStudioThemeId.set(copy.id)
  return copy
}

export function deleteStudioTheme(id: string): boolean {
  let deleted = false
  const wasActive = get(activeStudioThemeId) === id
  studioThemes.update((themes) => {
    if (themes.length <= 1 || !themes.some((theme) => theme.id === id)) return themes
    deleted = true
    return themes.filter((theme) => theme.id !== id)
  })
  if (deleted && wasActive) activeStudioThemeId.set(get(studioThemes)[0]?.id ?? STUDIO_ID)
  themeStudioPreview.set(null)
  return deleted
}

export function stringifyStudioTheme(theme: StudioTheme): string {
  const payload: StudioThemeExport = {
    app: 'izumi', kind: 'theme', version: 1, theme: normalizeStudioTheme(theme),
  }
  return JSON.stringify(payload, null, 2)
}

export function parseStudioTheme(text: string, now = Date.now()): StudioTheme {
  const payload = JSON.parse(text) as Partial<StudioThemeExport>
  if (payload.app !== 'izumi' || payload.kind !== 'theme' || payload.version !== 1 || !payload.theme) {
    throw new Error('Not an Izumi Theme Studio file.')
  }
  const imported = normalizeStudioTheme(payload.theme)
  return normalizeStudioTheme({
    ...imported,
    id: `theme-${now.toString(36)}-imported`,
    name: `${imported.name} (Imported)`.slice(0, 48),
    createdAt: now,
    updatedAt: now,
  })
}

export function hslTokenToHex(value: string): string {
  const match = HSL.exec(value)
  if (!match) return '#000000'
  let [, hue, saturation, lightness] = match.map(Number)
  hue = ((hue % 360) + 360) % 360
  saturation /= 100
  lightness /= 100
  const chroma = (1 - Math.abs(2 * lightness - 1)) * saturation
  const x = chroma * (1 - Math.abs((hue / 60) % 2 - 1))
  const offset = lightness - chroma / 2
  const rgb = hue < 60 ? [chroma, x, 0] : hue < 120 ? [x, chroma, 0] : hue < 180
    ? [0, chroma, x] : hue < 240 ? [0, x, chroma] : hue < 300 ? [x, 0, chroma] : [chroma, 0, x]
  return `#${rgb.map((channel) => Math.round((channel + offset) * 255).toString(16).padStart(2, '0')).join('')}`
}

export function hexToHslToken(value: string): string {
  const clean = value.trim().replace(/^#/, '')
  if (!/^[0-9a-f]{6}$/i.test(clean)) return '0 0% 0%'
  const [red, green, blue] = [0, 2, 4].map((index) => parseInt(clean.slice(index, index + 2), 16) / 255)
  const max = Math.max(red, green, blue), min = Math.min(red, green, blue)
  const lightness = (max + min) / 2
  const delta = max - min
  let hue = 0
  if (delta) {
    if (max === red) hue = 60 * (((green - blue) / delta) % 6)
    else if (max === green) hue = 60 * ((blue - red) / delta + 2)
    else hue = 60 * ((red - green) / delta + 4)
  }
  if (hue < 0) hue += 360
  const saturation = delta ? delta / (1 - Math.abs(2 * lightness - 1)) : 0
  return `${round(hue)} ${round(saturation * 100)}% ${round(lightness * 100)}%`
}

export function tokenContrast(foreground: string, background: string): number {
  const luminance = (token: string) => {
    const hex = hslTokenToHex(token)
    const channels = [1, 3, 5].map((index) => parseInt(hex.slice(index, index + 2), 16) / 255)
      .map((channel) => channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4)
    return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722
  }
  const values = [luminance(foreground), luminance(background)].sort((left, right) => right - left)
  return (values[0] + 0.05) / (values[1] + 0.05)
}

function round(value: number): number {
  return Math.round(value * 10) / 10
}
