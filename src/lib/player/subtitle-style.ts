import type { SubtitleOverrideScope } from '$lib/settings/ui'
import { authoredDialogueBottom, dialogueStyles, parseAssStyles, type ParsedAssHeader } from './ass-style-capture'

// The user's subtitle appearance, expressed as mpv properties. Shared by BOTH players: the desktop
// overlay (player_command → the embedded libmpv core) and the Android overlay (plugin:mpv|mpv_command
// → the embedded libmpv core in the Kotlin plugin). Android used to apply none of this — the settings
// page wrote to localStorage and nothing ever read it there.
//
// Units matter here. The settings (and mpv's own sub-* options) describe a 720-line frame, while an
// ASS script measures its styles in its own PlayResY (288, 360, 1080, …). Values written into a
// script's styles must be converted into that script's units, and one script's resolution must
// never be forced onto another: both made the same style render at a third or three times its size.

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

/** A captured style table replays exactly only onto the script it was captured from (a later episode
 *  of the same release): same resolution, and every style that script declares is in the table.
 *  Replaying it anywhere else forced the capture's PlayResX/PlayResY onto a foreign script, which
 *  rescaled all of that script's other styles and pushed its positioned signs off screen. */
function snapshotFitsScript(snapshot: SubtitleAssStyleSnapshot, header: ParsedAssHeader): boolean {
  const info = new Map(snapshot.scriptInfo)
  const playResY = Number(info.get('PlayResY')) || 288
  if (Math.abs(playResY - header.playResY) > 0.5) return false
  const playResX = Number(info.get('PlayResX'))
  const targetX = Number(new Map(header.scriptInfo).get('PlayResX'))
  if (playResX && targetX && Math.abs(playResX - targetX) > 0.5) return false
  const captured = new Set(snapshot.styles.map((style) => style.name.trim().toLowerCase()))
  return header.styles.every((style) => captured.has(style.name.trim().toLowerCase()))
}

const formatNumber = (value: number) => String(Math.round(value * 100) / 100)

/** The appearance applied to the script's dialogue styles only, in the script's own coordinates.
 *  Each style keeps its alignment and margins, so lines raised to the top stay there, and sign,
 *  song and title styles keep the release's typesetting. */
function dialogueOverrides(style: SubtitleStyle, header: ParsedAssHeader): string[] {
  const toScript = (value: number) => formatNumber((Number(value) * header.playResY) / 720)
  const fields: [string, string][] = [
    ['FontName', safeAssFont(style.font)],
    ['FontSize', toScript(style.fontSize)],
    ['PrimaryColour', assColor(style.textColor)],
    ['OutlineColour', assColor(style.borderColor)],
    ['Bold', style.bold ? '1' : '0'],
    ['BorderStyle', '1'],
    ['Outline', toScript(style.borderSize)],
    ['Shadow', toScript(style.shadow)],
  ]
  return dialogueStyles(header.styles).flatMap((dialogue) => fields
    .map(([field, value]) => safeAssStyleOverride(dialogue.name, field, value))
    .filter((value): value is string => value !== null))
}

/** The subtitle track mpv is showing. ASS and SSA scripts are styled by their own header; any other
 *  format (SRT, WebVTT, …) is converted text that mpv styles entirely with its sub-* options. */
export interface SubtitleTrack {
  ass: boolean
  header: ParsedAssHeader | null
}

export const TEXT_TRACK: SubtitleTrack = { ass: false, header: null }

/** Build a SubtitleTrack from mpv's `track-list` (JSON) and `sub-ass-extradata`. */
export function subtitleTrackFrom(trackList: string | null | undefined, extradata: string | null | undefined): SubtitleTrack {
  let selected: { codec?: string } | undefined
  try {
    const tracks = JSON.parse(trackList ?? '[]') as { type?: string; selected?: boolean; codec?: string }[]
    selected = Array.isArray(tracks) ? tracks.find((track) => track.type === 'sub' && track.selected) : undefined
  } catch {
    selected = undefined
  }
  const ass = /^(ass|ssa)$/i.test(selected?.codec ?? '')
  return { ass, header: ass ? parseAssStyles(extradata ?? '') : null }
}

/** Adjustments made in the player for the current session only (never persisted). */
export interface SubtitleAdjustments {
  /** Where the bottom of dialogue lines sits, in % of the frame height (0 top … 100 bottom).
   *  null keeps the position the subtitles themselves give. */
  position: number | null
  /** Size multiplier for dialogue (mpv `sub-scale`). */
  scale: number
}

export const NO_SUBTITLE_ADJUSTMENTS: SubtitleAdjustments = { position: null, scale: 1 }

/** mpv's built-in values for the text-subtitle properties this module writes, used to put them
 *  back when a style is switched off. Prefer {@link readSubtitleDefaults}: the running build knows
 *  its own defaults, and they have changed between mpv versions. */
export const MPV_SUBTITLE_DEFAULTS: Readonly<Record<string, string>> = {
  'sub-font': 'sans-serif',
  'sub-bold': 'no',
  'sub-font-size': '38',
  'sub-color': '#FFFFFFFF',
  'sub-border-color': '#FF000000',
  'sub-border-size': '1.65',
  'sub-shadow-offset': '0',
  'sub-margin-y': '34',
}

const TEXT_STYLE_PROPERTIES = [
  'sub-font', 'sub-bold', 'sub-font-size', 'sub-color', 'sub-border-color', 'sub-border-size', 'sub-shadow-offset',
] as const

