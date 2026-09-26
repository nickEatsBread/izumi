import { THEME_FONTS } from './font-ids'

// Latin and Latin Extended only (the same ranges Fontsource ships). Japanese titles fall back to
// the system font, which renders them better than a Latin family would anyway.
const LATIN = 'U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD'
const LATIN_EXT = 'U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,U+0329,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF'

type Url = () => Promise<{ default: string }>
interface Face { weight: string; latin: Url; latinExt: Url }
const variable = (latin: Url, latinExt: Url): Face[] => [{ weight: '100 1000', latin, latinExt }]

// Every import is a literal so Vite can see and bundle each file; nothing loads until a theme asks.
const FACES: Record<string, Face[]> = {
  'inter': variable(() => import('@fontsource-variable/inter/files/inter-latin-wght-normal.woff2?url'), () => import('@fontsource-variable/inter/files/inter-latin-ext-wght-normal.woff2?url')),
  'roboto': variable(() => import('@fontsource-variable/roboto/files/roboto-latin-wght-normal.woff2?url'), () => import('@fontsource-variable/roboto/files/roboto-latin-ext-wght-normal.woff2?url')),
  'montserrat': variable(() => import('@fontsource-variable/montserrat/files/montserrat-latin-wght-normal.woff2?url'), () => import('@fontsource-variable/montserrat/files/montserrat-latin-ext-wght-normal.woff2?url')),
  'open-sans': variable(() => import('@fontsource-variable/open-sans/files/open-sans-latin-wght-normal.woff2?url'), () => import('@fontsource-variable/open-sans/files/open-sans-latin-ext-wght-normal.woff2?url')),
  'rubik': variable(() => import('@fontsource-variable/rubik/files/rubik-latin-wght-normal.woff2?url'), () => import('@fontsource-variable/rubik/files/rubik-latin-ext-wght-normal.woff2?url')),
  'dm-sans': variable(() => import('@fontsource-variable/dm-sans/files/dm-sans-latin-wght-normal.woff2?url'), () => import('@fontsource-variable/dm-sans/files/dm-sans-latin-ext-wght-normal.woff2?url')),
  'plus-jakarta-sans': variable(() => import('@fontsource-variable/plus-jakarta-sans/files/plus-jakarta-sans-latin-wght-normal.woff2?url'), () => import('@fontsource-variable/plus-jakarta-sans/files/plus-jakarta-sans-latin-ext-wght-normal.woff2?url')),
  'outfit': variable(() => import('@fontsource-variable/outfit/files/outfit-latin-wght-normal.woff2?url'), () => import('@fontsource-variable/outfit/files/outfit-latin-ext-wght-normal.woff2?url')),
  'manrope': variable(() => import('@fontsource-variable/manrope/files/manrope-latin-wght-normal.woff2?url'), () => import('@fontsource-variable/manrope/files/manrope-latin-ext-wght-normal.woff2?url')),
  'figtree': variable(() => import('@fontsource-variable/figtree/files/figtree-latin-wght-normal.woff2?url'), () => import('@fontsource-variable/figtree/files/figtree-latin-ext-wght-normal.woff2?url')),
  'source-sans-3': variable(() => import('@fontsource-variable/source-sans-3/files/source-sans-3-latin-wght-normal.woff2?url'), () => import('@fontsource-variable/source-sans-3/files/source-sans-3-latin-ext-wght-normal.woff2?url')),
  'noto-sans': variable(() => import('@fontsource-variable/noto-sans/files/noto-sans-latin-wght-normal.woff2?url'), () => import('@fontsource-variable/noto-sans/files/noto-sans-latin-ext-wght-normal.woff2?url')),
  'oswald': variable(() => import('@fontsource-variable/oswald/files/oswald-latin-wght-normal.woff2?url'), () => import('@fontsource-variable/oswald/files/oswald-latin-ext-wght-normal.woff2?url')),
  'cinzel': variable(() => import('@fontsource-variable/cinzel/files/cinzel-latin-wght-normal.woff2?url'), () => import('@fontsource-variable/cinzel/files/cinzel-latin-ext-wght-normal.woff2?url')),
  'playfair-display': variable(() => import('@fontsource-variable/playfair-display/files/playfair-display-latin-wght-normal.woff2?url'), () => import('@fontsource-variable/playfair-display/files/playfair-display-latin-ext-wght-normal.woff2?url')),
  'poppins': [
    { weight: '400', latin: () => import('@fontsource/poppins/files/poppins-latin-400-normal.woff2?url'), latinExt: () => import('@fontsource/poppins/files/poppins-latin-ext-400-normal.woff2?url') },
    { weight: '500', latin: () => import('@fontsource/poppins/files/poppins-latin-500-normal.woff2?url'), latinExt: () => import('@fontsource/poppins/files/poppins-latin-ext-500-normal.woff2?url') },
    { weight: '600', latin: () => import('@fontsource/poppins/files/poppins-latin-600-normal.woff2?url'), latinExt: () => import('@fontsource/poppins/files/poppins-latin-ext-600-normal.woff2?url') },
    { weight: '700', latin: () => import('@fontsource/poppins/files/poppins-latin-700-normal.woff2?url'), latinExt: () => import('@fontsource/poppins/files/poppins-latin-ext-700-normal.woff2?url') },
    { weight: '800', latin: () => import('@fontsource/poppins/files/poppins-latin-800-normal.woff2?url'), latinExt: () => import('@fontsource/poppins/files/poppins-latin-ext-800-normal.woff2?url') },
  ],
  'lato': [
    { weight: '400', latin: () => import('@fontsource/lato/files/lato-latin-400-normal.woff2?url'), latinExt: () => import('@fontsource/lato/files/lato-latin-ext-400-normal.woff2?url') },
    { weight: '700', latin: () => import('@fontsource/lato/files/lato-latin-700-normal.woff2?url'), latinExt: () => import('@fontsource/lato/files/lato-latin-ext-700-normal.woff2?url') },
    { weight: '900', latin: () => import('@fontsource/lato/files/lato-latin-900-normal.woff2?url'), latinExt: () => import('@fontsource/lato/files/lato-latin-ext-900-normal.woff2?url') },
  ],
  'fira-sans': [
    { weight: '400', latin: () => import('@fontsource/fira-sans/files/fira-sans-latin-400-normal.woff2?url'), latinExt: () => import('@fontsource/fira-sans/files/fira-sans-latin-ext-400-normal.woff2?url') },
    { weight: '500', latin: () => import('@fontsource/fira-sans/files/fira-sans-latin-500-normal.woff2?url'), latinExt: () => import('@fontsource/fira-sans/files/fira-sans-latin-ext-500-normal.woff2?url') },
    { weight: '700', latin: () => import('@fontsource/fira-sans/files/fira-sans-latin-700-normal.woff2?url'), latinExt: () => import('@fontsource/fira-sans/files/fira-sans-latin-ext-700-normal.woff2?url') },
  ],
  'bebas-neue': [
    { weight: '400', latin: () => import('@fontsource/bebas-neue/files/bebas-neue-latin-400-normal.woff2?url'), latinExt: () => import('@fontsource/bebas-neue/files/bebas-neue-latin-ext-400-normal.woff2?url') },
  ],
}

async function register(family: string, weight: string, source: Url, unicodeRange: string): Promise<void> {
  const url = (await source()).default
  const face = new FontFace(family, `url(${JSON.stringify(url)}) format('woff2')`, { weight, style: 'normal', display: 'swap', unicodeRange })
  document.fonts.add(face)
  await face.load()
}

const loading = new Map<string, Promise<void>>()
/** Registers a bundled theme font once. Unknown ids, system stacks and app fonts are no-ops. */
export function loadThemeFont(id: string | undefined): Promise<void> {
  if (!id || !Object.hasOwn(FACES, id) || typeof document === 'undefined' || typeof FontFace === 'undefined') return Promise.resolve()
  let pending = loading.get(id)
  if (!pending) {
    const family = THEME_FONTS[id].family
    pending = Promise.all(FACES[id].flatMap(face => [
      register(family, face.weight, face.latin, LATIN),
      register(family, face.weight, face.latinExt, LATIN_EXT),
    ])).then(() => undefined, () => undefined)
    loading.set(id, pending)
  }
  return pending
}
