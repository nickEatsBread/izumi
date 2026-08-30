import type { SubtitleStyle, SubtitleStyleAppearance } from './subtitle-style'

// Turns mpv's `sub-ass-extradata` (the ASS header of the active subtitle track — Script Info +
// [V4+ Styles]) into the app's SubtitleStyle shape, so a release's typesetting can be saved as a
// preset and replayed through the existing sub-* override pipe. Pure string work, no mpv here.

export interface AssStyle {
  name: string
  fontname: string
  fontsize: number
  /** Raw ASS colour, e.g. `&H00FFFFFF` (AABBGGRR — alpha first, then BLUE-GREEN-RED). */
  primaryColour: string
  outlineColour: string
  bold: boolean
  outline: number
  shadow: number
  alignment: number
  marginV: number
  /** Effective values accepted by libass's post-parse force-style API. */
  fields: [field: string, value: string][]
}

/** libass falls back to 288 when a script omits PlayResY. */
const DEFAULT_PLAY_RES_Y = 288

const num = (v: string | undefined, fallback = 0): number => {
  const n = parseFloat(v ?? '')
  return Number.isFinite(n) ? n : fallback
}

const SCRIPT_FIELDS: Record<string, string> = {
  playresx: 'PlayResX',
  playresy: 'PlayResY',
  layoutresx: 'LayoutResX',
  layoutresy: 'LayoutResY',
  wrapstyle: 'WrapStyle',
  scaledborderandshadow: 'ScaledBorderAndShadow',
  kerning: 'Kerning',
  'ycbcr matrix': 'YCbCr Matrix',
}

const STYLE_FIELDS: Record<string, string> = {
  fontname: 'FontName',
  fontsize: 'FontSize',
  primarycolour: 'PrimaryColour',
  secondarycolour: 'SecondaryColour',
  outlinecolour: 'OutlineColour',
  tertiarycolour: 'OutlineColour',
  backcolour: 'BackColour',
  bold: 'Bold',
  italic: 'Italic',
  underline: 'Underline',
  strikeout: 'StrikeOut',
  scalex: 'ScaleX',
  scaley: 'ScaleY',
  spacing: 'Spacing',
  angle: 'Angle',
  borderstyle: 'BorderStyle',
  outline: 'Outline',
  shadow: 'Shadow',
  alignment: 'Alignment',
  marginl: 'MarginL',
  marginr: 'MarginR',
  marginv: 'MarginV',
  encoding: 'Encoding',
}

const BOOLEAN_STYLE_FIELDS = new Set(['Bold', 'Italic', 'Underline', 'StrikeOut'])
const NON_NEGATIVE_STYLE_FIELDS = new Set(['Spacing', 'Outline', 'Shadow'])

/** ASS style lines are normalized before libass processes force-style overrides. Reproduce those
 * transformations here; replaying raw ScaleX=100 after parsing would make text 100× wider. */
function forceStyleValue(field: string, raw: string): string {
  if (BOOLEAN_STYLE_FIELDS.has(field)) return num(raw) === 0 ? '0' : '1'
  if (field === 'ScaleX' || field === 'ScaleY') return String(Math.max(0, num(raw)) / 100)
  if (NON_NEGATIVE_STYLE_FIELDS.has(field)) return String(Math.max(0, num(raw)))
  if (field === 'Alignment') {
    const alignment = Math.trunc(num(raw))
    if (alignment < 1 || alignment > 9) return String(alignment)
    const horizontal = ((alignment - 1) % 3) + 1
    const vertical = Math.floor((alignment - 1) / 3) * 4
    return String(horizontal | vertical)
  }
  return raw
}

/** The `[V4+ Styles]` (or legacy `[V4 Styles]`) block of an ASS header → structured styles.
 *  Field order comes from the Format line, so column drift between muxers is harmless. */
