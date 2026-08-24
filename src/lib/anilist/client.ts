import { Client, fetchExchange } from '@urql/core'
import { authExchange } from '@urql/exchange-auth'
import { cacheExchange } from '@urql/exchange-graphcache'
import { invokeNativeHttp } from '$lib/net/http'
// `bottleneck/light`, NOT `bottleneck`: the package declares only `main` (no browser/module/exports
// field), so the bundler resolves the full Node build and drags RedisConnection, IORedisConnection,
// RedisDatastore and an 18KB lua.json into a chunk that is modulepreloaded before first paint.
// We only use the local datastore (reservoir / maxConcurrent / minTime / updateSettings), all of
// which light.js has.
import Bottleneck from 'bottleneck/light'
import { anilistToken, getToken } from './auth'
import { ANILIST_CACHE_KEYS } from './cache'
import {
  aniListCatalogFailure, aniListNetworkFailure, fetchJikanCatalog, parseJikanCatalogRequest,
} from './jikan'
import {
  fetchKitsuCatalog, fetchKitsuDetail, parseKitsuDetailRequest, type KitsuDetailRequest,
} from './kitsu-catalog'
import {
  clearAniListDegraded, markAniListDegraded, markCatalogProvider,
  markJikanCatalogUnavailable, shouldUseJikanCatalog,
} from './degraded'

// Normalize any HeadersInit (Headers | array | record) to a plain object for the
// Rust command.
function headersToObject(h?: HeadersInit): Record<string, string> {
  const o: Record<string, string> = {}
  if (!h) return o
  if (h instanceof Headers) h.forEach((v, k) => { o[k] = v })
  else if (Array.isArray(h)) for (const [k, v] of h) o[k] = v
  else Object.assign(o, h)
  return o
}

// AniList over the NATIVE, POOLED Rust HTTP client (`http_post`) — NOT the webview
// `fetch` (CORS-bound: breaks when AniList drops `Access-Control-Allow-Origin`) and NOT
// `@tauri-apps/plugin-http`'s `fetch` (its lazily-read response resource gets invalidated
// under urql's concurrent queries → "resource id N is invalid"). We materialize the whole
// response in Rust and hand urql a real `Response`, so the 429 `Retry-After` header and body
// parsing work exactly as with a browser fetch — just without CORS or a streamed resource.
async function nativeFetch(
  input: RequestInfo | URL,
  init?: RequestInit,
  onRequestStart?: () => void,
): Promise<Response> {
  if (init?.signal?.aborted) throw new DOMException('The request was aborted', 'AbortError')
  onRequestStart?.()
  const url = typeof input === 'string' ? input : input.toString()
  const body = typeof init?.body === 'string' ? init.body : ''
  const headers = headersToObject(init?.headers)
  const r = await invokeNativeHttp<{ status: number; headers: Record<string, string>; body: string }>(
    'http_post',
    { url, body, headers },
    // The Rust bridge has a 30s default, but catalogue screens have working backup providers.
    // Fail over while the loading UI is still useful instead of making a Deck look frozen.
    { signal: init?.signal ?? undefined, timeoutMs: 15_000 },
  )
  return new Response(r.body, { status: r.status, headers: r.headers })
}

// AniList runs in a DEGRADED state capped at 30 requests/minute per IP (verified live via
// `X-RateLimit-Limit: 30`; the pre-2023 limit was 90). Login does NOT raise it — it's per-IP;
// auth is only for progress-sync. Pre-throttle with Bottleneck to stay under the real cap so
// bursts degrade to a queue instead of tripping the 429 backoff below. `seedReservoirFromLimit`
// re-reads the header on each response and auto-corrects if AniList ever restores 90.
const RATE_LIMIT = 30
const limiter = new Bottleneck({
  reservoir: RATE_LIMIT,
  reservoirRefreshAmount: RATE_LIMIT,
  reservoirRefreshInterval: 60_000,
  // AniList also has a separate (undocumented-size) burst limiter. Three overlapping requests keep
  // Schedule pagination quick without the six-at-100ms burst that could put every Browse query into
  // a one-minute 429 window at once.
  maxConcurrent: 3,
  minTime: 350,
})

/** Bottleneck priority for a serialized GraphQL request (0 = first, 9 = last). A navigation to a
 * detail/search/schedule screen must not wait behind lazy catalogue rows from the page being left. */
