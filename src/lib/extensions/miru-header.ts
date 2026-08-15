/** Metadata from the userscript-style banner every extension carries. */
export interface MiruMeta {
  name?: string
  package?: string
  type?: string
  lang?: string
  webSite?: string
  version?: string
  icon?: string
  nsfw?: boolean
}

const BANNER_RE = /==MiruExtension==([\s\S]*?)==\/MiruExtension==/

export const isMiruExtension = (code: string): boolean => BANNER_RE.test(code)

/** Parse the banner without loading the cheerio-backed runtime. */
export function parseMiruHeader(code: string): MiruMeta | null {
  const block = code.match(BANNER_RE)?.[1]
  if (!block) return null
  const meta: Record<string, string> = {}
  for (const line of block.split('\n')) {
    const match = line.match(/@(\w+)\s+(.+?)\s*$/)
    if (match) meta[match[1]] = match[2].trim()
  }
  return {
    name: meta.name,
    package: meta.package,
    type: meta.type,
    lang: meta.lang,
    webSite: meta.webSite?.replace(/\/+$/, ''),
    version: meta.version,
    icon: meta.icon,
    nsfw: meta.nsfw === 'true',
  }
}
