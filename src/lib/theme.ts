import { get, writable } from 'svelte/store'
import { highContrast, largeInteractionTargets, motionPreference } from '$lib/settings/ui'
import { themeStudioPreview, type StudioTheme } from '$lib/settings/theme-studio'
import { activePlayerTheme, effectiveStudioTheme, effectiveThemePreset, shownStudioTheme, shownThemePreset } from '$lib/themes/screen-theme'
import { resolvedThemeTokens } from '$lib/theme-tokens'
import { isMobile, isTv } from '$lib/platform'
import { resolvePresentation } from '$lib/themes/presentation'
import { shellNav, themePresentation, tvSurface } from '$lib/themes/runtime'
import { fontStack } from '$lib/themes/font-ids'
import { loadThemeFont } from '$lib/themes/fonts'
import { mirrorFocusSelectors, pinViewportUnits, sanitizeThemeCssCached, themeStyleText } from '$lib/themes/css'
import { gameMode } from '$lib/player/session'
import { setFocusWatches } from '$lib/themes/focus-mirror'
import { protectedSurfaceCount, scopeSupported, themeSafeMode } from '$lib/themes/safe-mode'

export { resolvedThemeTokens, THEME_PRESETS, type ThemeTokens } from '$lib/theme-tokens'

const FONT_STACKS: Record<StudioTheme['font'], string> = {
  nunito: "'Nunito Variable', sans-serif",
  system: "system-ui, -apple-system, 'Segoe UI', sans-serif",
  serif: "Georgia, 'Times New Roman', serif",
  mono: "'Geist Mono', ui-monospace, monospace",
}

const THEME_STYLE_ID = 'izumi-theme-css'
/** Whether a stylesheet follows `style` in <head>. Only one can outrank it, and moving the theme's
 *  stylesheet restyles the whole page (~0.35 s on the Deck's Home): every lazily loaded chunk appends
 *  a modulepreload <link>, which must not cost that. */
export function stylesheetAfter(style: Element): boolean {
  for (let next = style.nextElementSibling; next; next = next.nextElementSibling) {
    if (next instanceof HTMLStyleElement || (next instanceof HTMLLinkElement && next.rel.split(/\s+/).includes('stylesheet'))) return true
  }
  return false
}
/** Code-split routes and dev tooling append their own styles to <head> later; keep the theme's
 *  stylesheet after them so an equally specific theme rule still wins. */
function keepThemeStyleLast(): void {
  const style = document.getElementById(THEME_STYLE_ID)
  if (style && stylesheetAfter(style)) document.head.append(style)
}
/** Whether the active theme's stylesheet is in effect; the Themes page shows rejections. */
export const themeCssStatus = writable<{ state: 'off' | 'applied' | 'rejected'; reason?: string }>({ state: 'off' })
const TOKEN_NAMES = ['background', 'foreground', 'muted', 'muted-foreground', 'primary', 'primary-foreground', 'secondary', 'secondary-foreground', 'accent', 'accent-foreground', 'border', 'input', 'ring', 'card', 'card-foreground', 'theme'] as const

function applyThemeCss(text: string | undefined): void {
  const existing = document.getElementById(THEME_STYLE_ID)
  // Plain rules restyle far faster than `@scope`, so the scoped form that keeps the theme off protected
  // surfaces is only used while one is mounted. Without `@scope` the stylesheet is removed instead.
  const scoped = get(protectedSurfaceCount) > 0
  if (!text || (scoped && !scopeSupported())) {
    existing?.remove()
    if (get(themeCssStatus).state !== 'off') themeCssStatus.set({ state: 'off' })
    return
  }
  const result = sanitizeThemeCssCached(text)
  if (result.error !== undefined) {
    existing?.remove()
    const previous = get(themeCssStatus)
    if (previous.state !== 'rejected' || previous.reason !== result.error) themeCssStatus.set({ state: 'rejected', reason: result.error })
    return
  }
  // Game mode (WebKitGTK with native page zoom): viewport units become host px variables and focus
  // pseudo-classes become the focus mirror's attributes (pinViewportUnits, mirrorFocusSelectors).
  const styled = themeStyleText(result, scoped)
  const mirrored = get(gameMode) ? mirrorFocusSelectors(pinViewportUnits(styled)) : undefined
  setFocusWatches(mirrored?.watches ?? [])
  const content = mirrored?.css ?? styled
  const style = existing ?? Object.assign(document.createElement('style'), { id: THEME_STYLE_ID })
  if (style.textContent !== content) style.textContent = content
  // Last in <head>, so an equally specific theme rule beats the app's own.
  if (!existing || stylesheetAfter(style)) document.head.append(style)
  if (get(themeCssStatus).state !== 'applied') themeCssStatus.set({ state: 'applied' })
}