export function parseAssStyles(extradata: string): {
  playResY: number
  isAss: boolean
  scriptInfo: [field: string, value: string][]
  styles: AssStyle[]
} | null {
  if (!extradata) return null
  const lines = extradata.split(/\r?\n/)
  let inScriptInfo = false
  const scriptInfo: [string, string][] = []
  for (const line of lines) {
    const section = /^\s*\[([^\]]+)\]/.exec(line)
    if (section) { inScriptInfo = /^script info$/i.test(section[1].trim()); continue }
    if (!inScriptInfo) continue
    const entry = /^\s*([^:]+)\s*:\s*(.*?)\s*$/.exec(line)
    const field = entry && SCRIPT_FIELDS[entry[1].trim().toLowerCase()]
    if (field && entry[2]) scriptInfo.push([field, entry[2]])
  }
  const playResY = num(scriptInfo.find(([field]) => field === 'PlayResY')?.[1], DEFAULT_PLAY_RES_Y)
    || DEFAULT_PLAY_RES_Y

  let format: string[] | null = null
  let inStyles = false
  let isAss = false
  const styles: AssStyle[] = []
  for (const line of lines) {
    const section = /^\[([^\]]+)\]/.exec(line.trim())
    if (section) {
      const sectionName = section[1].trim()
      inStyles = /^v4\+? styles$/i.test(sectionName)
      if (inStyles) isAss = /^v4\+ styles$/i.test(sectionName)
      continue
    }
    if (!inStyles) continue
    const fmt = /^Format\s*:\s*(.+)$/i.exec(line)
    if (fmt) { format = fmt[1].split(',').map((f) => f.trim().toLowerCase()); continue }
    const st = /^Style\s*:\s*(.+)$/i.exec(line)
    if (!st || !format) continue
    // Only the leading fields may embed no commas; keep a strict split but fold any surplus
    // trailing values into the last declared column so a long line can't shift fields.
    const parts = st[1].split(',')
    const values = parts.slice(0, format.length - 1).concat(parts.slice(format.length - 1).join(','))
    const field = (name: string) => values[format!.indexOf(name)]?.trim()
    const fields = format.flatMap((name, index): [string, string][] => {
      const canonical = STYLE_FIELDS[name]
      const value = values[index]?.trim()
      return canonical && value ? [[canonical, forceStyleValue(canonical, value)]] : []
    })
    const name = (field('name') ?? '').replace(/^\*+/, '') || 'Default'
    styles.push({
      name,
      fontname: field('fontname') ?? '',
      fontsize: num(field('fontsize')),
      primaryColour: field('primarycolour') ?? '',
      // SSA (V4) has no OutlineColour; its TertiaryColour is the outline.
      outlineColour: field('outlinecolour') ?? field('tertiarycolour') ?? '',
      bold: num(field('bold')) !== 0,
      outline: num(field('outline')),
      shadow: num(field('shadow')),
      alignment: num(field('alignment')),
      marginV: num(field('marginv')),
      fields,
    })
  }
  return styles.length ? { playResY, isAss, scriptInfo, styles } : null
}

/** The style dialogue actually renders in: `Default` by fansub convention, else the first
 *  declared style. Sign/OP styles are usually declared after it. */
export function pickPrimaryStyle(styles: AssStyle[]): AssStyle | null {
  return styles.find((s) => s.name.toLowerCase() === 'default') ?? styles[0] ?? null
}

/** `&HAABBGGRR` / `&HBBGGRR` → `#rrggbb` (ASS stores blue-first; alpha is dropped). */
function assColorToHex(colour: string): string | null {
  const m = /^&H([0-9a-fA-F]{1,8})&?$/.exec(colour.trim())
  if (!m) return null
  const bgr = parseInt(m[1], 16) & 0xffffff
  const r = bgr & 0xff, g = (bgr >> 8) & 0xff, b = (bgr >> 16) & 0xff
  return `#${[r, g, b].map((c) => c.toString(16).padStart(2, '0')).join('')}`
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))
const round1 = (v: number) => Math.round(v * 10) / 10

/** Map one ASS style into the app's SubtitleStyle fields, scaled from the script's PlayResY into
 *  mpv's 720-line space (sub-font-size/sub-border-size are 720-relative), clamped to the ranges
 *  the settings sliders accept so an applied preset is always editable there. */
export function toSubtitleStyle(style: AssStyle, playResY: number): SubtitleStyleAppearance {
  const scale = 720 / (playResY || DEFAULT_PLAY_RES_Y)
  // ASS numpad alignment: 1-3 = bottom row. Only there does MarginV mean "distance up from the
  // bottom edge", which is what mpv's sub-pos (0 top … 100 bottom) can express.
  const bottom = style.alignment >= 1 && style.alignment <= 3
  return {
    scope: 'dialogue',
    font: style.fontname.trim(),
    bold: style.bold,
    fontSize: clamp(Math.round(style.fontsize * scale), 20, 80),
    textColor: assColorToHex(style.primaryColour) ?? '#ffffff',
    borderColor: assColorToHex(style.outlineColour) ?? '#000000',
    borderSize: clamp(round1(style.outline * scale), 0, 8),
    shadow: clamp(round1(style.shadow * scale), 0, 8),
    position: bottom ? clamp(Math.round(100 - (style.marginV * 100) / (playResY || DEFAULT_PLAY_RES_Y)), 10, 100) : 92,
  }
}

/** End to end: extradata string → saveable style, or null when the track has no usable styles. */
export function captureFromExtradata(extradata: string | null | undefined): Omit<SubtitleStyle, 'enabled'> | null {
  const parsed = parseAssStyles(extradata ?? '')
  if (!parsed) return null
  const primary = pickPrimaryStyle(parsed.styles)
  if (!primary) return null
  const appearance = toSubtitleStyle(primary, parsed.playResY)
  const captured: Omit<SubtitleStyle, 'enabled'> = {
    ...appearance,
  }
  if (parsed.isAss) captured.assSnapshot = {
      reference: { ...appearance },
      scriptInfo: parsed.scriptInfo,
      styles: parsed.styles.map((style) => ({ name: style.name, fields: style.fields })),
  }
  return captured
}
