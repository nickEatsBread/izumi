import { get, writable } from 'svelte/store'
import { highContrast, largeInteractionTargets, motionPreference, themePreset } from '$lib/settings/ui'
import { activeStudioTheme, themeStudioPreview, type StudioTheme } from '$lib/settings/theme-studio'
import { resolvedThemeTokens } from '$lib/theme-tokens'
import { isMobile } from '$lib/platform'
import { resolvePresentation } from '$lib/themes/presentation'
import { fontStack } from '$lib/themes/font-ids'
import { loadThemeFont } from '$lib/themes/fonts'
import { sanitizeThemeCssCached, themeStyleText } from '$lib/themes/css'
import { protectedSurfaceCount, scopeSupported, themeSafeMode } from '$lib/themes/safe-mode'

export { resolvedThemeTokens, THEME_PRESETS, type ThemeTokens } from '$lib/theme-tokens'

const FONT_STACKS: Record<StudioTheme['font'], string> = {
  nunito: "'Nunito Variable', sans-serif",
  system: "system-ui, -apple-system, 'Segoe UI', sans-serif",
  serif: "Georgia, 'Times New Roman', serif",
  mono: "'Geist Mono', ui-monospace, monospace",
}

const THEME_STYLE_ID = 'izumi-theme-css'
/** Whether the active theme's stylesheet is in effect; the Themes page shows rejections. */
export const themeCssStatus = writable<{ state: 'off' | 'applied' | 'rejected'; reason?: string }>({ state: 'off' })
const TOKEN_NAMES = ['background', 'foreground', 'muted', 'muted-foreground', 'primary', 'primary-foreground', 'secondary', 'secondary-foreground', 'accent', 'accent-foreground', 'border', 'input', 'ring', 'card', 'card-foreground', 'theme'] as const

function applyThemeCss(text: string | undefined): void {
  const existing = document.getElementById(THEME_STYLE_ID)
  const scoped = scopeSupported()
  if (!text || (!scoped && get(protectedSurfaceCount) > 0)) {
    existing?.remove()
    if (get(themeCssStatus).state !== 'off') themeCssStatus.set({ state: 'off' })
    return
  }
  const result = sanitizeThemeCssCached(text)
  if (result.error !== undefined) {
    existing?.remove()
    themeCssStatus.set({ state: 'rejected', reason: result.error })
    return
  }
  const content = themeStyleText(result, scoped)
  const style = existing ?? Object.assign(document.createElement('style'), { id: THEME_STYLE_ID })
  if (style.textContent !== content) style.textContent = content
  // Last in <head>, so an equally specific theme rule beats the app's own.
  if (!existing || style !== document.head.lastElementChild) document.head.append(style)
  if (get(themeCssStatus).state !== 'applied') themeCssStatus.set({ state: 'applied' })
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
  const fonts = customActive ? studio.fonts : undefined
  root.style.setProperty('--ui-font', fontStack(fonts?.ui) ?? (customActive ? FONT_STACKS[studio.font] : FONT_STACKS.nunito))
  root.style.setProperty('--font-heading', fontStack(fonts?.heading) ?? 'var(--ui-font)')
  root.style.setProperty('--font-display', fontStack(fonts?.display) ?? 'var(--font-heading)')
  for (const id of [fonts?.ui, fonts?.heading, fonts?.display]) void loadThemeFont(id)
  root.style.setProperty('--theme-font-scale', customActive ? String(studio.fontScale) : '1')
  root.style.setProperty('--theme-backdrop-strength', customActive ? String(studio.backdropStrength) : '0')
  root.style.setProperty('--theme-glass-blur', customActive ? `${studio.glassBlur}px` : '0px')
  root.style.colorScheme = tokens.scheme
  root.dataset.theme = preset
  root.dataset.scheme = tokens.scheme
  root.dataset.themeBackdrop = customActive ? studio.backdrop : 'solid'
  // Document chrome follows the same phone/shared resolution as the component renderers.
  const presentation = customActive ? resolvePresentation(studio.presentation, get(isMobile)) : undefined
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
  // Client-owned copy of the final palette. Protected surfaces read it (app.css) and theme
  // stylesheets cannot declare it (css-policy.ts), so a stylesheet can never blank them out.
  for (const name of TOKEN_NAMES) root.style.setProperty(`--izumi-safe-${name}`, root.style.getPropertyValue(`--${name}`))
  root.style.setProperty('--izumi-safe-font', FONT_STACKS.nunito)
  if (presentation?.player?.seekbarHeight) root.style.setProperty('--theme-seekbar-height', `${presentation.player.seekbarHeight}px`)
  else root.style.removeProperty('--theme-seekbar-height')
  if (presentation?.player?.seekbarColor) {
    const color = presentation.player.seekbarColor
    root.style.setProperty('--theme-seekbar-color', color.startsWith('#') || color === 'transparent' ? color : `hsl(var(--${color}))`)
  } else root.style.removeProperty('--theme-seekbar-color')
  // The page keeps its bottom margin clear of the tab bar; a taller or floating bar needs more.
  const bottomNav = presentation?.shell?.bottomNav
  if (bottomNav) {
    const height = bottomNav.height ?? 56
    const clearance = bottomNav.style === 'pill' ? 32 : bottomNav.style === 'floating' ? 24 : 8
    root.style.setProperty('--theme-bottom-nav', `${height + clearance}px`)
  } else root.style.removeProperty('--theme-bottom-nav')
  root.classList.toggle('a11y-high-contrast', get(highContrast))
  root.classList.toggle('a11y-large-targets', get(largeInteractionTargets))
  root.classList.toggle('a11y-reduce-motion', get(motionPreference) === 'reduce')
  root.classList.toggle('a11y-full-motion', get(motionPreference) === 'full')
  applyThemeCss(customActive && !get(themeSafeMode) ? studio.css : undefined)
}

let started = false
export function startThemeSync(): () => void {
  if (started || typeof window === 'undefined') return () => {}
  started = true
  const media = matchMedia('(prefers-color-scheme: dark)')
  const subscriptions = [
    themePreset, highContrast, largeInteractionTargets, motionPreference,
    activeStudioTheme, themeStudioPreview, isMobile, themeSafeMode, protectedSurfaceCount,
  ].map((store) => store.subscribe(apply))
  media.addEventListener('change', apply)
  apply()
  return () => {
    started = false
    subscriptions.forEach((unsubscribe) => unsubscribe())
    media.removeEventListener('change', apply)
  }
}