export function anilistRequestPriority(body: BodyInit | null | undefined): number {
  if (typeof body !== 'string') return 3
  try {
    const parsed = JSON.parse(body) as { query?: unknown }
    if (typeof parsed.query !== 'string') return 3
    if (/\bmutation\b/.test(parsed.query)) return 0
    const operation = /\bquery\s+([A-Za-z_][A-Za-z0-9_]*)/.exec(parsed.query)?.[1]
    if (!operation) return 3
    if (/^(MediaById|SourceMediaById|ReadingMediaById|Schedule|Search|SearchAll)$/.test(operation)) return 1
    if (/^Hero/.test(operation)) return 2
    if (/^(Lists|ListPreview|ListStatuses|ReadingLists|ListIds|MediaByIds|MediaByMal|ReadingMediaByMal)$/.test(operation)) return 4
    if (/^(Page|PageAll|PersonalRecommendations|RecentReleases)$/.test(operation)) return 7
    return 3
  } catch {
    return 3
  }
}

export interface AniListRateLimitHeaders {
  limit?: number
  remaining?: number
  resetAtMs?: number
}

/** Parse AniList's server-authoritative quota state. Kept pure so header edge cases are testable. */
export function parseRateLimitHeaders(headers: Headers): AniListRateLimitHeaders {
  const positive = (name: string) => {
    const raw = headers.get(name)
    if (raw == null || raw.trim() === '') return undefined
    const value = Number(raw)
    return Number.isFinite(value) && value > 0 ? value : undefined
  }
  const nonNegative = (name: string) => {
    const raw = headers.get(name)
    if (raw == null || raw.trim() === '') return undefined
    const value = Number(raw)
    return Number.isFinite(value) && value >= 0 ? value : undefined
  }
  const resetSeconds = positive('x-ratelimit-reset')
  return {
    limit: positive('x-ratelimit-limit'),
    remaining: nonNegative('x-ratelimit-remaining'),
    resetAtMs: resetSeconds == null ? undefined : resetSeconds * 1000,
  }
}

// AniList's headers are authoritative for the whole public IP, including calls made by discussion
// providers or another izumi process. Mirror a LOWER server remainder into Bottleneck so those
// out-of-band calls cannot leave this client believing it has tokens that no longer exist.
let knownLimit = RATE_LIMIT
let knownResetAtMs = 0
let resetTimer: ReturnType<typeof setTimeout> | undefined
async function syncReservoirFromHeaders(res: Response) {
  const { limit, remaining, resetAtMs } = parseRateLimitHeaders(res.headers)
  if (limit != null && limit !== knownLimit) {
    knownLimit = limit
    await limiter.updateSettings({ reservoirRefreshAmount: limit })
  }
  if (remaining != null) {
    const current = await limiter.currentReservoir()
    if (current != null && remaining < current) await limiter.incrementReservoir(remaining - current)
  }
  // Bottleneck's periodic refresh is anchored to app startup, whereas AniList's window is not.
  // Wake queued work at the server's actual reset too; the next response immediately corrects the
  // count downward if another consumer on the same IP spent tokens in the meantime.
  if (resetAtMs != null && resetAtMs !== knownResetAtMs) {
    knownResetAtMs = resetAtMs
    if (resetTimer) clearTimeout(resetTimer)
    const delay = Math.max(0, resetAtMs - Date.now()) + 50
    resetTimer = setTimeout(() => {
      knownResetAtMs = 0
      void limiter.updateSettings({ reservoir: knownLimit })
    }, delay)
  }
}

// Shared cooldown: once AniList reports a 429, public reads immediately use their existing backup
// provider. Waiting out Retry-After inside the limiter used to hold all slots (and all skeletons)
// for as much as five minutes.
let cooldownUntil = 0

function rateLimitDelayMs(res: Response, now = Date.now()): number {
  const retryAfter = res.headers.get('retry-after')
  const reset = res.headers.get('x-ratelimit-reset')
  let ms: number
  if (retryAfter) ms = Number(retryAfter) * 1000
  else if (reset) ms = Number(reset) * 1000 - now
  else ms = 60_000
  return Number.isFinite(ms) ? Math.min(Math.max(ms, 1000), 65_000) : 60_000
}

async function openRateLimitCooldown(wait: number): Promise<void> {
  cooldownUntil = Math.max(cooldownUntil, Date.now() + wait)
  // Keep one control-plane token available so already-queued jobs can enter their callback, see
  // the cooldown and settle. They refund it without touching AniList.
  await limiter.updateSettings({ reservoir: 1 })
  if (resetTimer) clearTimeout(resetTimer)
  knownResetAtMs = cooldownUntil
  resetTimer = setTimeout(() => {
    cooldownUntil = 0
    knownResetAtMs = 0
    void limiter.updateSettings({ reservoir: knownLimit })
  }, Math.max(0, cooldownUntil - Date.now()) + 50)
}

