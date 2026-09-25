import { aniyomiRepositoryPackages, catalogPackages, normalizeManifest, type ExtensionCatalogPackage } from '$lib/extensions/catalog'
import { parseCatalog } from '$lib/themes/packages'
import { isNativeStore, parseNativeStore } from './native-format'
import type { SourceType, StoreEntry, StoreListing } from './types'

// Store formats the Store can browse, each normalised into one StoreListing (spec §6.2). Pure: the
// caller fetches. The most specific shape is tried first.

const MARKETPLACE_TYPES: Readonly<Record<string, SourceType>> = {
  'onlinestream-provider': 'stream-provider',
  'anime-torrent-provider': 'torrent-provider',
}

function packageEntry(pkg: ExtensionCatalogPackage, storeId: string): StoreEntry {
  return {
    key: `${storeId}:source:${pkg.id}`,
    storeId,
    kind: 'source',
    sourceType: 'package',
    id: pkg.id,
    name: pkg.name,
    version: pkg.version,
    description: pkg.sources.map((source) => source.name).join(' · ') || undefined,
    languages: pkg.language ? [pkg.language.toLowerCase()] : [],
    content: ['anime'],
    nsfw: pkg.nsfw,
    requiresDebrid: false,
    install: { type: 'package', pkg },
  }
}

// A provider marketplace is an array of rich entries whose `manifestURI` names each provider's own
// manifest — so each provider can be installed on its own.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function marketplaceEntries(raw: any[], storeId: string): { entries: StoreEntry[]; skipped: number } | null {
  const rich = raw.filter((item) => item && typeof item === 'object'
    && typeof item.manifestURI === 'string' && typeof item.id === 'string')
  if (!rich.length) return null
  const entries: StoreEntry[] = []
  const seen = new Set<string>()
  let skipped = 0
  for (const item of rich) {
    const sourceType = MARKETPLACE_TYPES[String(item.type)]
    if (!sourceType) continue // manga providers, UI plugins and custom sources are not ours to list
    let spec: string
    try {
      const url = new URL(String(item.manifestURI))
      if (url.protocol !== 'https:') { skipped += 1; continue }
      spec = url.href
    } catch {
      skipped += 1
      continue
    }
    const id = String(item.id)
    const key = `${storeId}:source:${id}`
    if (seen.has(key)) { skipped += 1; continue }
    seen.add(key)
    entries.push({
      key,
      storeId,
      kind: 'source',
      sourceType,
      id,
      name: String(item.name ?? id).slice(0, 64),
      version: item.version == null ? undefined : String(item.version),
      author: typeof item.author === 'string' ? item.author : undefined,
      description: typeof item.description === 'string' ? item.description.slice(0, 600) : undefined,
      icon: typeof item.icon === 'string' && item.icon.startsWith('https://') ? item.icon : undefined,
      languages: typeof item.lang === 'string' && item.lang !== 'multi' ? [item.lang.toLowerCase()] : [],
      content: ['anime'],
      nsfw: item.isNsfw === true || item.nsfw === true,
      requiresDebrid: false,
      install: { type: 'extension', spec },
    })
  }
  return { entries, skipped }
}

/** Recognise a fetched document and normalise it. Throws a user-facing message when the document is
 *  not something the Store can browse. */
export function adaptStoreDocument(raw: unknown, url: string, storeId: string): StoreListing {
  if (isNativeStore(raw)) {
    const { meta, entries, skipped } = parseNativeStore(raw, url, storeId)
    return {
      storeId,
      adapter: 'izumi-store',
      name: meta.name,
      description: meta.description,
      icon: meta.icon,
      homepage: meta.homepage,
      publicKey: meta.publicKey,
      entries,
      skipped,
    }
  }
  if (raw && typeof raw === 'object' && !Array.isArray(raw) && (raw as { kind?: unknown }).kind === 'theme-catalog') {
    const catalog = parseCatalog(raw)
    return {
      storeId,
      adapter: 'theme-catalog',
      skipped: 0,
      entries: catalog.themes.map((release): StoreEntry => ({
        key: `${storeId}:theme:${release.id}`,
        storeId,
        kind: 'theme',
        id: release.id,
        name: release.name,
        version: release.version,
        author: release.author,
        description: release.description,
        preview: release.preview,
        homepage: release.project,
        languages: [],
        content: [],
        nsfw: false,
        requiresDebrid: false,
        install: { type: 'theme', release },
      })),
    }
  }
  const izumiPackages = catalogPackages(raw)
  if (izumiPackages) {
    return { storeId, adapter: 'izumi-ext-catalog', entries: izumiPackages.map((pkg) => packageEntry(pkg, storeId)), skipped: 0 }
  }
  const aniyomi = aniyomiRepositoryPackages(raw, url)
  if (aniyomi) {
    return { storeId, adapter: 'aniyomi-index', entries: aniyomi.map((pkg) => packageEntry(pkg, storeId)), skipped: 0 }
  }
  if (Array.isArray(raw)) {
    const marketplace = marketplaceEntries(raw, storeId)
    if (marketplace) return { storeId, adapter: 'marketplace', ...marketplace }
  }
  if (normalizeManifest(raw, url).length) {
    throw new Error('That link is a source, not a store. Add it on the Sources page instead.')
  }
  throw new Error('That link is not a store izumi can open.')
}