/** The active theme's stylesheet text, as `apply()` last resolved it. */
let themeCss: string | undefined

/** The px a viewport unit is worth right now, for pinViewportUnits (Game mode only). */
function syncViewportUnits(): void {
  const root = document.documentElement
  if (!get(gameMode)) {
    for (const unit of ['vw', 'vh', 'vmin', 'vmax']) root.style.removeProperty(`--izumi-safe-${unit}`)
    return
  }
  const vw = window.innerWidth / 100
  const vh = window.innerHeight / 100
  root.style.setProperty('--izumi-safe-vw', `${vw}px`)
  root.style.setProperty('--izumi-safe-vh', `${vh}px`)
  root.style.setProperty('--izumi-safe-vmin', `${Math.min(vw, vh)}px`)
  root.style.setProperty('--izumi-safe-vmax', `${Math.max(vw, vh)}px`)
}

function apply() {
  if (typeof document === 'undefined') return
  syncViewportUnits()
  const safe = get(themeSafeMode)
  const media = matchMedia('(prefers-color-scheme: dark)')
  // The player theme while an episode opens or plays, else the active catalog screen's own theme, else the
  // app theme (screen-theme.ts). The player theme only paints: the layout keys below follow the others.
  const preset = get(shownThemePreset)
  const preview = get(themeStudioPreview)
  const studio = preview ?? get(shownStudioTheme)
  const layoutStudio = preview ?? get(effectiveStudioTheme)
  const layoutCustom = !safe && (get(effectiveThemePreset) === 'custom' || preview != null)
  // The open Theme Studio applies drafts live without persisting them until Save. Safe mode
  // overrides both: it always resolves the default izumi palette for the session.
  const tokens = safe
    ? resolvedThemeTokens('izumi', media.matches, null)
    : preview?.tokens ?? resolvedThemeTokens(preset, media.matches, preset === 'custom' ? studio.tokens : null)
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
  const customActive = !safe && (preset === 'custom' || preview != null)
  root.style.setProperty('--radius', customActive ? `${studio.radius}rem` : '0.5rem')
  const fonts = customActive ? studio.fonts : undefined
  root.style.setProperty('--ui-font', fontStack(fonts?.ui) ?? (customActive ? FONT_STACKS[studio.font] : FONT_STACKS.nunito))
  root.style.setProperty('--font-heading', fontStack(fonts?.heading) ?? 'var(--ui-font)')
  root.style.setProperty('--font-display', fontStack(fonts?.display) ?? 'var(--font-heading)')
  for (const id of [fonts?.ui, fonts?.heading, fonts?.display]) void loadThemeFont(id)
  root.style.setProperty('--theme-font-scale', customActive ? String(studio.fontScale) : '1')
  // The brand's rem (app.css --izumi-safe-rem) follows the design's font scale through a reserved copy.
  root.style.setProperty('--izumi-safe-font-scale', customActive ? String(studio.fontScale) : '1')
  // `mobile.rootSize` (API 4): the phone root size. Only app.css's phone media query reads it.
  const rootSize = layoutCustom ? resolvePresentation(layoutStudio.presentation, true)?.rootSize : undefined
  if (rootSize !== undefined) root.style.setProperty('--theme-phone-root', `${rootSize}px`)
  else root.style.removeProperty('--theme-phone-root')
  root.style.setProperty('--theme-backdrop-strength', customActive ? String(studio.backdropStrength) : '0')
  root.style.setProperty('--theme-glass-blur', customActive ? `${studio.glassBlur}px` : '0px')
  root.style.colorScheme = tokens.scheme
  root.dataset.theme = preset
  root.dataset.scheme = tokens.scheme
  root.dataset.themeBackdrop = customActive ? studio.backdrop : 'solid'
  // API 8: a stylesheet acting as the player theme can tell it dresses only the player.
  if (!safe && !preview && get(activePlayerTheme)) root.dataset.themeRole = 'player'
  else delete root.dataset.themeRole
  // Document chrome follows the same phone/TV/shared resolution as the component renderers, with the
  // player theme's player keys while it is in force (runtime.ts).
  const presentation = get(themePresentation)
  // API 6: theme stylesheets scope their TV rules under `:scope[data-surface="tv"]`.
  if (customActive && get(tvSurface) && !get(isMobile)) root.dataset.surface = 'tv'
  else delete root.dataset.surface
  root.dataset.themeDensity = presentation?.density ?? 'comfortable'
  // The rendered placement, which can differ from the theme's shared `shell.nav`: an Android TV's (API 6),
  // and Game mode's drawer when a theme names none. Phones keep the theme's own value.
  root.dataset.themeNav = get(isTv) || !get(isMobile) ? get(shellNav) : presentation?.shell?.nav ?? 'sidebar'
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
  // stylesheets cannot declare it (css-policy.ts), so a stylesheet cannot recolour them.
  for (const name of TOKEN_NAMES) root.style.setProperty(`--izumi-safe-${name}`, root.style.getPropertyValue(`--${name}`))
  root.style.setProperty('--izumi-safe-font', FONT_STACKS.nunito)
  if (presentation?.player?.seekbarHeight) root.style.setProperty('--theme-seekbar-height', `${presentation.player.seekbarHeight}px`)
  else root.style.removeProperty('--theme-seekbar-height')
  if (presentation?.player?.seekbarColor) {
    const color = presentation.player.seekbarColor
    root.style.setProperty('--theme-seekbar-color', color.startsWith('#') || color === 'transparent' ? color : `hsl(var(--${color}))`)
  } else root.style.removeProperty('--theme-seekbar-color')
  // API 9 `player.menu`: the player popups' rows (app.css holds izumi's own 36 and 12 px).
  const menu = presentation?.player?.menu
  if (menu?.rowHeight !== undefined) root.style.setProperty('--theme-player-menu-row-height', `${menu.rowHeight}px`)
  else root.style.removeProperty('--theme-player-menu-row-height')
  if (menu?.rowPadding !== undefined) root.style.setProperty('--theme-player-menu-row-padding', `${menu.rowPadding}px`)
  else root.style.removeProperty('--theme-player-menu-row-padding')
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
  themeCss = customActive ? studio.css : undefined
  applyThemeCss(themeCss)
}

