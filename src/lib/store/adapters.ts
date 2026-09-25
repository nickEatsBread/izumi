import { aniyomiRepositoryPackages, catalogPackages, manifestProblem, normalizeManifest, type ExtensionCatalogPackage } from '$lib/extensions/catalog'
import { parseCatalog } from '$lib/themes/packages'
import { isNativeStore, parseNativeStore } from './native-format'
import type { SourceType, StoreEntry, StoreListing } from './types'

// Store formats the Store can browse, each normalised into one StoreListing (spec §6.2). Pure: the
// caller fetches. The most specific shape is tried first, and every result goes through one cleaning
// pass so all formats obey the same entry rules.

const MARKETPLACE_TYPES: Readonly<Record<string, SourceType>> = {
  'onlinestream-provider': 'stream-provider',
  'anime-torrent-provider': 'torrent-provider',
}
const SOURCE_TYPES: ReadonlySet<SourceType> = new Set(['stremio-addon', 'torrent-provider', 'stream-provider', 'package'])
const SOURCE_NOT_STORE = 'That link is a source, not a store. Add it on the Sources page instead.'

function clip(value: unknown, max: number): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, max) : undefined
}

// Catalog parsers only check a package's id and payload, so everything shown or installed is checked
// again here: one malformed package must not break the whole store, and a package is only listed
// when its download is HTTPS.
function packageEntry(pkg: ExtensionCatalogPackage, storeId: string): StoreEntry | null {
  const download: unknown = pkg.packageFormat === 'aniyomi-repo' ? pkg.apk : pkg.package
  try {
    if (new URL(String(download)).protocol !== 'https:') return null
  } catch {
    return null
  }
  if (typeof pkg.id !== 'string' || !pkg.id || pkg.id.length > 200) return null
  const sources = Array.isArray(pkg.sources) ? pkg.sources : []
  const version: unknown = pkg.version
  const language: unknown = pkg.language
  return {
    key: `${storeId}:source:${pkg.id}`,
    storeId,
    kind: 'source',
    sourceType: 'package',
    id: pkg.id,
    name: clip(pkg.name, 64) ?? pkg.id,
    version: typeof version === 'string' || typeof version === 'number' ? String(version) : undefined,
    description: sources.map((source) => clip(source?.name, 64)).filter(Boolean).join(' · ') || undefined,
    languages: typeof language === 'string' ? [language.toLowerCase()] : [],
    content: ['anime'],
    nsfw: pkg.nsfw === true,
    requiresDebrid: false,
    install: { type: 'package', pkg: { ...pkg, sources } },
  }
}

function packageListing(adapter: 'izumi-ext-catalog' | 'aniyomi-index', packages: ExtensionCatalogPackage[], storeId: string): StoreListing {
  const entries = packages.flatMap((pkg) => {
    const entry = packageEntry(pkg, storeId)
    return entry ? [entry] : []
  })
  return finish({ storeId, adapter, entries, skipped: packages.length - entries.length })
}

// A provider marketplace is an array of rich entries whose `manifestURI` names each provider's own
// manifest — so each provider can be installed on its own.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function marketplaceEntries(raw: any[], storeId: string): { entries: StoreEntry[]; skipped: number } | null {
  const rich = raw.filter((item) => item && typeof item === 'object'
    && typeof item.manifestURI === 'string' && typeof item.id === 'string')
  if (!rich.length) return null
  const entries: StoreEntry[] = []
  let skipped = 0
  for (const item of rich) {
    const type = String(item.type)
    // Own keys only: `constructor` or `toString` must never become a source type.
    const sourceType = Object.hasOwn(MARKETPLACE_TYPES, type) ? MARKETPLACE_TYPES[type] : undefined
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
    entries.push({
      key: `${storeId}:source:${id}`,
      storeId,
      kind: 'source',
      sourceType,
      id,
      name: String(item.name ?? id),
      version: item.version == null ? undefined : String(item.version),
      author: typeof item.author === 'string' ? item.author : undefined,
      description: typeof item.description === 'string' ? item.description : undefined,
      icon: typeof item.icon === 'string' && item.icon.startsWith('https://') ? item.icon : undefined,
      languages: typeof item.lang === 'string' && item.lang !== 'multi' ? [item.lang] : [],
      content: ['anime'],
      nsfw: item.isNsfw === true || item.nsfw === true,
      requiresDebrid: false,
      install: { type: 'extension', spec },
    })
  }
  return { entries, skipped }
}

/** One cleaning pass for every format: capped text, lowercase languages, known source types and
 *  unique keys. Entries that fail are dropped and counted rather than breaking the listing. */
function finish(listing: StoreListing): StoreListing {
  const seen = new Set<string>()
  const entries: StoreEntry[] = []
  let skipped = listing.skipped
  for (const entry of listing.entries) {
    const name = clip(entry.name, 64)
    const knownSource = entry.kind !== 'source' || (!!entry.sourceType && SOURCE_TYPES.has(entry.sourceType))
    if (!name || !knownSource || seen.has(entry.key)) {
      skipped += 1
      continue
    }
    seen.add(entry.key)
    entries.push({
      ...entry,
      name,
      version: clip(entry.version, 32),
      author: clip(entry.author, 80),
      description: clip(entry.description, 600),
      languages: [...new Set(entry.languages
        .filter((language) => typeof language === 'string' && language.length > 0 && language.length <= 32)
        .map((language) => language.toLowerCase()))].slice(0, 24),
    })
  }
  return { ...listing, entries, skipped }
}

/** Recognise a fetched document and normalise it. Throws a user-facing message when the document is
 *  not something the Store can browse. */
export function adaptStoreDocument(raw: unknown, url: string, storeId: string): StoreListing {
  if (isNativeStore(raw)) {
    const { meta, entries, skipped } = parseNativeStore(raw, url, storeId)
    return finish({
      storeId,
      adapter: 'izumi-store',
      name: meta.name,
      description: meta.description,
      icon: meta.icon,
      homepage: meta.homepage,
      publicKey: meta.publicKey,
      entries,
      skipped,
    })
  }
  if (raw && typeof raw === 'object' && !Array.isArray(raw) && (raw as { kind?: unknown }).kind === 'theme-catalog') {
    const catalog = parseCatalog(raw)
    return finish({
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
    })
  }
  const izumiPackages = catalogPackages(raw)
  if (izumiPackages) return packageListing('izumi-ext-catalog', izumiPackages, storeId)
  const aniyomi = aniyomiRepositoryPackages(raw, url)
  if (aniyomi) return packageListing('aniyomi-index', aniyomi, storeId)
  if (Array.isArray(raw)) {
    const marketplace = marketplaceEntries(raw, storeId)
    if (marketplace) return finish({ storeId, adapter: 'marketplace', ...marketplace })
  }
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    const doc = raw as Record<string, unknown>
    // A package catalog in a newer format, or a compiled-plugin repository: say which.
    if (Array.isArray(doc.packages) || Array.isArray(doc.pluginLists)) {
      throw new Error(manifestProblem(raw) ?? 'That link is not a store izumi can open.')
    }
    // A Stremio addon manifest is a source.
    if (typeof doc.id === 'string' && (Array.isArray(doc.resources) || Array.isArray(doc.catalogs))) throw new Error(SOURCE_NOT_STORE)
  }
  if (normalizeManifest(raw, url).length) throw new Error(SOURCE_NOT_STORE)
  throw new Error('That link is not a store izumi can open.')
}
