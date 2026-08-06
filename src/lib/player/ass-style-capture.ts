import type { SubtitleStyle } from './subtitle-style'

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
  outline: number
  shadow: number
  alignment: number
  marginV: number
}

/** libass falls back to 288 when a script omits PlayResY. */
const DEFAULT_PLAY_RES_Y = 288

const num = (v: string | undefined, fallback = 0): number => {
  const n = parseFloat(v ?? '')
  return Number.isFinite(n) ? n : fallback
}

/** The `[V4+ Styles]` (or legacy `[V4 Styles]`) block of an ASS header → structured styles.
 *  Field order comes from the Format line, so column drift between muxers is harmless. */
export function parseAssStyles(extradata: string): { playResY: number; styles: AssStyle[] } | null {
  if (!extradata) return null
  const lines = extradata.split(/\r?\n/)
  const playResY = num(lines.find((l) => /^PlayResY\s*:/i.test(l))?.split(':')[1], DEFAULT_PLAY_RES_Y)
    || DEFAULT_PLAY_RES_Y

  let format: string[] | null = null
  let inStyles = false
  const styles: AssStyle[] = []
  for (const line of lines) {
    const section = /^\[([^\]]+)\]/.exec(line.trim())
    if (section) { inStyles = /^v4\+? styles$/i.test(section[1].trim()); continue }
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
    styles.push({
      name: field('name') ?? '',
      fontname: field('fontname') ?? '',
      fontsize: num(field('fontsize')),
      primaryColour: field('primarycolour') ?? '',
      // SSA (V4) has no OutlineColour; its TertiaryColour is the outline.
      outlineColour: field('outlinecolour') ?? field('tertiarycolour') ?? '',
      outline: num(field('outline')),
      shadow: num(field('shadow')),
      alignment: num(field('alignment')),
      marginV: num(field('marginv')),
    })
  }
  return styles.length ? { playResY, styles } : null
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
export function toSubtitleStyle(style: AssStyle, playResY: number): Omit<SubtitleStyle, 'enabled'> {
  const scale = 720 / (playResY || DEFAULT_PLAY_RES_Y)
  // ASS numpad alignment: 1-3 = bottom row. Only there does MarginV mean "distance up from the
  // bottom edge", which is what mpv's sub-pos (0 top … 100 bottom) can express.
  const bottom = style.alignment >= 1 && style.alignment <= 3
  return {
    font: style.fontname.trim(),
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
  return primary ? toSubtitleStyle(primary, parsed.playResY) : null
}
