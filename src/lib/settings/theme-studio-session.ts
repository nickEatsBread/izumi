import { get, writable } from 'svelte/store'
import { themePreset } from '$lib/settings/ui'
import { activeStudioTheme, defaultStudioTheme, themeStudioPreview, type StudioTheme } from './theme-studio'
import { resolvedThemeTokens } from '$lib/theme-tokens'
import { themeInstallPreview, cancelThemePreview } from '$lib/themes/installed'

// Owned by the app shell, so browsing between pages never ends an editing session.
export const themeStudioOpen = writable(false)
export const themeStudioMinimized = writable(false)

export function currentStudioDesign(prefersDark = true): StudioTheme {
  const preset = get(themePreset)
  const active = get(activeStudioTheme)
  if (preset === 'custom') return { ...active, tokens: { ...active.tokens } }
  // Opening the editor must preserve the current appearance, including a system/light preset.
  return {
    ...defaultStudioTheme(),
    id: active.id,
    name: active.name,
    createdAt: active.createdAt,
    tokens: { ...resolvedThemeTokens(preset, prefersDark) },
    radius: 0.5,
    backdrop: 'solid',
    backdropStrength: 0,
    glassBlur: 0,
  }
}

export function openThemeStudio(): void {
  if (get(themeInstallPreview)) cancelThemePreview()
  if (!get(themeStudioOpen)) {
    const prefersDark = typeof matchMedia === 'undefined' || matchMedia('(prefers-color-scheme: dark)').matches
    themeStudioPreview.set(currentStudioDesign(prefersDark))
    themeStudioOpen.set(true)
  }
  themeStudioMinimized.set(false)
}

export function resetToShippedTheme(): StudioTheme {
  if (get(themeInstallPreview)) cancelThemePreview()
  // The Studio starter has an aurora and softer corners. The shipped client uses the built-in
  // Izumi preset instead. Select it persistently without overwriting anyone's saved themes.
  themePreset.set('izumi')
  const design = currentStudioDesign()
  themeStudioPreview.set(get(themeStudioOpen) ? design : null)
  return design
}

export function closeThemeStudio(): void {
  themeStudioPreview.set(null)
  themeStudioOpen.set(false)
  themeStudioMinimized.set(false)
}
