// The user's subtitle appearance, expressed as mpv properties. Shared by BOTH players: the desktop
// overlay (player_command → the embedded libmpv core) and the Android overlay (plugin:mpv|mpv_command
// → the embedded libmpv core in the Kotlin plugin). Android used to apply none of this — the settings
// page wrote to localStorage and nothing ever read it there.

/** mpv's own default subtitle font on desktop; also the font izumi ships to Android (see the plugin's
 *  bundled `sub-fonts-dir`). Used when the setting has been cleared to an empty string. */
export const DEFAULT_SUBTITLE_FONT = 'Nunito'

export interface SubtitleStyle {
  enabled: boolean
  font: string
  fontSize: number
  /** `#rrggbb`, as produced by `<input type="color">`. */
  textColor: string
  borderColor: string
  borderSize: number
  shadow: number
  /** mpv `sub-pos`: 0 is the top of the frame, 100 the bottom. */
  position: number
}

/**
 * mpv wants `#AARRGGBB` — **alpha first**. Appending the alpha instead shifts every channel one byte
 * along, so `#000000` + `ff` became `#000000ff`, i.e. alpha 00 (fully transparent) over blue: the
 * default black outline silently disappeared and picked colours came out as a different hue.
 */
export function mpvColor(hex: string, alpha = 'ff'): string {
  const rgb = /^#?([0-9a-fA-F]{6})$/.exec(hex.trim())
  if (!rgb) return `#${alpha}ffffff`
  return `#${alpha}${rgb[1].toLowerCase()}`
}

/**
 * `set <property> <value>` pairs for the current appearance settings.
 *
 * With the override off this is only `sub-ass-override=no`, which hands styling back to the
 * subtitle file (embedded ASS keeps its typesetting) — the other properties are deliberately left
 * as mpv found them rather than being reset to izumi's values.
 */
export function subtitleStyleProps(style: SubtitleStyle): [string, string][] {
  if (!style.enabled) return [['sub-ass-override', 'no']]
  return [
    // `force` is what makes these apply to ASS/SSA tracks too; without it they would only affect
    // plain-text (SRT) subtitles, which is most of what "it doesn't work" looked like.
    ['sub-ass-override', 'force'],
    ['sub-font', style.font.trim() || DEFAULT_SUBTITLE_FONT],
    ['sub-font-size', String(style.fontSize)],
    ['sub-color', mpvColor(style.textColor)],
    ['sub-border-color', mpvColor(style.borderColor)],
    ['sub-border-size', String(style.borderSize)],
    ['sub-shadow-offset', String(style.shadow)],
    ['sub-pos', String(style.position)],
  ]
}
