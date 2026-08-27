import { catalogPackages, normalizeManifest, resolveManifestUrl } from '$lib/extensions/catalog'
import { phttp } from '$lib/net/http'
import { normalizeBase } from '$lib/stremio/sources'

export type ClassifiedSource =
  | { kind: 'addon'; spec: string }
  | { kind: 'extension'; spec: string }

const EMPTY_ERROR = 'Enter a URL, GitHub repo, or catalog.'
const UNKNOWN_ERROR = "Couldn't tell if that's a Stremio add-on or a community source."
const FETCH_ERROR = 'That URL could not be fetched.'
const INVALID_ADDON = 'Enter a valid add-on manifest URL.'
const NOT_JSON = 'That URL did not return a valid manifest.'

const stripQuotes = (value: string) => value.trim().replace(/^(['"])(.*)\1$/, '$2').trim()

const isGithubShorthand = (value: string) =>
  /^[A-Za-z0-9][A-Za-z0-9-]*\/[^\s:]+$/.test(value) && !/^https?:/i.test(value)

export function classifySourceSpecShape(input: string): ClassifiedSource | 'url' | { error: string } {
  const spec = stripQuotes(input)
  if (!spec) return { error: EMPTY_ERROR }
  if (spec.startsWith('gh:') || spec.startsWith('npm:') || isGithubShorthand(spec)) {
    return { kind: 'extension', spec }
  }
  if (/^stremio:\/\//i.test(spec)) {
    const base = normalizeBase(spec)
    return base ? { kind: 'addon', spec: base } : { error: INVALID_ADDON }
  }
  if (/^https?:\/\//i.test(spec) || normalizeBase(spec)) return 'url'
  return { error: EMPTY_ERROR }
}

export function sourceSpecFetchUrl(spec: string): string {
  const s = stripQuotes(spec)
  if (/\.json(\?|$)/i.test(s)) {
    return /^https?:\/\//i.test(s) ? s.replace(/^http:\/\//i, 'https://') : `https://${s}`
  }
  const base = normalizeBase(s)
  if (base) return `${base}/manifest.json`
  return resolveManifestUrl(s)
}

function isCompiledAndroid(raw: unknown): boolean {
  if (!raw || typeof raw !== 'object') return false
  if (!Array.isArray(raw) && Array.isArray((raw as { pluginLists?: unknown }).pluginLists)) return true
  const entries = Array.isArray(raw) ? raw : [raw]
  return entries.some((entry) => {
    if (!entry || typeof entry !== 'object') return false
    const row = entry as { url?: unknown; jarUrl?: unknown; internalName?: unknown; apiVersion?: unknown }
    return /\.(?:cs3|jar)(?:\?|$)/i.test(String(row.url ?? ''))
      || !!row.jarUrl
      || (!!row.internalName && row.apiVersion != null)
  })
}

function isStremioManifest(raw: unknown): boolean {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return false
  const row = raw as Record<string, unknown>
  if (typeof row.id !== 'string' || typeof row.name !== 'string') return false
  return Array.isArray(row.resources) || Array.isArray(row.catalogs)
    || Array.isArray(row.types) || !!row.behaviorHints
}

export function classifySourceDocument(raw: unknown, fetchedUrl: string): ClassifiedSource | { error: string } {
  if (catalogPackages(raw) !== null) return { kind: 'extension', spec: fetchedUrl }
  if (isCompiledAndroid(raw)) return { kind: 'extension', spec: fetchedUrl }
  if (Array.isArray(raw)) return { kind: 'extension', spec: fetchedUrl }
  if (normalizeManifest(raw, fetchedUrl).length) return { kind: 'extension', spec: fetchedUrl }
  if (isStremioManifest(raw)) {
    const base = normalizeBase(fetchedUrl)
    return { kind: 'addon', spec: base || fetchedUrl }
  }
  if (raw && typeof raw === 'object' && Array.isArray((raw as { packages?: unknown }).packages)) {
    return { kind: 'extension', spec: fetchedUrl }
  }
  return { error: UNKNOWN_ERROR }
}

async function defaultFetchJson(url: string): Promise<unknown> {
  const response = await phttp(url)
  if (!response.ok) throw new Error(FETCH_ERROR)
  try {
    return await response.json()
  } catch {
    throw new Error(NOT_JSON)
  }
}

export async function classifySourceSpec(
  input: string,
  fetchJson: (url: string) => Promise<unknown> = defaultFetchJson,
): Promise<ClassifiedSource | { error: string }> {
  const spec = stripQuotes(input)
  const shape = classifySourceSpecShape(spec)
  if (shape !== 'url') return shape
  try {
    const fetchedUrl = sourceSpecFetchUrl(spec)
    const raw = await fetchJson(fetchedUrl)
    const classified = classifySourceDocument(raw, fetchedUrl)
    if ('error' in classified) return classified
    if (classified.kind === 'addon') {
      const base = normalizeBase(spec) || classified.spec
      return { kind: 'addon', spec: base }
    }
    return { kind: 'extension', spec }
  } catch (error) {
    if (error instanceof Error && error.message === NOT_JSON) return { error: NOT_JSON }
    return { error: FETCH_ERROR }
  }
}
