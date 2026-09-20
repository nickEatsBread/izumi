import { get } from 'svelte/store'
import { highContrast, largeInteractionTargets, motionPreference, themePreset } from '$lib/settings/ui'
import { activeStudioTheme, themeStudioPreview, type StudioTheme } from '$lib/settings/theme-studio'
import { resolvedThemeTokens } from '$lib/theme-tokens'

export { resolvedThemeTokens, THEME_PRESETS, type ThemeTokens } from '$lib/theme-tokens'

const FONT_STACKS: Record<StudioTheme['font'], string> = {
  nunito: "'Nunito Variable', sans-serif",
  system: "system-ui, -apple-system, 'Segoe UI', sans-serif",
  serif: "Georgia, 'Times New Roman', serif",
  mono: "'Geist Mono', ui-monospace, monospace",
}

function apply() {
  if (typeof document === 'undefined') return
  const media = matchMedia('(prefers-color-scheme: dark)')
  const preset = get(themePreset)
  const preview = get(themeStudioPreview)
  const studio = preview ?? get(activeStudioTheme)
  // The open Theme Studio applies drafts live without persisting them until Save.
  const tokens = preview?.tokens ?? resolvedThemeTokens(preset, media.matches, preset === 'custom' ? studio.tokens : null)
  const root = document.documentElement
  const values: Record<string, string> = {
    background: tokens.background, foreground: tokens.foreground, muted: tokens.muted,
    'muted-foreground': tokens.mutedForeground, primary: tokens.primary,
    'primary-foreground': tokens.primaryForeground, secondary: tokens.secondary,
    'secondary-foreground': tokens.secondaryForeground, accent: tokens.accent,
    'accent-foreground': tokens.accentForeground, border: tokens.border, input: tokens.input,
    ring: tokens.ring, card: tokens.card, 'card-foreground': tokens.cardForeground, theme: tokens.theme,
  }
  for (const [name, value] of Object.entries(values)) root.style.setProperty(`--${name}`, value)
  const customActive = preset === 'custom' || preview != null
  root.style.setProperty('--radius', customActive ? `${studio.radius}rem` : '0.5rem')
  root.style.setProperty('--ui-font', customActive ? FONT_STACKS[studio.font] : FONT_STACKS.nunito)
  root.style.setProperty('--theme-font-scale', customActive ? String(studio.fontScale) : '1')
  root.style.setProperty('--theme-backdrop-strength', customActive ? String(studio.backdropStrength) : '0')
  root.style.setProperty('--theme-glass-blur', customActive ? `${studio.glassBlur}px` : '0px')
  root.style.colorScheme = tokens.scheme
  root.dataset.theme = preset
  root.dataset.scheme = tokens.scheme
  root.dataset.themeBackdrop = customActive ? studio.backdrop : 'solid'
  const presentation = customActive ? studio.presentation : undefined
  root.dataset.themeDensity = presentation?.density ?? 'comfortable'
  root.dataset.themeNav = presentation?.shell?.nav ?? 'sidebar'
  root.classList.toggle('theme-true-black', !!presentation?.trueBlack && tokens.scheme === 'dark')
  root.classList.toggle('theme-hide-labels', !!presentation?.hideCardLabels)
  root.classList.toggle('theme-shell-compact', !!presentation?.shell?.compact)
  root.classList.toggle('theme-shell-fade', presentation?.shell?.overlay === 'fade')
  root.classList.toggle('theme-press-sink', presentation?.shell?.press === 'sink')
  if (presentation?.trueBlack && tokens.scheme === 'dark') {
    root.style.setProperty('--background', '0 0% 0%')
    root.style.setProperty('--card', '0 0% 0%')
  }
  if (presentation?.player?.seekbarHeight) root.style.setProperty('--theme-seekbar-height', `${presentation.player.seekbarHeight}px`)
  else root.style.removeProperty('--theme-seekbar-height')
  if (presentation?.player?.seekbarColor) {
    const color = presentation.player.seekbarColor
    root.style.setProperty('--theme-seekbar-color', color.startsWith('#') || color === 'transparent' ? color : `hsl(var(--${color}))`)
  } else root.style.removeProperty('--theme-seekbar-color')
  root.classList.toggle('a11y-high-contrast', get(highContrast))
  root.classList.toggle('a11y-large-targets', get(largeInteractionTargets))
  root.classList.toggle('a11y-reduce-motion', get(motionPreference) === 'reduce')
  root.classList.toggle('a11y-full-motion', get(motionPreference) === 'full')
}

let started = false
export function startThemeSync(): () => void {
  if (started || typeof window === 'undefined') return () => {}
  started = true
  const media = matchMedia('(prefers-color-scheme: dark)')
  const subscriptions = [
    themePreset, highContrast, largeInteractionTargets, motionPreference,
    activeStudioTheme, themeStudioPreview,
  ].map((store) => store.subscribe(apply))
  media.addEventListener('change', apply)
  apply()
  return () => {
    started = false
    subscriptions.forEach((unsubscribe) => unsubscribe())
    media.removeEventListener('change', apply)
  }
}