let started = false
export function startThemeSync(): () => void {
  if (started || typeof window === 'undefined') return () => {}
  started = true
  const media = matchMedia('(prefers-color-scheme: dark)')
  const subscriptions = [
    shownThemePreset, highContrast, largeInteractionTargets, motionPreference,
    shownStudioTheme, themeStudioPreview, isMobile, tvSurface, shellNav, themeSafeMode, gameMode, themePresentation, effectiveStudioTheme,
  ].map((store) => store.subscribe(apply))
  // A surface opening or closing changes only the stylesheet's form, never <html>: Game mode's OSD colours
  // watch <html> and open a surface to read them, which would otherwise feed back into themselves.
  subscriptions.push(protectedSurfaceCount.subscribe(() => applyThemeCss(themeCss)))
  media.addEventListener('change', apply)
  // The Deck's page zoom changes the viewport (1:1 under the player), and so what a unit is worth.
  window.addEventListener('resize', syncViewportUnits)
  apply()
  const headObserver = new MutationObserver(keepThemeStyleLast)
  headObserver.observe(document.head, { childList: true })
  return () => {
    started = false
    subscriptions.forEach((unsubscribe) => unsubscribe())
    media.removeEventListener('change', apply)
    window.removeEventListener('resize', syncViewportUnits)
    headObserver.disconnect()
  }
}
