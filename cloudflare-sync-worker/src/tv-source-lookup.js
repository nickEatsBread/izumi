// A narrow, credential-free source adapter. Never forward an arbitrary configured URL to a TV.
const PUBLIC_OPTIONS = new Set(['providers', 'sort', 'language', 'qualityfilter', 'limit', 'sizefilter'])
const MAX_REQUESTS = 6
const MAX_STREAMS = 80
const TICKET_TTL_MS = 120_000
const encoder = new TextEncoder()

/** Both transports accept metadata only; authority remains with the configured resolver. */
export function sanitizeTvSourceStreams(streams) {
  if (!Array.isArray(streams) || streams.length > MAX_STREAMS) throw new Error('Invalid TV source results.')
  const text = (value, size) => typeof value === 'string' ? value.slice(0, size) : undefined
  return streams.flatMap(stream => {
    if (!stream || typeof stream.infoHash !== 'string' || !/^(?:[a-f0-9]{40}|[a-z2-7]{32})$/i.test(stream.infoHash)) return []
    return [{ infoHash: stream.infoHash,
      fileIdx: Number.isInteger(stream.fileIdx) && stream.fileIdx >= 0 ? stream.fileIdx : undefined,
      name: text(stream.name, 300), title: text(stream.title, 700), description: text(stream.description, 700),
      sources: Array.isArray(stream.sources) ? stream.sources.filter(value => typeof value === 'string' && value.length <= 512 && /^tracker:(?:https?|udp):\/\//i.test(value)).slice(0, 8) : [],
      behaviorHints: { filename: text(stream.behaviorHints?.filename, 500), videoSize: Number(stream.behaviorHints?.videoSize) || undefined },
    }]
  })
}

export function tvSourceRequests(base, ids, type, addonIndex) {
  const url = new URL(base)
  if (url.origin !== 'https://torrentio.strem.fun' || !['movie', 'series', 'anime'].includes(type)) return []
  let path
  try { path = decodeURIComponent(url.pathname).replace(/^\/+|\/+$/g, '') } catch { return [] }
  // Only known non-secret preferences survive. Debrid credentials, unknown options, queries,
  // and arbitrary path segments are never included in the home-network request.
  const options = path.split('|').filter((option) => {
    const [key, value, extra] = option.split('=')
    return PUBLIC_OPTIONS.has(key) && !extra && value && value.length <= 256 && /^[a-z0-9,.:_-]+$/i.test(value)
  })
  const publicBase = `${url.origin}${options.length ? '/' + options.join('|') : ''}`
  return ids.filter((id) => /^(?:tt\d+(?::\d+:\d+)?|kitsu:\d+(?::\d+)?)$/.test(id)).slice(0, MAX_REQUESTS).map((id, index) => ({
    id: `torrentio-${addonIndex}-${index}`,
    url: `${publicBase}/stream/${type}/${encodeURIComponent(id)}.json`,
  }))
}

function base64(bytes) {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function unbase64(value) {
  return Uint8Array.from(atob(value.replace(/-/g, '+').replace(/_/g, '/')), (char) => char.charCodeAt(0))
}

async function profileHash(profile) {
  return base64(new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(JSON.stringify(profile)))))
}

async function signingKey(profile) {
  if (!profile.debrid?.credential) throw new Error('TV-assisted torrent lookup requires a saved debrid provider.')
  return crypto.subtle.importKey('raw', encoder.encode(`izumi-tv-source-v1:${profile.debrid.credential}`), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify'])
}

export async function createTvSourceLookup(profile, request, plan, requests, context) {
  if (!requests.length || !profile.debrid) return undefined
  const issuedAt = context.startedAt ?? Date.now()
  const lookup = {
    version: 1, issuedAt, expiresAt: issuedAt + TICKET_TTL_MS,
    pairingId: context.pairingId, profileId: context.profileId ?? 'default',
    profileHash: await profileHash(profile), request, plan,
    requests: requests.slice(0, MAX_REQUESTS),
  }
  const payload = base64(encoder.encode(JSON.stringify(lookup)))
  const signature = base64(new Uint8Array(await crypto.subtle.sign('HMAC', await signingKey(profile), encoder.encode(payload))))
  return { version: 1, ticket: `${payload}.${signature}`, requests: lookup.requests }
}

export async function verifyTvSourceLookup(profile, request, value, context) {
  const invalid = () => new Error('TV source lookup expired or changed. Start playback again.')
  if (!value || typeof value.ticket !== 'string' || value.ticket.length > 32_768) throw invalid()
  let lookup
  try {
    const [payload, signature, extra] = value.ticket.split('.')
    if (!payload || !signature || extra || !await crypto.subtle.verify('HMAC', await signingKey(profile), unbase64(signature), encoder.encode(payload))) throw invalid()
    lookup = JSON.parse(new TextDecoder().decode(unbase64(payload)))
  } catch { throw invalid() }
  if (lookup.version !== 1 || lookup.expiresAt <= Date.now() || lookup.issuedAt > Date.now()
    || lookup.pairingId !== context.pairingId || lookup.profileId !== (context.profileId ?? 'default')
    || lookup.profileHash !== await profileHash(profile) || JSON.stringify(lookup.request) !== JSON.stringify(request)) throw invalid()
  if (!Array.isArray(value.results) || !value.results.length || value.results.length > MAX_REQUESTS) throw new Error('Invalid TV source results.')
  const expected = new Set(lookup.requests.map((entry) => entry.id))
  const received = new Set()
  const streams = []
  for (const result of value.results) {
    if (!expected.has(result?.id) || received.has(result.id) || !Array.isArray(result.streams) || result.streams.length > MAX_STREAMS) throw new Error('Invalid TV source results.')
    received.add(result.id)
    // The TV returns metadata only. A caller cannot use this route to fetch a supplied URL,
    // inject player headers, or override ranking/cache evidence generated inside the Worker.
    streams.push(...sanitizeTvSourceStreams(result.streams))
  }
  return { issuedAt: lookup.issuedAt, plan: lookup.plan, streams }
}

/** Consume exactly the initial lookup's rate-limit stamp, once. Later play requests supersede it. */
export async function consumeTvSourceLookup(db, pairingId, issuedAt, now = Date.now()) {
  const result = await db.prepare('UPDATE companion_pairings SET last_resolve_at = ? WHERE pairing_id = ? AND last_resolve_at = ?')
    .bind(Math.max(now, issuedAt + 1), pairingId, issuedAt).run()
  return Number(result.meta?.changes || 0) > 0
}
