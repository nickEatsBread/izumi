import { persisted } from 'svelte-persisted-store'
import { get, writable } from 'svelte/store'
import { activeStudioThemeId, studioThemes, normalizeStudioTheme, themeStudioPreview, type StudioTheme } from '$lib/settings/theme-studio'
import { themePreset } from '$lib/settings/ui'
import { THEME_CATALOG_URL, newerVersion, parseThemePackage, portablePackage, themeUrl, type PreparedTheme, type ThemePackage } from './packages'

export interface InstalledTheme {
  id: string; origin: string; designId: string; package: ThemePackage; updateUrl?: string
  previous?: { package: ThemePackage; design: StudioTheme }
}
export function normalizeInstalledThemes(value: unknown): InstalledTheme[] {
  if (!Array.isArray(value)) return []
  const records = new Map<string, InstalledTheme>()
  for (const raw of value.slice(0, 24)) {
    try {
      // Saved personal imports already have a client-minted shared ID. Validate the complete
      // package here without applying the namespace restriction for new external packages.
      const pkg = parseThemePackage(portablePackage(raw.package), { allowSharedId: true })
      if (raw.id !== pkg.id || typeof raw.designId !== 'string' || !/^[a-z0-9][a-z0-9-]{0,63}$/i.test(raw.designId)) continue
      const origin = raw.origin === `file:${pkg.id}` ? raw.origin : themeUrl(raw.origin)
      const previous = raw.previous ? { package: parseThemePackage(portablePackage(raw.previous.package), { allowSharedId: true }), design: normalizeStudioTheme(raw.previous.design) } : undefined
      if (previous && previous.package.id !== pkg.id) continue
      records.set(pkg.id, { id: pkg.id, designId: raw.designId, origin, package: pkg,
        ...(raw.updateUrl ? { updateUrl: themeUrl(raw.updateUrl) } : {}), ...(previous ? { previous } : {}) })
    } catch { /* A damaged entry must not prevent opening the library or restoring the default. */ }
  }
  return [...records.values()]
}
export const installedThemes = persisted<InstalledTheme[]>('installed-themes-v1', [], {
  beforeRead: normalizeInstalledThemes,
  onWriteError: () => { throw new Error('Could not save the theme library. Free some device storage and try again.') },
})
export const themeInstallPreview = writable<PreparedTheme | null>(null)

/** Three-way merge: retain personal edits while taking new author values where untouched. */
export function rebaseDesign(base: unknown, edited: unknown, next: unknown): unknown {
  if (JSON.stringify(base) === JSON.stringify(edited)) return next
  if (!base || !edited || typeof base !== 'object' || typeof edited !== 'object' || Array.isArray(base) || Array.isArray(edited)) return edited
  const before = base as Record<string, unknown>, current = edited as Record<string, unknown>
  const result: Record<string, unknown> = next && typeof next === 'object' && !Array.isArray(next) ? { ...next as Record<string, unknown> } : {}
  for (const key of new Set([...Object.keys(before), ...Object.keys(current)])) {
    if (['__proto__', 'constructor', 'prototype'].includes(key)) continue
    if (!(key in current)) delete result[key]
    else result[key] = rebaseDesign(before[key], current[key], result[key])
  }
  return result
}
export function installTheme(prepared: PreparedTheme): InstalledTheme {
  const installed = get(installedThemes), pkg = prepared.package
  const existing = installed.find(item => item.id === pkg.id)
  if (existing && existing.origin !== prepared.origin) throw new Error('This theme ID is already installed from another location. Remove it before changing its origin.')
  const library = get(studioThemes)
  const designId = existing?.designId ?? `installed-${crypto.randomUUID()}`
  const current = library.find(theme => theme.id === designId)
  if (existing && !newerVersion(pkg.version, existing.package.version) && (current || pkg.version !== existing.package.version)) throw new Error('This version is already installed. Apply it from Installed themes.')
  if (!current && library.length >= 24) throw new Error('Remove a saved theme before installing another. You can keep 24 themes.')
  const design = normalizeStudioTheme({ ...preparedDesign(prepared), id: designId, updatedAt: Date.now() })
  const item: InstalledTheme = { id: pkg.id, origin: prepared.origin, designId, package: pkg,
    ...(prepared.updateUrl ? { updateUrl: prepared.updateUrl } : {}),
    ...(existing && current ? { previous: { package: existing.package, design: current } } : {}) }
  saveThemeState(current ? library.map(theme => theme.id === designId ? design : theme) : [...library, design], [...installed.filter(theme => theme.id !== pkg.id), item])
  return item
}
function saveThemeState(library: StudioTheme[], installed: InstalledTheme[]): void {
  const beforeLibrary = get(studioThemes), beforeInstalled = get(installedThemes)
  try {
    studioThemes.set(library)
    installedThemes.set(installed)
  } catch (error) {
    try { studioThemes.set(beforeLibrary) } catch { /* The existing saved design remains the recovery baseline. */ }
    try { installedThemes.set(beforeInstalled) } catch { /* Storage can be unavailable in this session. */ }
    throw error
  }
}
export function applyInstalledTheme(item: InstalledTheme): void {
  if (!get(studioThemes).some(theme => theme.id === item.designId)) throw new Error('This saved theme was removed. Reinstall the theme.')
  // A still-open installation preview keeps precedence over the active theme, so it must not
  // survive an explicit apply — the document would keep rendering the previewed design.
  cancelThemePreview()
  activeStudioThemeId.set(item.designId); themePreset.set('custom')
}
export function removeInstalledTheme(id: string): void {
  const item = get(installedThemes).find(theme => theme.id === id)
  if (!item) return
  saveThemeState(get(studioThemes).filter(theme => theme.id !== item.designId), get(installedThemes).filter(theme => theme.id !== id))
  // Only hand back to the shipped appearance when the removed install WAS the active appearance;
  // a stale designId pointer under a shipped preset must not override the user's preset choice.
  if (get(activeStudioThemeId) === item.designId && get(themePreset) === 'custom') themePreset.set('izumi')
}
export function rollbackTheme(id: string): void {
  const item = get(installedThemes).find(theme => theme.id === id)
  if (!item?.previous) return
  cancelThemePreview()
  const prior = item.previous
  saveThemeState(get(studioThemes).map(theme => theme.id === item.designId ? { ...prior.design, id: item.designId } : theme), get(installedThemes).map(theme => theme.id === id ? { ...item, package: prior.package, previous: undefined } : theme))
}
export function previewTheme(prepared: PreparedTheme): void {
  themeInstallPreview.set(prepared)
  themeStudioPreview.set(preparedDesign(prepared))
}
export function preparedDesign(prepared: PreparedTheme): StudioTheme {
  const existing = get(installedThemes).find(item => item.id === prepared.package.id && item.origin === prepared.origin)
  const current = existing && get(studioThemes).find(theme => theme.id === existing.designId)
  return normalizeStudioTheme(existing && current ? rebaseDesign(existing.package.design, current, prepared.package.design) : prepared.package.design)
}
export function cancelThemePreview(): void {
  themeInstallPreview.set(null); themeStudioPreview.set(null)
}
export const isCatalogTheme = (theme: InstalledTheme) => theme.origin === THEME_CATALOG_URL