function rateLimitedResponse(waitMs: number): Response {
  const seconds = Math.max(1, Math.ceil(waitMs / 1000))
  return Response.json(
    { data: null, errors: [{ message: 'Too Many Requests.', status: 429 }] },
    { status: 429, headers: { 'retry-after': String(seconds) } },
  )
}

function activeCooldownResponse(now = Date.now()): Response | null {
  const wait = cooldownUntil - now
  return wait > 0 ? rateLimitedResponse(wait) : null
}

function abortError(): DOMException {
  return new DOMException('The request was aborted', 'AbortError')
}

/** Bottleneck cannot remove an individual queued job. Settle the urql operation on abort anyway;
 * when the orphan reaches the callback it observes the same signal, avoids the network and refunds
 * the reservoir token. This prevents navigation-away work from pinning a new page's skeleton. */
function settleOnAbort<T>(pending: Promise<T>, signal?: AbortSignal | null): Promise<T> {
  if (!signal) return pending
  if (signal.aborted) return Promise.reject(abortError())
  return new Promise<T>((resolve, reject) => {
    const aborted = () => { cleanup(); reject(abortError()) }
    const cleanup = () => signal.removeEventListener('abort', aborted)
    signal.addEventListener('abort', aborted, { once: true })
    pending.then(
      (value) => { cleanup(); resolve(value) },
      (error) => { cleanup(); reject(error) },
    )
  })
}

async function fetchAniList(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  if (init?.signal?.aborted) throw abortError()
  const coolingDown = activeCooldownResponse()
  if (coolingDown) return coolingDown

  // A depleted local reservoir normally makes Bottleneck queue until its minute tick. There is no
  // value in keeping the UI in a loading state meanwhile: surface a 429-shaped response so public
  // screens can use their backup and account operations can fail normally.
  const remaining = await limiter.currentReservoir()
  if (remaining === 0) {
    const wait = knownResetAtMs > Date.now() ? knownResetAtMs - Date.now() : 60_000
    cooldownUntil = Math.max(cooldownUntil, Date.now() + wait)
    return rateLimitedResponse(wait)
  }

  const scheduled = limiter.schedule(
    { priority: anilistRequestPriority(init?.body) },
    async () => {
      let requestStarted = false
      try {
        // A different in-flight request may have opened the cooldown while this job was queued.
        const blocked = activeCooldownResponse()
        if (blocked) return blocked
        const response = await nativeFetch(input, init, () => { requestStarted = true })
        await syncReservoirFromHeaders(response)
        // `remaining: 0` on an otherwise successful final response is just as important as a 429:
        // Bottleneck has already queued later rows. Open the local cooldown while returning this
        // successful response unchanged, allowing those rows to fail over instead of waiting a
        // minute for the reservoir refresh.
        const quotaExhausted = parseRateLimitHeaders(response.headers).remaining === 0
        if (response.status === 429 || quotaExhausted) {
          const wait = rateLimitDelayMs(response)
          await openRateLimitCooldown(wait)
        }
        return response
      } finally {
        if (!requestStarted) await limiter.incrementReservoir(1)
      }
    },
  ) as Promise<Response>
  return settleOnAbort(scheduled, init?.signal)
}

/** AniList stays authoritative. Only named, public catalog queries can cross this boundary: after a
 *  hard availability failure they receive an equivalent Jikan-shaped GraphQL response, while
 *  detail/account/tracker operations keep their normal AniList errors and retry semantics. */
type BackupRequest =
  | { kind: 'catalog'; request: NonNullable<ReturnType<typeof parseJikanCatalogRequest>> }
  | { kind: 'detail'; request: KitsuDetailRequest }

async function fetchFromBackup(request: BackupRequest): Promise<Response> {
  if (request.kind === 'detail') {
    const response = await fetchKitsuDetail(request.request)
    markCatalogProvider('Kitsu')
    return response
  }
  let kitsuError: unknown
  try {
    // Kitsu is independent of MyAnimeList. Try it first: Jikan can be healthy while its upstream
    // MAL dependency is down, which otherwise makes every degraded row wait through retries.
    const response = await fetchKitsuCatalog(request.request)
    markCatalogProvider('Kitsu')
    return response
  } catch (error) {
    kitsuError = error
  }
  try {
    const response = await fetchJikanCatalog(request.request)
    markCatalogProvider('Jikan')
    return response
  } catch (jikanError) {
    const kitsu = kitsuError instanceof Error ? kitsuError.message : String(kitsuError)
    const jikan = jikanError instanceof Error ? jikanError.message : String(jikanError)
    markJikanCatalogUnavailable(`Kitsu: ${kitsu}\nJikan: ${jikan}`)
    throw jikanError
  }
}

