import { invoke } from '@tauri-apps/api/core'
import { persisted } from 'svelte-persisted-store'
import { writable, get } from 'svelte/store'
import { NO_SUBTITLE_ADJUSTMENTS, type SubtitleAdjustments, type SubtitleStyle } from '$lib/player/subtitle-style'
import {
  subtitleStyleEnabled, subtitleOverrideScope, subtitleFont, subtitleBold, subtitleFontSize, subtitleTextColor,
  subtitleBorderColor, subtitleBorderSize, subtitleShadow, subtitlePosition, subtitleAssSnapshot,
} from './ui'

// Saved subtitle "fonting" presets — a release's captured ASS typesetting (or any style snapshot)
// that can be replayed later: per playback session from the player, or globally from Settings →
// Subtitles by copying it into the persisted style stores the existing override already reads.

export interface SubtitleStylePreset {
  id: string
  name: string
  style: Omit<SubtitleStyle, 'enabled'>
  savedAt: number
  /** Where the capture came from, for display: release group and/or anime title. */
  source?: { group?: string; title?: string }
}

export const savedSubtitleStyles = persisted<SubtitleStylePreset[]>('saved-subtitle-styles', [])

/** The session-only override picked in the player. Never persisted — closing the player (or the
 *  app) returns styling to the user's normal settings. */
export const sessionSubtitleStyle = writable<SubtitleStylePreset | null>(null)

/** Position and size set in the player (the position editor and "Subtitle size"). Session-only like
 *  the preset above: they last across episodes until the player closes, and never reach Settings. */
export const sessionSubtitleAdjustments = writable<SubtitleAdjustments>(NO_SUBTITLE_ADJUSTMENTS)

/** End of a player session: drop everything the player changed for it. */
export function resetSubtitleSession(): void {
  sessionSubtitleStyle.set(null)
  sessionSubtitleAdjustments.set(NO_SUBTITLE_ADJUSTMENTS)
}

const newId = () =>
  (globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`)

/** Name a captured style after its release/fansub author; the anime title is deliberately only a
 * fallback for streams whose torrent/release metadata carries no identifiable author. */
export function subtitlePresetSourceName(source?: SubtitleStylePreset['source']): string {
  return source?.group?.trim() || source?.title?.trim() || 'Saved style'
}

/** Save (or overwrite — names are unique, trimmed and case-insensitive) a preset. */
export function saveSubtitlePreset(
  name: string,
  style: Omit<SubtitleStyle, 'enabled'>,
  source?: SubtitleStylePreset['source'],
): SubtitleStylePreset {
  const trimmed = name.trim() || 'Saved style'
  const existing = get(savedSubtitleStyles).find((p) => p.name.trim().toLowerCase() === trimmed.toLowerCase())
  const preset: SubtitleStylePreset = {
    id: existing?.id ?? newId(),
    name: trimmed,
    style,
    savedAt: Date.now(),
    source: source ?? existing?.source,
  }
  savedSubtitleStyles.update((list) =>
    existing ? list.map((p) => (p.id === existing.id ? preset : p)) : [...list, preset])
  return preset
}

/** Every font a style asks libass for: its own face plus each face its captured ASS styles name. */
export function subtitleStyleFonts(style: Omit<SubtitleStyle, 'enabled'>): string[] {
  const snapshot = (style.assSnapshot?.styles ?? [])
    .flatMap((s) => s.fields.filter(([field]) => field === 'FontName').map(([, value]) => value))
  return [...new Set([style.font, ...snapshot].map((font) => font.trim()).filter(Boolean))]
}

/** Keep the fonts a just-saved style takes from the playing file's attachments (`source` = mpv's
 *  `path`), so the style still renders where that file's fonts are not loaded. A preset only stores
 *  font names; a release-attached font missing from the system silently fell back to another face.
 *  Resolves to the families now kept; system fonts are never attached, so they are not in it. */
export async function saveSubtitleStyleFonts(source: string | null | undefined, style: Omit<SubtitleStyle, 'enabled'>): Promise<string[]> {
  if (!source) return []
  return invoke<string[]>('subtitle_fonts_save', { source, families: subtitleStyleFonts(style) })
    .catch((error) => {
      console.warn('subtitle fonts not saved', error)
      return []
    })
}

export function deleteSubtitlePreset(id: string): void {
  savedSubtitleStyles.update((list) => list.filter((p) => p.id !== id))
  if (get(sessionSubtitleStyle)?.id === id) sessionSubtitleStyle.set(null)
}

/** Make a preset the client-wide style: write the persisted stores the existing custom-style
 *  feature reads and switch the override on. From here the settings sliders edit it as usual. */
export function applyPresetGlobally(preset: SubtitleStylePreset): void {
  subtitleOverrideScope.set(preset.style.scope ?? 'dialogue')
  subtitleFont.set(preset.style.font)
  subtitleBold.set(preset.style.bold ?? false)
  subtitleFontSize.set(preset.style.fontSize)
  subtitleTextColor.set(preset.style.textColor)
  subtitleBorderColor.set(preset.style.borderColor)
  subtitleBorderSize.set(preset.style.borderSize)
  subtitleShadow.set(preset.style.shadow)
  subtitlePosition.set(preset.style.position)
  subtitleAssSnapshot.set(preset.style.assSnapshot ?? null)
  subtitleStyleEnabled.set(true)
}

/** What the player should push to mpv: the session preset (override implicitly on) when one is
 *  picked, otherwise the user's settings exactly as they are. */
export function effectiveSubtitleStyle(session: SubtitleStylePreset | null, globals: SubtitleStyle): SubtitleStyle {
  return session ? {
    ...globals,
    ...session.style,
    enabled: true,
    scope: session.style.scope ?? globals.scope,
    bold: session.style.bold ?? globals.bold,
  } : globals
}