/** Ask the running mpv for its defaults (`option-info/<name>/default-value`). */
export async function readSubtitleDefaults(get: (name: string) => Promise<string>): Promise<Record<string, string>> {
  const read = async (name: string) => {
    const value = await get(`option-info/${name}/default-value`).catch(() => '')
    return value && value !== 'null' ? String(value) : ''
  }
  const entries = await Promise.all(Object.entries(MPV_SUBTITLE_DEFAULTS).map(async ([property, fallback]) => {
    // `sub-border-size` is an alias of `sub-outline-size` in current mpv.
    const value = property === 'sub-border-size'
      ? (await read('sub-outline-size')) || (await read(property))
      : await read(property)
    return [property, value || fallback] as const
  }))
  return Object.fromEntries(entries)
}

/** Where text subtitles end by default: mpv places them `sub-margin-y` (720-line units) above the bottom. */
const textBottom = (defaults: Readonly<Record<string, string>>) =>
  100 - ((Number(defaults['sub-margin-y']) || 34) * 100) / 720

/** mpv's `sub-pos` moves a bottom-aligned line proportionally towards the top of the frame: at
 *  `sub-pos` S its bottom edge lands at authoredBottom × S / 100 (measured on real releases). Invert
 *  that, so a position means where the bottom edge of the line actually ends up. */
function subPos(position: number | null | undefined, authoredBottom: number): string {
  if (position == null || !Number.isFinite(position) || !(authoredBottom > 0)) return '100'
  return formatNumber(Math.min(150, Math.max(0, (Number(position) * 100) / authoredBottom)))
}

/** Where the bottom of dialogue ends up (in % of the frame height) for this style, track and
 *  adjustments — the same placement {@link subtitleStyleProps} produces. */
export function dialogueBottom(
  style: SubtitleStyle,
  track: SubtitleTrack = TEXT_TRACK,
  adjustments: SubtitleAdjustments = NO_SUBTITLE_ADJUSTMENTS,
  defaults: Readonly<Record<string, string>> = MPV_SUBTITLE_DEFAULTS,
): number {
  if (adjustments.position != null && Number.isFinite(adjustments.position)) return adjustments.position
  const header = track.ass ? track.header : null
  const authored = (header && authoredDialogueBottom(header)) ?? textBottom(defaults)
  if (!style.enabled) return authored
  if (style.scope === 'all') return style.position
  const snapshot = style.assSnapshot
  const exact = header && snapshot && snapshotMatchesAppearance(style, snapshot) && snapshotFitsScript(snapshot, header)
  return exact ? authored : style.position
}

/**
 * `set <property> <value>` pairs for the current appearance, the selected track and the session's
 * player adjustments. Always the complete set: a style switched off restores mpv's own values for
 * everything a style can change, so nothing from an earlier style leaks into the next track, file
 * or player session (Windows and macOS reuse the mpv core).
 */
export function subtitleStyleProps(
  style: SubtitleStyle,
  track: SubtitleTrack = TEXT_TRACK,
  adjustments: SubtitleAdjustments = NO_SUBTITLE_ADJUSTMENTS,
  defaults: Readonly<Record<string, string>> = MPV_SUBTITLE_DEFAULTS,
): [string, string][] {
  const header = track.ass ? track.header : null
  const scale = Number.isFinite(adjustments.scale) && adjustments.scale > 0 ? adjustments.scale : 1
  const text: [string, string][] = style.enabled
    ? [
        ['sub-font', safeAssFont(style.font)],
        ['sub-bold', style.bold ? 'yes' : 'no'],
        ['sub-font-size', String(style.fontSize)],
        ['sub-color', mpvColor(style.textColor)],
        ['sub-border-color', mpvColor(style.borderColor)],
        ['sub-border-size', String(style.borderSize)],
        ['sub-shadow-offset', String(style.shadow)],
      ]
    : TEXT_STYLE_PROPERTIES.map((property) => [property, defaults[property] ?? MPV_SUBTITLE_DEFAULTS[property]])
  const scriptBottom = (header && authoredDialogueBottom(header)) ?? textBottom(defaults)

  if (!style.enabled) {
    const adjusted = adjustments.position != null || scale !== 1
    return [
      ['sub-ass-style-overrides', ''],
      // `no` renders a script exactly as authored but ignores sub-pos and sub-scale. `scale` with an
      // empty override list renders the same script and lets the player's position and size through.
      ['sub-ass-override', adjusted ? 'scale' : 'no'],
      ...text,
      ['sub-scale', formatNumber(scale)],
      ['sub-pos', subPos(adjustments.position, scriptBottom)],
    ]
  }

  if (style.scope === 'all') return [
    ['sub-ass-style-overrides', ''],
    // mpv restyles every line from the 720-line sub-* values (resolution independent) and positions it
    // with its own text margin.
    ['sub-ass-override', 'force'],
    ...text,
    ['sub-scale', formatNumber(scale)],
    ['sub-pos', subPos(adjustments.position ?? style.position, textBottom(defaults))],
  ]

  const snapshot = style.assSnapshot
  const exact = header && snapshot && snapshotMatchesAppearance(style, snapshot) && snapshotFitsScript(snapshot, header)
    ? exactAssOverrides(snapshot)
    : null
  return [
    ['sub-ass-style-overrides', (exact ?? (header ? dialogueOverrides(style, header) : [])).join(',')],
    // `scale`: apply the override list (like `yes`) and honour the player's size control.
    ['sub-ass-override', 'scale'],
    ...text,
    ['sub-scale', formatNumber(scale)],
    // An exact replay carries the release's own margins; otherwise place dialogue where the style says.
    ['sub-pos', subPos(exact ? adjustments.position : (adjustments.position ?? style.position), scriptBottom)],
  ]
}
