import { Client, fetchExchange } from '@urql/core'
import { authExchange } from '@urql/exchange-auth'
import { cacheExchange } from '@urql/exchange-graphcache'
import Bottleneck from 'bottleneck'
import { getToken } from './auth'

// AniList's limit is ~90 requests/minute per IP (login does NOT raise it — it's per-IP;
// auth is only for progress-sync). Pre-throttle with Bottleneck to stay under it.
const limiter = new Bottleneck({
  reservoir: 90,
  reservoirRefreshAmount: 90,
  reservoirRefreshInterval: 60_000,
  maxConcurrent: 2,
  minTime: 220,
})

const sleep = (ms: number) => new Promise((r) => setTimeout(r, Math.max(0, ms)))

// Shared cooldown: when ANY request gets a 429, every other in-flight/queued request
// waits it out too, so a burst degrades to a brief pause instead of a storm of 429s.
let cooldownUntil = 0

// On 429, honor `Retry-After` (seconds) or `X-RateLimit-Reset` (unix seconds), pause, and
// retry (bounded) — the request eventually succeeds instead of surfacing as an error.
async function fetchWithBackoff(input: RequestInfo | URL, init?: RequestInit, attempt = 0): Promise<Response> {
  const wait = cooldownUntil - Date.now()
  if (wait > 0) await sleep(wait)
  const res = await fetch(input, init)
  if (res.status !== 429 || attempt >= 5) return res
  const retryAfter = res.headers.get('retry-after')
  const reset = res.headers.get('x-ratelimit-reset')
  let ms: number
  if (retryAfter) ms = Number(retryAfter) * 1000
  else if (reset) ms = Number(reset) * 1000 - Date.now()
  else ms = 1000 * 2 ** attempt // exponential fallback
  ms = Math.min(Math.max(ms, 1000), 65_000)
  cooldownUntil = Date.now() + ms
  await sleep(ms)
  return fetchWithBackoff(input, init, attempt + 1)
}

const limitedFetch: typeof fetch = (input, init) =>
  limiter.schedule(() => fetchWithBackoff(input as RequestInfo | URL, init)) as Promise<Response>

export const anilist = new Client({
  url: 'https://graphql.anilist.co',
  // AniList's GraphQL endpoint only accepts POST. urql v6 defaults
  // preferGetMethod to 'within-url-limit' (GET for short queries) -> 404.
  preferGetMethod: false,
  exchanges: [
    cacheExchange({}),
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
  fetch: limitedFetch,
})