async function fetchWithCatalogFallback(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const catalog = parseJikanCatalogRequest(init?.body)
  const detail = parseKitsuDetailRequest(init?.body)
  const backup: BackupRequest | null = catalog
    ? { kind: 'catalog', request: catalog }
    : detail ? { kind: 'detail', request: detail } : null
  if (backup && shouldUseJikanCatalog()) {
    try { return await fetchFromBackup(backup) }
    catch { /* Every backup is unavailable too — let the once-per-minute AniList probe run. */ }
  }

  // The request may have been created before the first 429 marked the degraded state. Re-check the
  // transport cooldown here so those already-mounted Browse rows also bypass the limiter promptly.
  if (backup && activeCooldownResponse()) {
    try { return await fetchFromBackup(backup) }
    catch { /* Preserve the normal AniList-shaped 429 error below. */ }
  }

  try {
    // Only actual AniList traffic spends AniList reservoir tokens. Once the circuit is open,
    // Jikan-backed rows must not stall behind or drain the failed service's quota queue.
    const response = await fetchAniList(input, init)
    if (!backup) return response
    const failure = await aniListCatalogFailure(response)
    if (!failure) {
      clearAniListDegraded()
      return response
    }
    markAniListDegraded(failure)
    try { return await fetchFromBackup(backup) }
    catch { return response }
  } catch (error) {
    // Navigation cancellation is expected, not an AniList outage. Starting Kitsu/Jikan work for a
    // screen that no longer exists only creates more contention for the screen being entered.
    if (error instanceof Error && error.name === 'AbortError') throw error
    if (!backup) throw error
    markAniListDegraded(aniListNetworkFailure(error))
    try { return await fetchFromBackup(backup) }
    catch { throw error }
  }
}

/** Exported for transport-level regression tests; application callers should use `anilist`. */
export const anilistFetch: typeof fetch = (input, init) =>
  fetchWithCatalogFallback(input as RequestInfo | URL, init)

function createAnilistClient() {
  return new Client({
    url: 'https://graphql.anilist.co',
    // AniList's GraphQL endpoint only accepts POST. urql v6 defaults
    // preferGetMethod to 'within-url-limit' (GET for short queries) -> 404.
    preferGetMethod: false,
    exchanges: [
      cacheExchange({ keys: ANILIST_CACHE_KEYS }),
      authExchange(async (utils) => ({
        addAuthToOperation(op) {
          const t = getToken()
          return t ? utils.appendHeaders(op, { Authorization: `Bearer ${t}` }) : op
        },
        didAuthError: () => false,
        refreshAuth: async () => {},
      })),
      fetchExchange,
    ],
    fetch: anilistFetch,
  })
}

// The normalized cache holds per-VIEWER fields (the detail query's `mediaListEntry` progress/
// status/score), so it MUST NOT outlive the account it was filled for — otherwise a disconnect or
// an account switch keeps serving account A's list entries to account B, and our write-back would
// then push A's progress into B's list. Graphcache has no public "clear", so the documented reset
// is to build a whole new Client, which is what the token subscription below does.
let activeToken = getToken()
let client = createAnilistClient()

// `subscribe` fires immediately with the persisted token at startup, and svelte-persisted-store
// also re-emits on cross-tab storage events — so only a CHANGED token may rebuild, or we'd throw
// away the client (and its warm cache) on every tick.
anilistToken.subscribe((t) => {
  if (t === activeToken) return
  activeToken = t
  client = createAnilistClient()
})

// A stable facade over the current client. Module imports are live bindings and would have followed
// a reassigned export on their own, but `setContextClient` is a plain `setContext` that captures the
// client BY VALUE at component init — so everything reached through `getContextClient()` would stay
// pinned to the discarded instance. A facade with one unchanging identity is what keeps those
// consumers correct. Methods are bound to the live client so they close over its own state, not the
// facade's.
export const anilist = new Proxy({} as Client, {
  get(_target, prop) {
    const value = Reflect.get(client, prop) as unknown
    return typeof value === 'function' ? value.bind(client) : value
  },
})
