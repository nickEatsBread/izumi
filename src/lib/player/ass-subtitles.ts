import { parseAssStyles } from './ass-style-capture'
import { subtitleStyleProps, type SubtitleAdjustments, type SubtitleStyle } from './subtitle-style'

// ASS/SSA tracks in the webview player (protected streams on Windows and macOS) are drawn by libass
// as authored, like mpv draws them everywhere else. These helpers are the string work around that:
// spotting a script, restyling it the way mpv's `sub-ass-style-overrides` would, and matching the
// fonts a source lists for its subtitles to the families a script uses.

/** A font a source lists for its subtitles: the family as a script names it, and where the file is. */
export interface SubtitleFont {
  family: string
  url: string
}

/** ASS/SSA by its content or file name. Anything else is text the webview's cue renderer draws. */
export function isAssSubtitle(url: string, body: string): boolean {
  return /\[script info\]/i.test(body) || /^dialogue:/im.test(body) || /\.(ass|ssa)(\?|$)/i.test(url)
}

/** A source's `subtitleFonts`, keeping only entries with a family name and an http(s) URL. */
export function parseSubtitleFonts(value: unknown): SubtitleFont[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((item: { family?: unknown; url?: unknown } | null) => {
    const family = typeof item?.family === 'string' ? item.family.trim() : ''
    const url = typeof item?.url === 'string' ? item.url.trim() : ''
    return family && /^https?:\/\//i.test(url) ? [{ family, url }] : []
  })
}

const SCRIPT_FIELDS = new Set([
  'playresx', 'playresy', 'layoutresx', 'layoutresy', 'wrapstyle', 'scaledborderandshadow', 'kerning', 'ycbcr matrix',
])

/** Split at the first `count - 1` commas: an ASS line's last column may itself hold commas. */
function columns(text: string, count: number): string[] {
  const parts = text.split(',')
  return parts.slice(0, count - 1).concat(parts.slice(count - 1).join(','))
}

/**
 * Write mpv/libass style overrides (`[Style.]Field=Value`, or a Script Info field such as
 * `PlayResY=1080`) into the script itself, for a renderer that only takes the script. Style names
 * and fields match case-insensitively, as libass matches them.
 */
export function applyAssStyleOverrides(ass: string, overrides: string[]): string {
  const script = new Map<string, [field: string, value: string]>()
  const styles: { style: string | null; field: string; value: string }[] = []
  for (const entry of overrides) {
    const eq = entry.lastIndexOf('=')
    if (eq <= 0) continue
    const name = entry.slice(0, eq).trim()
    const value = entry.slice(eq + 1).trim()
    if (SCRIPT_FIELDS.has(name.toLowerCase())) {
      script.set(name.toLowerCase(), [name, value])
      continue
    }
    const dot = name.lastIndexOf('.')
    styles.push({
      style: dot > 0 ? name.slice(0, dot).trim().toLowerCase() : null,
      field: name.slice(dot + 1).trim().toLowerCase(),
      value,
    })
  }
  const out: string[] = []
  const written = new Set<string>()
  const addMissingScriptFields = () => {
    for (const [key, [field, value]] of script) if (!written.has(key)) out.push(`${field}: ${value}`)
    written.clear()
    for (const key of script.keys()) written.add(key)
  }
  let section = ''
  let format: string[] = []
  for (const line of ass.split(/\r?\n/)) {
    const header = /^\s*\[([^\]]+)\]\s*$/.exec(line)
    if (header) {
      if (section === 'script info') addMissingScriptFields()
      section = header[1].trim().toLowerCase()
      out.push(line)
      continue
    }
    if (section === 'script info') {
      const entry = /^\s*([^:;]+?)\s*:\s*(.*)$/.exec(line)
      const key = entry?.[1].toLowerCase()
      const override = key ? script.get(key) : undefined
      if (entry && key && override) {
        written.add(key)
        out.push(`${entry[1]}: ${override[1]}`)
        continue
      }
    } else if (section === 'v4+ styles' || section === 'v4 styles') {
      const formatLine = /^\s*format\s*:(.*)$/i.exec(line)
      if (formatLine) format = formatLine[1].split(',').map((column) => column.trim().toLowerCase())
      const styleLine = /^(\s*style\s*:\s*)(.*)$/i.exec(line)
      if (styleLine && format.length) {
        const values = columns(styleLine[2], format.length)
        const name = (values[format.indexOf('name')] ?? '').trim().toLowerCase()
        for (const override of styles) {
          const index = format.indexOf(override.field)
          if (index >= 0 && (override.style === null || override.style === name)) values[index] = override.value
        }
        out.push(styleLine[1] + values.join(','))
        continue
      }
    }
    out.push(line)
  }
  if (section === 'script info') addMissingScriptFields()
  return out.join('\n')
}

/**
 * The script to draw for an ASS track, or null when the user's style replaces the script's own
 * entirely (mpv's `sub-ass-override=force`): that is plain text in the user's style. Otherwise the
 * script is drawn as authored, or with its dialogue restyled when "Use my subtitle style" is on —
 * the same choice {@link subtitleStyleProps} makes for mpv.
 */
export function assTrackContent(body: string, style: SubtitleStyle, adjustments: SubtitleAdjustments): string | null {
  const props = new Map(subtitleStyleProps(style, { ass: true, header: parseAssStyles(body) }, adjustments))
  if (props.get('sub-ass-override') === 'force') return null
  const overrides = props.get('sub-ass-style-overrides') ?? ''
  return overrides ? applyAssStyleOverrides(body, overrides.split(',')) : body
}

/** Font families a script asks for: its styles' fonts and inline `\fn` overrides, lower-cased. */
export function assFontFamilies(ass: string): string[] {
  const names = new Set<string>()
  for (const style of parseAssStyles(ass)?.styles ?? []) names.add(style.fontname)
  for (const match of ass.matchAll(/\\fn([^\\}]*)/g)) names.add(match[1] ?? '')
  return [...names].map((name) => name.replace(/^@/, '').trim().toLowerCase()).filter(Boolean)
}

const FACE = /^(?:(?:thin|extralight|light|regular|medium|semibold|bold|extrabold|black|ultrablack)(?: (?:italic|oblique))?|italic|oblique)$/

/** The listed fonts that cover `families`: each family's own entry and its weight/italic faces. */
export function fontsForFamilies(fonts: SubtitleFont[], families: string[]): SubtitleFont[] {
  const wanted = new Set(families.map((family) => family.toLowerCase()))
  return fonts.filter(({ family }) => {
    const name = family.toLowerCase()
    if (wanted.has(name)) return true
    for (const base of wanted) {
      if (name.startsWith(`${base} `) && FACE.test(name.slice(base.length + 1))) return true
    }
    return false
  })
}

/** Writing systems the bundled fallback face has no glyphs for: Arabic, Indic, Thai, CJK, Hangul… */
const WIDE_SCRIPT = /[\u0600-\u1dff\u2e80-\u9fff\uac00-\ud7af\uf900-\ufaff\ufb50-\ufeff\uff00-\uffef]/

/** A script whose lines are written in one of those systems: without its own fonts it would draw
 *  as empty boxes, where the webview's plain text still finds a system face. */
export function needsOwnFonts(ass: string): boolean {
  return ass.split(/\r?\n/).some((line) => /^dialogue:/i.test(line) && WIDE_SCRIPT.test(line))
}
