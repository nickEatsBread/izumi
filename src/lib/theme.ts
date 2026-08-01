import { get } from 'svelte/store'
import { highContrast, largeInteractionTargets, motionPreference, themePreset, type ThemePreset } from '$lib/settings/ui'

export interface ThemeTokens {
  scheme: 'dark' | 'light'
  background: string
  foreground: string
  muted: string
  mutedForeground: string
  primary: string
  primaryForeground: string
  secondary: string
  secondaryForeground: string
  accent: string
  accentForeground: string
  border: string
  input: string
  ring: string
  card: string
  cardForeground: string
  theme: string
}

const THEMES: Record<Exclude<ThemePreset, 'system'>, ThemeTokens> = {
  izumi: { scheme: 'dark', background: '240 10% 3.9%', foreground: '0 0% 98%', muted: '240 3.7% 15.9%', mutedForeground: '240 5% 68%', primary: '0 0% 98%', primaryForeground: '240 5.9% 10%', secondary: '240 3.7% 15.9%', secondaryForeground: '0 0% 98%', accent: '240 3.7% 20%', accentForeground: '0 0% 98%', border: '240 3.7% 20%', input: '240 3.7% 15.9%', ring: '346.6 79.12% 58%', card: '240 10% 5.5%', cardForeground: '0 0% 98%', theme: '346.6 79.12% 58%' },
  midnight: { scheme: 'dark', background: '230 30% 5%', foreground: '220 25% 96%', muted: '228 22% 15%', mutedForeground: '222 16% 70%', primary: '220 25% 96%', primaryForeground: '230 30% 8%', secondary: '228 22% 15%', secondaryForeground: '220 25% 96%', accent: '230 25% 23%', accentForeground: '220 25% 98%', border: '228 20% 24%', input: '228 22% 15%', ring: '256 92% 72%', card: '230 28% 7%', cardForeground: '220 25% 96%', theme: '256 92% 72%' },
  sakura: { scheme: 'dark', background: '338 24% 6%', foreground: '345 35% 96%', muted: '337 18% 16%', mutedForeground: '340 14% 72%', primary: '345 35% 96%', primaryForeground: '338 24% 9%', secondary: '337 18% 16%', secondaryForeground: '345 35% 96%', accent: '337 20% 24%', accentForeground: '345 40% 98%', border: '337 18% 25%', input: '337 18% 16%', ring: '335 88% 72%', card: '338 23% 8%', cardForeground: '345 35% 96%', theme: '335 88% 68%' },
  ocean: { scheme: 'dark', background: '205 34% 5%', foreground: '196 30% 96%', muted: '204 25% 15%', mutedForeground: '199 15% 70%', primary: '196 30% 96%', primaryForeground: '205 34% 8%', secondary: '204 25% 15%', secondaryForeground: '196 30% 96%', accent: '202 27% 23%', accentForeground: '196 35% 98%', border: '203 24% 24%', input: '204 25% 15%', ring: '188 86% 50%', card: '205 32% 7%', cardForeground: '196 30% 96%', theme: '188 86% 46%' },
  light: { scheme: 'light', background: '0 0% 98%', foreground: '240 10% 8%', muted: '240 6% 91%', mutedForeground: '240 5% 37%', primary: '240 10% 10%', primaryForeground: '0 0% 98%', secondary: '240 6% 91%', secondaryForeground: '240 10% 10%', accent: '240 6% 86%', accentForeground: '240 10% 8%', border: '240 6% 78%', input: '240 6% 91%', ring: '346.6 79.12% 42%', card: '0 0% 100%', cardForeground: '240 10% 8%', theme: '346.6 79.12% 42%' },
}

export function resolvedThemeTokens(preset: ThemePreset, prefersDark = true): ThemeTokens {
  return THEMES[preset === 'system' ? (prefersDark ? 'izumi' : 'light') : preset]
}

function apply() {
  if (typeof document === 'undefined') return
  const media = matchMedia('(prefers-color-scheme: dark)')
  const tokens = resolvedThemeTokens(get(themePreset), media.matches)
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
  root.style.colorScheme = tokens.scheme
  root.dataset.theme = get(themePreset)
  root.dataset.scheme = tokens.scheme
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
  const subscriptions = [themePreset, highContrast, largeInteractionTargets, motionPreference].map((store) => store.subscribe(apply))
  media.addEventListener('change', apply)
  apply()
  return () => {
    started = false
    subscriptions.forEach((unsubscribe) => unsubscribe())
    media.removeEventListener('change', apply)
  }
}
