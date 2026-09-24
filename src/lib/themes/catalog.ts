import { phttp } from '$lib/net/http'
import { MAX_THEME_BYTES, SUPPORTED_THEME_APIS, THEME_API, THEME_CATALOG_URL, parseCatalog, parseRelease, parseThemePackage, parseSharedTheme, themeUrl, type PreparedTheme, type ThemeCatalog, type ThemeRelease } from './packages'

const CACHE_KEY = 'theme-catalog-cache-v1'
const encoder = new TextEncoder()
// Older webviews can lack AbortSignal.any, which would break requests with a caller signal.
function withTimeout(signal: AbortSignal | undefined, timeout: AbortSignal): { signal: AbortSignal; dispose: () => void } {
  if (!signal) return { signal: timeout, dispose: () => {} }
  if (typeof AbortSignal.any === 'function') return { signal: AbortSignal.any([signal, timeout]), dispose: () => {} }
  const combined = new AbortController()
  const listeners: Array<() => void> = []
  const dispose = () => { for (const remove of listeners.splice(0)) remove() }
  for (const source of [signal, timeout]) {
    const abort = () => { combined.abort(source.reason); dispose() }
    // Abort events are not replayed for listeners added after cancellation.
    if (source.aborted) { abort(); break }
    source.addEventListener('abort', abort, { once: true })
    listeners.push(() => source.removeEventListener('abort', abort))
  }
  return { signal: combined.signal, dispose }
}
export async function fetchThemeText(url: string, limit = MAX_THEME_BYTES, signal?: AbortSignal): Promise<string> {
  const target = themeUrl(url)
  const timeout = AbortSignal.timeout(20_000)
  const { signal: combined, dispose } = withTimeout(signal, timeout)
  try {
    if (combined.aborted) throw combined.reason
    if (typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window) {
      const response = await phttp(target, { maxBytes: limit, timeoutMs: 20_000, signal: combined, background: true })
      if (!response.ok) throw new Error(`Theme download failed (HTTP ${response.status}).`)
      const body = await response.text()
      if (encoder.encode(body).byteLength > limit) throw new Error('The theme document is too large.')
      return body
    }
    const response = await fetch(target, { signal: combined, credentials: 'omit', referrerPolicy: 'no-referrer' })
    if (!response.ok) throw new Error(`Theme download failed (HTTP ${response.status}).`)
    if (!response.body) throw new Error('The theme download was empty.')
    const reader = response.body.getReader(), chunks: Uint8Array[] = []
    let size = 0
    try {
      while (true) {
        const chunk = await reader.read()
        if (chunk.done) break
        size += chunk.value.byteLength
        if (size > limit) throw new Error('The theme document is too large.')
        chunks.push(chunk.value)
      }
    } finally { await reader.cancel().catch(() => {}) }
    const bytes = new Uint8Array(size); let offset = 0
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength }
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } finally { dispose() }
}
export async function loadThemeCatalog(signal?: AbortSignal): Promise<{ catalog: ThemeCatalog; cached: boolean; fetchedAt: number }> {
  try {
    const catalog = parseCatalog(JSON.parse(await fetchThemeText(THEME_CATALOG_URL, 1_000_000, signal)))
    const fetchedAt = Date.now()
    try { localStorage.setItem(CACHE_KEY, JSON.stringify({ catalog, fetchedAt })) } catch { /* Cache quota must not prevent browsing. */ }
    return { catalog, cached: false, fetchedAt }
  } catch (error) {
    if (signal?.aborted) throw error
    try {
      const cached = JSON.parse(localStorage.getItem(CACHE_KEY) ?? 'null')
      if (cached) return { catalog: parseCatalog(cached.catalog), cached: true, fetchedAt: cached.fetchedAt }
    } catch { /* Preserve the original download error. */ }
    throw error
  }
}
export async function verifyRelease(body: string, release: ThemeRelease): Promise<void> {
  const bytes = encoder.encode(body)
  if (bytes.length !== release.bytes) throw new Error('The downloaded theme does not match its listing size.')
  const digest = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))).map(byte => byte.toString(16).padStart(2, '0')).join('')
  if (digest !== release.sha256) throw new Error('The downloaded theme does not match its listing checksum.')
}
export async function prepareRelease(release: ThemeRelease, origin = THEME_CATALOG_URL, updateUrl?: string, signal?: AbortSignal): Promise<PreparedTheme> {
  if (!SUPPORTED_THEME_APIS.includes(release.themeApi)) throw new Error(release.themeApi > THEME_API ? 'This theme needs a newer izumi. Update the client to install it.' : 'This theme needs a different client theme API.')
  const body = await fetchThemeText(release.download, MAX_THEME_BYTES, signal)
  await verifyRelease(body, release)
  const pkg = parseThemePackage(JSON.parse(body))
  if (pkg.id !== release.id || pkg.version !== release.version) throw new Error('The theme identity or version does not match its listing.')
  return { package: pkg, origin, release, updateUrl }
}
export async function prepareThemeLink(link: string, signal?: AbortSignal): Promise<PreparedTheme> {
  const url = themeUrl(link), raw = JSON.parse(await fetchThemeText(url, MAX_THEME_BYTES, signal))
  if (raw?.app === 'izumi' && raw.kind === 'theme-release' && raw.schemaVersion === 1) return prepareRelease(parseRelease(raw.release), url, url, signal)
  return { package: parseSharedTheme(raw), origin: url }
}
export interface LocalThemeFile { name: string; text: string; bytes: number }
/** JSON files and Theme Studio exports from a picker. Folder imports skip non-JSON names. */
export function collectLocalThemes(files: LocalThemeFile[]): { prepared: PreparedTheme[]; errors: string[] } {
  const json = files.filter(file => file.name.toLowerCase().endsWith('.json'))
  if (!json.length) throw new Error('Choose a theme JSON file, or a folder that contains one.')
  const prepared: PreparedTheme[] = []
  const errors: string[] = []
  for (const file of json.slice(0, 24)) {
    try {
      if (file.bytes > MAX_THEME_BYTES) throw new Error('Use a theme package under 256 KB.')
      const pkg = parseSharedTheme(JSON.parse(file.text))
      prepared.push({ package: pkg, origin: `file:${pkg.id}` })
    } catch (cause) {
      errors.push(`${file.name}: ${cause instanceof Error ? cause.message : 'Could not load this theme.'}`)
    }
  }
  if (!prepared.length) throw new Error(errors[0] ?? 'No valid theme packages in that selection.')
  return { prepared, errors }
}
