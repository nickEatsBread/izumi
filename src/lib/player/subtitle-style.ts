import type { SubtitleOverrideScope } from '$lib/settings/ui'

// The user's subtitle appearance, expressed as mpv properties. Shared by BOTH players: the desktop
// overlay (player_command → the embedded libmpv core) and the Android overlay (plugin:mpv|mpv_command
// → the embedded libmpv core in the Kotlin plugin). Android used to apply none of this — the settings
// page wrote to localStorage and nothing ever read it there.

/** mpv's own default subtitle font on desktop; also the font izumi ships to Android (see the plugin's
 *  bundled `sub-fonts-dir`). Used when the setting has been cleared to an empty string. */
export const DEFAULT_SUBTITLE_FONT = 'Nunito'

export interface SubtitleStyle {
  enabled: boolean
  scope: SubtitleOverrideScope
  font: string
  bold: boolean
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

/** CSS RGB → libass AABBGGRR. ASS style overrides do not accept mpv's colour syntax. */
export function assColor(hex: string): string {
  const rgb = /^#?([0-9a-fA-F]{6})$/.exec(hex.trim())
  if (!rgb) return '&H00FFFFFF&'
  const [r, g, b] = [rgb[1].slice(0, 2), rgb[1].slice(2, 4), rgb[1].slice(4, 6)]
  return `&H00${b}${g}${r}&`.toUpperCase()
}

const safeAssFont = (font: string): string =>
  (font.trim() || DEFAULT_SUBTITLE_FONT).replace(/[,=]/g, ' ')

const dialogueMargin = (position: number): number =>
  Math.round(Math.max(0, Math.min(100, 100 - position)) * 7.2)

/**
 * `set <property> <value>` pairs for the current appearance settings.
 *
 * With the override off the custom ASS override list is cleared and `sub-ass-override=no` hands
 * styling back to the subtitle file. The normal text properties are deliberately left alone;
 * they are ignored by ASS in this mode and a fresh player core restores plain-text defaults.
 */
export function subtitleStyleProps(style: SubtitleStyle): [string, string][] {
  if (!style.enabled) return [
    ['sub-ass-style-overrides', ''],
    ['sub-ass-override', 'no'],
  ]

  const font = safeAssFont(style.font)
  const normal: [string, string][] = [
    ['sub-font', font],
    ['sub-bold', style.bold ? 'yes' : 'no'],
    ['sub-font-size', String(style.fontSize)],
    ['sub-color', mpvColor(style.textColor)],
    ['sub-border-color', mpvColor(style.borderColor)],
    ['sub-border-size', String(style.borderSize)],
    ['sub-shadow-offset', String(style.shadow)],
  ]

  if (style.scope === 'all') return [
    ['sub-ass-style-overrides', ''],
    ['sub-ass-override', 'force'],
    ...normal,
    ['sub-pos', String(style.position)],
  ]

  // mpv's `yes` mode asks libass to apply these as user preferences while retaining its
  // best-effort sign/song detection. `force` is intentionally reserved for the explicit
  // all-elements option below because it can flatten positioned typesetting.
  const assOverrides = [
    `FontName=${font}`,
    `FontSize=${style.fontSize}`,
    `PrimaryColour=${assColor(style.textColor)}`,
    `OutlineColour=${assColor(style.borderColor)}`,
    `Bold=${style.bold ? -1 : 0}`,
    'BorderStyle=1',
    `Outline=${style.borderSize}`,
    `Shadow=${style.shadow}`,
    'Alignment=2',
    `MarginV=${dialogueMargin(style.position)}`,
  ].join(',')
  return [
    ['sub-ass-style-overrides', assOverrides],
    ['sub-ass-override', 'yes'],
    ...normal,
    // Dialogue positioning is carried by MarginV above. Reset a previous forced `sub-pos` so it
    // cannot continue moving signs after the user switches back to the safer scope.
    ['sub-pos', '100'],
  ]
}
