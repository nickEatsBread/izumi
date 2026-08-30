import type { SubtitleOverrideScope } from '$lib/settings/ui'

// The user's subtitle appearance, expressed as mpv properties. Shared by BOTH players: the desktop
// overlay (player_command → the embedded libmpv core) and the Android overlay (plugin:mpv|mpv_command
// → the embedded libmpv core in the Kotlin plugin). Android used to apply none of this — the settings
// page wrote to localStorage and nothing ever read it there.

/** mpv's own default subtitle font on desktop; also the font izumi ships to Android (see the plugin's
 *  bundled `sub-fonts-dir`). Used when the setting has been cleared to an empty string. */
export const DEFAULT_SUBTITLE_FONT = 'Nunito'

export interface SubtitleStyleAppearance {
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
 * Lossless ASS data captured from a subtitle track. The normal appearance fields above are a
 * convenient 720-line approximation for the settings UI; replaying those rounded values inside
 * the source script's own coordinate system is not lossless. Keep the original script/style
 * values so saving a release style is visually a no-op and later episodes from that release can
 * receive the same complete style table.
 */
export interface SubtitleAssStyleSnapshot {
  reference: SubtitleStyleAppearance
  scriptInfo: [field: string, value: string][]
  styles: { name: string; fields: [field: string, value: string][] }[]
}

export interface SubtitleStyle extends SubtitleStyleAppearance {
  enabled: boolean
  assSnapshot?: SubtitleAssStyleSnapshot
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

const ASS_SCRIPT_NUMBER_FIELDS = new Set(['PlayResX', 'PlayResY', 'LayoutResX', 'LayoutResY', 'WrapStyle'])
const ASS_SCRIPT_BOOL_FIELDS = new Set(['ScaledBorderAndShadow', 'Kerning'])
const ASS_STYLE_NUMBER_FIELDS = new Set([
  'FontSize', 'Bold', 'Italic', 'Underline', 'StrikeOut', 'ScaleX', 'ScaleY', 'Spacing', 'Angle',
  'BorderStyle', 'Outline', 'Shadow', 'Alignment', 'Justify', 'MarginL', 'MarginR', 'MarginV',
  'Encoding', 'AlphaLevel', 'Blur',
])
const ASS_STYLE_COLOR_FIELDS = new Set(['PrimaryColour', 'SecondaryColour', 'OutlineColour', 'BackColour'])
const ASS_YCBCR_VALUES = new Set([
  'none', 'tv.601', 'pc.601', 'tv.709', 'pc.709', 'tv.240m', 'pc.240m', 'tv.fcc', 'pc.fcc',
])
const ASS_NUMBER = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/
const ASS_COLOR = /^(?:&H[0-9a-f]{1,8}&?|[+-]?\d+)$/i

function safeAssScriptOverride(field: string, value: string): string | null {
  const clean = value.trim()
  if (ASS_SCRIPT_NUMBER_FIELDS.has(field) && ASS_NUMBER.test(clean)) return `${field}=${clean}`
  if (ASS_SCRIPT_BOOL_FIELDS.has(field) && /^(?:yes|no|true|false|[+-]?\d+)$/i.test(clean)) {
    return `${field}=${clean}`
  }
  if (field === 'YCbCr Matrix' && ASS_YCBCR_VALUES.has(clean.toLowerCase())) return `${field}=${clean}`
  return null
}

function safeAssStyleOverride(styleName: string, field: string, value: string): string | null {
  // mpv receives this as a comma-separated string list and libass splits at the last '='.
  // Reject separators even for a locally persisted snapshot: subtitle headers are untrusted input.
  const name = styleName.trim()
  const clean = value.trim()
  if (!name || /[,=\r\n]/.test(name)) return null
  if (field === 'FontName') {
    return clean && !/[,=\r\n]/.test(clean) ? `${name}.${field}=${clean}` : null
  }
  if (ASS_STYLE_NUMBER_FIELDS.has(field) && ASS_NUMBER.test(clean)) return `${name}.${field}=${clean}`
  if (ASS_STYLE_COLOR_FIELDS.has(field) && ASS_COLOR.test(clean)) return `${name}.${field}=${clean}`
  return null
}

function snapshotMatchesAppearance(style: SubtitleStyle, snapshot: SubtitleAssStyleSnapshot): boolean {
  const reference = snapshot.reference
  return style.scope === reference.scope
    && style.font === reference.font
    && style.bold === reference.bold
    && Number(style.fontSize) === Number(reference.fontSize)
    && style.textColor.toLowerCase() === reference.textColor.toLowerCase()
    && style.borderColor.toLowerCase() === reference.borderColor.toLowerCase()
    && Number(style.borderSize) === Number(reference.borderSize)
    && Number(style.shadow) === Number(reference.shadow)
    && Number(style.position) === Number(reference.position)
}

function exactAssOverrides(snapshot: SubtitleAssStyleSnapshot): string[] {
  const script = snapshot.scriptInfo
    .map(([field, value]) => safeAssScriptOverride(field, value))
    .filter((value): value is string => value !== null)
  const styles = snapshot.styles.flatMap((style) => style.fields
    .map(([field, value]) => safeAssStyleOverride(style.name, field, value))
    .filter((value): value is string => value !== null))
  return [...script, ...styles]
}

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

  const exact = style.assSnapshot && snapshotMatchesAppearance(style, style.assSnapshot)
    ? exactAssOverrides(style.assSnapshot)
    : []
  if (exact.length) return [
    ['sub-ass-style-overrides', exact.join(',')],
    ['sub-ass-override', 'yes'],
    ...normal,
    ['sub-pos', '100'],
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
