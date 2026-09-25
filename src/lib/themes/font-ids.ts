/** Fonts a theme may name. Pure (no imports) so the catalog CI mirrors it verbatim. Bundled
 *  families register as "izumi <Name>" so a same-named system font never shadows them. */
export interface ThemeFontSpec { family: string; fallback: string }
export interface ThemeFonts { ui?: string; heading?: string; display?: string }

export const THEME_FONTS: Record<string, ThemeFontSpec> = {
  system: { family: '', fallback: "system-ui, -apple-system, 'Segoe UI', sans-serif" },
  serif: { family: '', fallback: "Georgia, 'Times New Roman', serif" },
  nunito: { family: 'Nunito Variable', fallback: 'sans-serif' },
  'geist-mono': { family: 'Geist Mono', fallback: 'ui-monospace, monospace' },
  inter: { family: 'izumi Inter', fallback: 'sans-serif' },
  roboto: { family: 'izumi Roboto', fallback: 'sans-serif' },
  poppins: { family: 'izumi Poppins', fallback: 'sans-serif' },
  lato: { family: 'izumi Lato', fallback: 'sans-serif' },
  montserrat: { family: 'izumi Montserrat', fallback: 'sans-serif' },
  'open-sans': { family: 'izumi Open Sans', fallback: 'sans-serif' },
  rubik: { family: 'izumi Rubik', fallback: 'sans-serif' },
  'dm-sans': { family: 'izumi DM Sans', fallback: 'sans-serif' },
  'plus-jakarta-sans': { family: 'izumi Plus Jakarta Sans', fallback: 'sans-serif' },
  outfit: { family: 'izumi Outfit', fallback: 'sans-serif' },
  manrope: { family: 'izumi Manrope', fallback: 'sans-serif' },
  figtree: { family: 'izumi Figtree', fallback: 'sans-serif' },
  'source-sans-3': { family: 'izumi Source Sans 3', fallback: 'sans-serif' },
  'noto-sans': { family: 'izumi Noto Sans', fallback: 'sans-serif' },
  'fira-sans': { family: 'izumi Fira Sans', fallback: 'sans-serif' },
  oswald: { family: 'izumi Oswald', fallback: 'sans-serif' },
  'bebas-neue': { family: 'izumi Bebas Neue', fallback: 'Impact, sans-serif' },
  cinzel: { family: 'izumi Cinzel', fallback: 'Georgia, serif' },
  'playfair-display': { family: 'izumi Playfair Display', fallback: 'Georgia, serif' },
}
/** Fonts fonts.ts loads on demand (everything except the system stacks and the always-loaded app fonts). */
export const BUNDLED_FONT_IDS: readonly string[] = Object.keys(THEME_FONTS).filter(id => !['system', 'serif', 'nunito', 'geist-mono'].includes(id))

export function isThemeFont(id: unknown): id is string {
  return typeof id === 'string' && Object.hasOwn(THEME_FONTS, id)
}

export function parseThemeFonts(value: unknown): ThemeFonts {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Theme fonts must be an object with ui, heading or display.')
  const result: ThemeFonts = {}
  for (const [role, id] of Object.entries(value)) {
    if (role !== 'ui' && role !== 'heading' && role !== 'display') throw new Error('Theme fonts only set ui, heading and display.')
    if (!isThemeFont(id)) throw new Error('This theme names a font izumi does not bundle.')
    result[role] = id
  }
  return result
}

export function fontStack(id: string | undefined): string | undefined {
  if (!isThemeFont(id)) return undefined
  const spec = THEME_FONTS[id]
  return spec.family ? `'${spec.family}', ${spec.fallback}` : spec.fallback
}
