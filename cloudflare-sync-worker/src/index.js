import { resolveSubtitleDownload } from './subtitle-services.js'
import { subtitleTicket, downloadSubtitle } from './subtitle-delivery.js'
import webpush from 'web-push'
import { accountScope, accountServices, accountSources, accountMedia, withAccount, readAccounts, manageAccount, pullAccount, pullAccountCollections, pushAccountProgress } from './accounts.js'
import { collectionOptions, collectionSnapshot, normalizeCollections } from './collection-catalog.js'
import { commitChunkedRecord, putRecordChunk } from './record-chunks.js'
import { validSnapshotSelector, viewerForRequest, viewerAllows, scopeSnapshot } from './profiles.js'
import { consumeTvSourceLookup } from './tv-source-lookup.js'
import { runWorkerUpdate, workerUpdateStatus } from './worker-update.js'
import { createClientLinkApi, companionOwnerDevice, companionMemberPairing } from './client-links.js'
import {
  defaultResolverProfile,
  normalizeResolverProfile,
  publicResolverProfile,
  prepareTvSourceContinuation,
  resolveCatalogSnapshot,
  resolveDirectSources,
  resolveMediaDetails,
  searchCatalog,
} from './resolver.js'

const VERSION = '1.12.0'
const PROTOCOL = 1
const CATEGORIES = new Set(['watch', 'manual', 'presence', 'companion', 'profiles'])
const MAX_BODY_BYTES = 512 * 1024
const MAX_DEVICES = 32
const MAX_INVITES = 16
const MAX_COMPANION_PAIRINGS = 16
const MAX_COMPANION_PUSH_SUBSCRIPTIONS = 8
const MAX_COMPANION_REQUEST_BYTES = 12 * 1024
const MAX_COMPANION_REQUESTS = 32
const MAX_COMPANION_PROGRESS = 200
const MAX_COMPANION_TRAILERS = 32
const INVITE_TTL_MS = 10 * 60 * 1000
const ENROLLMENT_TTL_MS = 10 * 60 * 1000
const COMPANION_REQUEST_TTL_MS = 5 * 60 * 1000
const COMPANION_TRAILER_TTL_MS = 10 * 60 * 1000
const RESOLVER_MIN_INTERVAL_MS = 1_500
const CATALOG_MIN_INTERVAL_MS = 750
const DETAILS_MIN_INTERVAL_MS = 350
const encoder = new TextEncoder()

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type, X-Izumi-Bootstrap, X-Izumi-Client-Link',
  'Access-Control-Max-Age': '86400',
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
    },
  })
}

function documentResponse(source) {
  return new Response(source, {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      'Content-Security-Policy': "default-src 'none'; script-src 'self'; style-src 'unsafe-inline'; connect-src 'self'; img-src 'self'; manifest-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
      'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
      'Referrer-Policy': 'no-referrer',
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
    },
  })
}

function scriptResponse(source) {
  return new Response(source, {
    headers: {
      'Content-Type': 'text/javascript; charset=utf-8',
      'Cache-Control': 'no-store',
      'Service-Worker-Allowed': '/v1/companion/',
      'X-Content-Type-Options': 'nosniff',
    },
  })
}

function base64Url(bytes) {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

async function hash(value) {
  return base64Url(new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(value))))
}

function constantTimeEqual(left, right) {
  const a = encoder.encode(left)
  const b = encoder.encode(right)
  let difference = a.length ^ b.length
  for (let index = 0; index < Math.max(a.length, b.length); index++) {
    difference |= (a[index] || 0) ^ (b[index] || 0)
  }
  return difference === 0
}

function validId(value) {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{16,80}$/.test(value)
}

function validToken(value) {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{32,128}$/.test(value)
}

function validInviteCode(value) {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{20,64}$/.test(value)
}

function validPushValue(value, minimum = 16, maximum = 512) {
  return typeof value === 'string' && value.length >= minimum && value.length <= maximum && /^[A-Za-z0-9_-]+$/.test(value)
}

function validPushEndpoint(value) {
  if (typeof value !== 'string' || value.length > 2048) return false
  try { return new URL(value).protocol === 'https:' } catch { return false }
}

function cleanName(value) {
  return typeof value === 'string' ? value.trim().slice(0, 80) || 'Izumi device' : 'Izumi device'
}

async function body(request) {
  const announced = Number(request.headers.get('content-length') || 0)
  if (announced > MAX_BODY_BYTES) throw new Error('PAYLOAD_TOO_LARGE')
  const text = await request.text()
  if (encoder.encode(text).byteLength > MAX_BODY_BYTES) throw new Error('PAYLOAD_TOO_LARGE')
  return JSON.parse(text || '{}')
}

async function claimed(env) {
  return !!(await env.DB.prepare("SELECT value FROM metadata WHERE key = 'claimed'").first())
}

async function authenticate(request, env) {
  const header = request.headers.get('authorization') || ''
  if (!header.startsWith('Bearer ')) return null
  const token = header.slice(7)
  if (!validToken(token)) return null
  const tokenHash = await hash(token)
  const device = await env.DB.prepare('SELECT id FROM devices WHERE token_hash = ?').bind(tokenHash).first()
  if (!device) return null
  await env.DB.prepare('UPDATE devices SET last_seen = ? WHERE id = ?').bind(Date.now(), device.id).run()
  return String(device.id)
}

async function claim(request, env) {
  if (await claimed(env)) return json({ error: 'This Worker has already been claimed.' }, 409)
  const supplied = request.headers.get('x-izumi-bootstrap') || ''
  if (!validToken(supplied) || !constantTimeEqual(supplied, env.BOOTSTRAP_SECRET || '')) {
    return json({ error: 'The setup secret does not match this Worker.' }, 401)
  }
  const value = await body(request)
  if (!validId(value.deviceId) || !validToken(value.deviceToken)) return json({ error: 'Invalid device credentials.' }, 400)
  const now = Date.now()
  try {
    await env.DB.batch([
      env.DB.prepare("INSERT INTO metadata (key, value) VALUES ('claimed', ?)").bind(String(now)),
      env.DB.prepare('INSERT INTO devices (id, token_hash, name, created_at, last_seen) VALUES (?, ?, ?, ?, ?)')
        .bind(value.deviceId, await hash(value.deviceToken), cleanName(value.deviceName), now, now),
    ])
  } catch {
    if (await claimed(env)) return json({ error: 'This Worker has already been claimed.' }, 409)
    throw new Error('Could not initialize the Worker database.')
  }
  return json({ ok: true })
}

async function createInvite(request, env) {
  const deviceId = await authenticate(request, env)
  if (!deviceId) return json({ error: 'Authentication failed.' }, 401)
  const now = Date.now()
  await env.DB.prepare('DELETE FROM invites WHERE expires_at <= ?').bind(now).run()
  const count = await env.DB.prepare('SELECT COUNT(*) AS count FROM invites').first()
  if (Number(count?.count || 0) >= MAX_INVITES) return json({ error: 'Too many active invites. Wait for one to expire.' }, 429)
  const bytes = crypto.getRandomValues(new Uint8Array(18))
  const code = base64Url(bytes)
  await env.DB.prepare('INSERT INTO invites (code_hash, expires_at) VALUES (?, ?)')
    .bind(await hash(code), now + INVITE_TTL_MS).run()
  return json({ code, expiresAt: now + INVITE_TTL_MS })
}

async function join(request, env) {
  const value = await body(request)
  if (!validInviteCode(value.code) || !validId(value.deviceId) || !validToken(value.deviceToken)) {
    return json({ error: 'The invite or device credentials are invalid.' }, 400)
  }
  const now = Date.now()
  const codeHash = await hash(value.code)
  const invite = await env.DB.prepare('SELECT expires_at FROM invites WHERE code_hash = ?').bind(codeHash).first()
  if (!invite || Number(invite.expires_at) <= now) return json({ error: 'This invite is invalid or has expired.' }, 401)
  const count = await env.DB.prepare('SELECT COUNT(*) AS count FROM devices').first()
  if (Number(count?.count || 0) >= MAX_DEVICES) return json({ error: 'This Worker already has the maximum number of devices.' }, 409)
  try {
    await env.DB.batch([
      env.DB.prepare('INSERT INTO devices (id, token_hash, name, created_at, last_seen) SELECT ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM invites WHERE code_hash = ? AND expires_at > ?)')
        .bind(value.deviceId, await hash(value.deviceToken), cleanName(value.deviceName), now, now, codeHash, now),
      env.DB.prepare('DELETE FROM invites WHERE code_hash = ?').bind(codeHash),
    ])
    const joined = await env.DB.prepare('SELECT id FROM devices WHERE id = ?').bind(value.deviceId).first()
    if (!joined) return json({ error: 'This invite was already used.' }, 409)
  } catch {
    return json({ error: 'This invite was already used, or the device is already registered.' }, 409)
  }
  return json({ ok: true })
}

async function records(request, env, category) {
  if (!CATEGORIES.has(category) && !/^watch-[A-Za-z0-9_-]{1,100}$/.test(category)) return json({ error: 'Unknown sync category.' }, 404)
  const deviceId = await authenticate(request, env)
  if (!deviceId) return json({ error: 'Authentication failed.' }, 401)
  if (request.method === 'GET') {
    const result = await env.DB.prepare('SELECT device_id AS deviceId, payload, updated_at AS updatedAt FROM records WHERE category = ? ORDER BY updated_at DESC')
      .bind(category).all()
    return json({ records: result.results || [] })
  }
  const value = await body(request)
  if (typeof value.payload !== 'string' || encoder.encode(value.payload).byteLength > MAX_BODY_BYTES) {
    return json({ error: 'Encrypted sync payload is missing or too large.' }, 413)
  }
  if (value.chunks !== undefined) return commitChunkedRecord(env, category, deviceId, value, json)
  await env.DB.prepare(
    "INSERT INTO records (category, device_id, payload, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(category, device_id) DO UPDATE SET payload = excluded.payload, updated_at = excluded.updated_at, chunk_ids = '[]'",
  ).bind(category, deviceId, value.payload, Date.now()).run()
  return json({ ok: true })
}

async function recordChunk(request, env, category, ownerId, chunkId) {
  if (!CATEGORIES.has(category) && !/^watch-[A-Za-z0-9_-]{1,100}$/.test(category)) return json({ error: 'Unknown sync category.' }, 404)
  const deviceId = await authenticate(request, env)
  if (!deviceId) return json({ error: 'Authentication failed.' }, 401)
  if (request.method === 'PUT') {
    if (ownerId !== deviceId) return json({ error: 'Cannot change another device’s library.' }, 403)
    return putRecordChunk(env, category, deviceId, chunkId, await body(request), json)
  }
  const row = await env.DB.prepare('SELECT payload FROM record_chunks WHERE category = ? AND device_id = ? AND chunk_id = ?')
    .bind(category, ownerId, chunkId).first()
  return row ? json(row) : json({ error: 'Library chunk is no longer available. Retry sync.' }, 404)
}

async function ensureVapidKeys(env) {
  const result = await env.DB.prepare("SELECT key, value FROM metadata WHERE key IN ('companion_vapid_public', 'companion_vapid_private')").all()
  const values = Object.fromEntries((result.results || []).map((entry) => [entry.key, entry.value]))
  if (values.companion_vapid_public && values.companion_vapid_private) {
    return { publicKey: values.companion_vapid_public, privateKey: values.companion_vapid_private }
  }
  const generated = webpush.generateVAPIDKeys()
  await env.DB.batch([
    env.DB.prepare("INSERT OR IGNORE INTO metadata (key, value) VALUES ('companion_vapid_public', ?)").bind(generated.publicKey),
    env.DB.prepare("INSERT OR IGNORE INTO metadata (key, value) VALUES ('companion_vapid_private', ?)").bind(generated.privateKey),
  ])
  const stored = await env.DB.prepare("SELECT key, value FROM metadata WHERE key IN ('companion_vapid_public', 'companion_vapid_private')").all()
  const resolved = Object.fromEntries((stored.results || []).map((entry) => [entry.key, entry.value]))
  if (!resolved.companion_vapid_public || !resolved.companion_vapid_private) throw new Error('Could not initialize Web Push keys.')
  return { publicKey: resolved.companion_vapid_public, privateKey: resolved.companion_vapid_private }
}

async function cleanupCompanion(env, now = Date.now()) {
  await env.DB.batch([
    env.DB.prepare('DELETE FROM companion_enrollments WHERE expires_at <= ?').bind(now),
    env.DB.prepare("UPDATE companion_requests SET state = 'expired', updated_at = ? WHERE expires_at <= ? AND state NOT IN ('accepted', 'cancelled', 'expired')").bind(now, now),
    env.DB.prepare('DELETE FROM companion_requests WHERE expires_at <= ?').bind(now - 24 * 60 * 60 * 1000),
  ])
}

async function createCompanionPairing(request, env) {
  const deviceId = await authenticate(request, env)
  if (!deviceId) return json({ error: 'Authentication failed.' }, 401)
  const ownerDeviceId = await companionOwnerDevice(env, deviceId)
  const value = await body(request)
  if (!validId(value.pairingId) || !validToken(value.tvToken)) return json({ error: 'Invalid companion pairing credentials.' }, 400)
  const tokenHash = await hash(value.tvToken)
  const existing = await companionMemberPairing(env, deviceId, value.pairingId)
  if (existing) {
    const matches = await env.DB.prepare('SELECT pairing_id FROM companion_pairings WHERE pairing_id = ? AND tv_token_hash = ?')
      .bind(value.pairingId, tokenHash).first()
    return matches ? json({ ok: true, pairingId: value.pairingId }) : json({ error: 'This TV pairing already exists.' }, 409)
  }
  const count = await env.DB.prepare('SELECT COUNT(*) AS count FROM companion_pairings WHERE owner_device_id = ?').bind(ownerDeviceId).first()
  if (Number(count?.count || 0) >= MAX_COMPANION_PAIRINGS) return json({ error: 'This device already has the maximum number of paired TVs.' }, 409)
  const now = Date.now()
  try {
    await env.DB.batch([
      env.DB.prepare('INSERT INTO companion_pairings (pairing_id, owner_device_id, tv_token_hash, created_at, last_seen) VALUES (?, ?, ?, ?, ?)')
        .bind(value.pairingId, ownerDeviceId, tokenHash, now, now),
      env.DB.prepare('INSERT INTO companion_client_members (pairing_id, device_id) SELECT ?, ? WHERE ? <> ?')
        .bind(value.pairingId, deviceId, deviceId, ownerDeviceId),
    ])
  } catch {
    return json({ error: 'This TV pairing already exists.' }, 409)
  }
  return json({ ok: true, pairingId: value.pairingId })
}

async function createCompanionEnrollment(request, env) {
  const deviceId = await authenticate(request, env)
  if (!deviceId) return json({ error: 'Authentication failed.' }, 401)
  const now = Date.now()
  await cleanupCompanion(env, now)
  const code = base64Url(crypto.getRandomValues(new Uint8Array(24)))
  await env.DB.prepare('INSERT INTO companion_enrollments (code_hash, device_id, expires_at) VALUES (?, ?, ?)')
    .bind(await hash(code), deviceId, now + ENROLLMENT_TTL_MS).run()
  const url = new URL('/v1/companion/enrol', request.url)
  url.searchParams.set('code', code)
  return json({ url: url.toString(), expiresAt: now + ENROLLMENT_TTL_MS })
}

function normalizeSubscription(value) {
  if (!value || typeof value !== 'object') return null
  const input = value
  if (!validPushEndpoint(input.endpoint) || !input.keys || typeof input.keys !== 'object') return null
  if (!validPushValue(input.keys.p256dh, 32, 256) || !validPushValue(input.keys.auth, 8, 128)) return null
  return { endpoint: input.endpoint, keys: { p256dh: input.keys.p256dh, auth: input.keys.auth } }
}

async function subscribeCompanion(request, env) {
  const value = await body(request)
  if (!validInviteCode(value.code)) return json({ error: 'The notification enrollment has expired.' }, 401)
  const subscription = normalizeSubscription(value.subscription)
  if (!subscription) return json({ error: 'The browser returned an invalid push subscription.' }, 400)
  const now = Date.now()
  const codeHash = await hash(value.code)
  const endpointHash = await hash(subscription.endpoint)
  const results = await env.DB.batch([
    env.DB.prepare('INSERT INTO companion_push_subscriptions (endpoint_hash, device_id, endpoint, p256dh, auth, created_at, updated_at) SELECT ?, device_id, ?, ?, ?, ?, ? FROM companion_enrollments WHERE code_hash = ? AND expires_at > ? ON CONFLICT(endpoint_hash) DO UPDATE SET device_id = excluded.device_id, endpoint = excluded.endpoint, p256dh = excluded.p256dh, auth = excluded.auth, updated_at = excluded.updated_at')
      .bind(endpointHash, subscription.endpoint, subscription.keys.p256dh, subscription.keys.auth, now, now, codeHash, now),
    env.DB.prepare('DELETE FROM companion_enrollments WHERE code_hash = ?').bind(codeHash),
    env.DB.prepare('DELETE FROM companion_push_subscriptions WHERE endpoint_hash IN (SELECT endpoint_hash FROM companion_push_subscriptions WHERE device_id = (SELECT device_id FROM companion_push_subscriptions WHERE endpoint_hash = ?) ORDER BY updated_at DESC LIMIT -1 OFFSET ?)')
      .bind(endpointHash, MAX_COMPANION_PUSH_SUBSCRIPTIONS),
  ])
  if (!Number(results[0]?.meta?.changes || 0)) return json({ error: 'The notification enrollment has expired.' }, 401)
  return json({ ok: true })
}

async function authenticateTv(request, env, pairingId) {
  const header = request.headers.get('authorization') || ''
  if (!header.startsWith('Bearer ')) return null
  const token = header.slice(7)
  if (!validToken(token)) return null
  const pairing = await env.DB.prepare('SELECT pairing_id, owner_device_id FROM companion_pairings WHERE pairing_id = ? AND tv_token_hash = ?')
    .bind(pairingId, await hash(token)).first()
  if (!pairing) return null
  await env.DB.prepare('UPDATE companion_pairings SET last_seen = ? WHERE pairing_id = ?').bind(Date.now(), pairingId).run()
  return pairing
}

function validCompanionEnvelope(value) {
  if (typeof value !== 'string' || encoder.encode(value).byteLength > MAX_COMPANION_REQUEST_BYTES) return false
  try {
    const parsed = JSON.parse(value)
    return parsed?.v === 1 && validPushValue(parsed.iv, 16, 32) && validPushValue(parsed.data, 24, 16_000)
  } catch { return false }
}

function validEncryptedPayload(value, maximum = MAX_BODY_BYTES) {
  if (typeof value !== 'string' || encoder.encode(value).byteLength > maximum) return false
  try {
    const parsed = JSON.parse(value)
    return parsed?.v === 1 && validPushValue(parsed.iv, 16, 32)
      && typeof parsed.data === 'string' && parsed.data.length >= 24
      && parsed.data.length <= Math.ceil(maximum * 1.4)
      && /^[A-Za-z0-9_-]+$/.test(parsed.data)
  } catch { return false }
}

function validCatalogScreen(value) {
  return typeof value === 'string' && ['auto', 'anilist', 'kitsu', 'tmdb', 'stremio', 'merged', 'jvm'].includes(value)
}

async function ownerPairing(request, env, pairingId) {
  const deviceId = await authenticate(request, env)
  if (!deviceId) return null
  return companionMemberPairing(env, deviceId, pairingId)
}

/** Store one already-materialized catalogue view. Izumi and the TV share the encryption key; the
 * Worker sees only its screen selector and ciphertext. */
async function companionSnapshot(request, env, pairingId) {
  if (request.method === 'PUT') {
    if (!await ownerPairing(request, env, pairingId)) return json({ error: 'Companion pairing not found.' }, 404)
    const value = await body(request)
    if (!validSnapshotSelector(value.screen) || !validEncryptedPayload(value.payload)) {
      return json({ error: 'The encrypted TV snapshot is invalid.' }, 400)
    }
    const now = Date.now()
    await env.DB.prepare('INSERT INTO companion_snapshots (pairing_id, screen, payload, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(pairing_id, screen) DO UPDATE SET payload = excluded.payload, updated_at = excluded.updated_at')
      .bind(pairingId, value.screen, value.payload, now).run()
    return json({ ok: true, updatedAt: now })
  }
  if (!await authenticateTv(request, env, pairingId) && !await ownerPairing(request, env, pairingId)) return json({ error: 'Authentication failed.' }, 401)
  const screen = new URL(request.url).searchParams.get('screen') || ''
  if (screen && !validSnapshotSelector(screen)) return json({ error: 'Unknown catalogue.' }, 400)
  const row = screen
    ? await env.DB.prepare('SELECT screen, payload, updated_at AS updatedAt FROM companion_snapshots WHERE pairing_id = ? AND screen = ?').bind(pairingId, screen).first()
    : await env.DB.prepare('SELECT screen, payload, updated_at AS updatedAt FROM companion_snapshots WHERE pairing_id = ? ORDER BY updated_at DESC LIMIT 1').bind(pairingId).first()
  return row ? json(row) : json({ error: 'No cloud snapshot has been published for this catalogue.', code: 'SNAPSHOT_UNAVAILABLE' }, 404)
}

/** Playback checkpoints are encrypted by the TV. The opaque digest permits bounded upserts without
 * revealing the title or episode to the Worker. */
async function companionProgress(request, env, pairingId) {
  if (request.method === 'PUT') {
    if (!await authenticateTv(request, env, pairingId)) return json({ error: 'TV authentication failed.' }, 401)
    const value = await body(request)
    if (typeof value.mediaKey !== 'string' || !/^[A-Za-z0-9_-]{32,64}$/.test(value.mediaKey)
      || !validEncryptedPayload(value.payload, 96 * 1024)) {
      return json({ error: 'The encrypted playback checkpoint is invalid.' }, 400)
    }
    const now = Date.now()
    await env.DB.batch([
      env.DB.prepare('INSERT INTO companion_progress (pairing_id, media_key, payload, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(pairing_id, media_key) DO UPDATE SET payload = excluded.payload, updated_at = excluded.updated_at')
        .bind(pairingId, value.mediaKey, value.payload, now),
      env.DB.prepare('DELETE FROM companion_progress WHERE pairing_id = ? AND media_key IN (SELECT media_key FROM companion_progress WHERE pairing_id = ? ORDER BY updated_at DESC LIMIT -1 OFFSET ?)')
        .bind(pairingId, pairingId, MAX_COMPANION_PROGRESS),
    ])
    return json({ ok: true, updatedAt: now })
  }
  const pairing = await authenticateTv(request, env, pairingId) || await ownerPairing(request, env, pairingId)
  if (!pairing) return json({ error: 'Authentication failed.' }, 401)
  const result = await env.DB.prepare('SELECT media_key AS mediaKey, payload, updated_at AS updatedAt FROM companion_progress WHERE pairing_id = ? ORDER BY updated_at DESC LIMIT ?')
    .bind(pairingId, MAX_COMPANION_PROGRESS).all()
  return json({ records: result.results || [] })
}

async function companionDiscoveryFeedback(request, env, pairingId) {
  if (request.method === 'PUT') {
    if (!await authenticateTv(request, env, pairingId)) return json({ error: 'TV authentication failed.' }, 401)
    const value = await body(request)
    const now = Date.now()
    if (typeof value.mediaKey !== 'string' || !/^[A-Za-z0-9_-]{32,64}$/.test(value.mediaKey)
      || !Number.isFinite(value.at) || value.at <= 0 || value.at > now + 60_000
      || !validEncryptedPayload(value.payload, 32 * 1024)) {
      return json({ error: 'The encrypted discovery choice is invalid.' }, 400)
    }
    await env.DB.batch([
      env.DB.prepare('INSERT INTO companion_discovery (pairing_id, media_key, payload, choice_at, updated_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(pairing_id, media_key) DO UPDATE SET payload = excluded.payload, choice_at = excluded.choice_at, updated_at = excluded.updated_at WHERE excluded.choice_at >= companion_discovery.choice_at')
        .bind(pairingId, value.mediaKey, value.payload, value.at, now),
      env.DB.prepare('DELETE FROM companion_discovery WHERE pairing_id = ? AND media_key IN (SELECT media_key FROM companion_discovery WHERE pairing_id = ? ORDER BY updated_at DESC LIMIT -1 OFFSET ?)')
        .bind(pairingId, pairingId, 500),
    ])
    return json({ ok: true, updatedAt: now })
  }
  const pairing = await authenticateTv(request, env, pairingId) || await ownerPairing(request, env, pairingId)
  if (!pairing) return json({ error: 'Authentication failed.' }, 401)
  const result = await env.DB.prepare('SELECT media_key AS mediaKey, payload, updated_at AS updatedAt FROM companion_discovery WHERE pairing_id = ? ORDER BY updated_at DESC LIMIT ?')
    .bind(pairingId, 500).all()
  return json({ records: result.results || [] })
}


/** Issue a short-lived capability for the TV's YouTube bridge. Keeping the TV bearer token in a
 * POST header means it cannot leak through the iframe URL, browser history, or YouTube Referer. */
async function createCompanionTrailer(request, env, pairingId) {
  if (!await authenticateTv(request, env, pairingId)) return json({ error: 'TV authentication failed.' }, 401)
  const value = await body(request)
  if (typeof value.videoId !== 'string' || !/^[A-Za-z0-9_-]{11}$/.test(value.videoId)) {
    return json({ error: 'The trailer has an invalid YouTube ID.' }, 400)
  }
  const now = Date.now()
  const expiresAt = now + COMPANION_TRAILER_TTL_MS
  const code = base64Url(crypto.getRandomValues(new Uint8Array(24)))
  await env.DB.batch([
    env.DB.prepare('DELETE FROM companion_trailer_tickets WHERE expires_at <= ?').bind(now),
    env.DB.prepare('INSERT INTO companion_trailer_tickets (code_hash, pairing_id, video_id, muted, captions, expires_at) VALUES (?, ?, ?, ?, ?, ?)')
      .bind(await hash(code), pairingId, value.videoId, value.muted === true ? 1 : 0, value.captions === true ? 1 : 0, expiresAt),
    env.DB.prepare('DELETE FROM companion_trailer_tickets WHERE code_hash IN (SELECT code_hash FROM companion_trailer_tickets WHERE pairing_id = ? ORDER BY expires_at DESC LIMIT -1 OFFSET ?)')
      .bind(pairingId, MAX_COMPANION_TRAILERS),
  ])
  const url = new URL('/v1/companion/trailer', request.url)
  url.searchParams.set('code', code)
  return json({ requestId: `cloud-${code.slice(0, 24)}`, url: url.toString(), expiresAt })
}

async function companionTrailerDocument(request, env) {
  const code = new URL(request.url).searchParams.get('code') || ''
  if (!validInviteCode(code)) return new Response('Trailer not found.', { status: 404 })
  const row = await env.DB.prepare('SELECT video_id AS videoId, muted, captions FROM companion_trailer_tickets WHERE code_hash = ? AND expires_at > ?')
    .bind(await hash(code), Date.now()).first()
  if (!row || typeof row.videoId !== 'string' || !/^[A-Za-z0-9_-]{11}$/.test(row.videoId)) {
    return new Response('Trailer not found.', { status: 404 })
  }
  const muted = Number(row.muted) === 1 ? '1' : '0'
  const captions = Number(row.captions) === 1
  const source = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="referrer" content="strict-origin-when-cross-origin"><title>YouTube trailer</title><style>html,body,iframe{width:100%;height:100%;margin:0;border:0;background:#000;overflow:hidden}</style></head>
<body><iframe id="player" title="YouTube trailer" allow="autoplay; encrypted-media; fullscreen" allowfullscreen></iframe><script>
(function () {
  var player = document.getElementById('player');
  var youtubeOrigin = 'https://www.youtube-nocookie.com';
  var params = new URLSearchParams();
  params.append('enablejsapi', '1'); params.append('autoplay', '1'); params.append('controls', '0');
  params.append('mute', '${muted}'); params.append('disablekb', '1');
  params.append('cc_load_policy', '${captions ? '1' : '0'}');
  ${captions ? "params.append('cc_lang_pref', 'en');" : ''}
  params.append('iv_load_policy', '3'); params.append('playsinline', '1'); params.append('rel', '0');
  params.append('origin', location.origin); params.append('widget_referrer', 'https://com.nicho.izumi');
  player.src = youtubeOrigin + '/embed/${row.videoId}?' + params.toString();
  window.addEventListener('message', function (event) {
    if (event.source === player.contentWindow && (event.origin === youtubeOrigin || event.origin === 'https://www.youtube.com')) {
      parent.postMessage({ type: 'izumi-youtube-event', payload: event.data }, '*'); return;
    }
    if (event.source === parent && event.data && event.data.type === 'izumi-youtube-command' && typeof event.data.payload === 'string' && player.contentWindow) {
      player.contentWindow.postMessage(event.data.payload, youtubeOrigin);
    }
  });
})();
</script></body></html>`
  return new Response(source, {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      'Content-Security-Policy': "default-src 'none'; frame-src https://www.youtube-nocookie.com https://www.youtube.com; script-src 'unsafe-inline'; style-src 'unsafe-inline'",
      'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
      'Referrer-Policy': 'strict-origin-when-cross-origin',
      'X-Content-Type-Options': 'nosniff',
    },
  })
}

async function sendCompanionPush(request, env, deviceId, pairingId, requestId) {
  const result = await env.DB.prepare('SELECT endpoint_hash, endpoint, p256dh, auth FROM companion_push_subscriptions WHERE device_id = ? ORDER BY updated_at DESC LIMIT 8')
    .bind(deviceId).all()
  const subscriptions = result.results || []
  if (!subscriptions.length) return { delivered: 0, failed: 0 }
  const vapid = await ensureVapidKeys(env)
  const vapidDetails = {
    subject: new URL(request.url).origin,
    publicKey: vapid.publicKey,
    privateKey: vapid.privateKey,
  }
  const openPath = `/v1/companion/open?pairing=${encodeURIComponent(pairingId)}&request=${encodeURIComponent(requestId)}`
  const payload = JSON.stringify({
    title: 'Izumi Companion',
    body: 'Your TV is waiting. Open Izumi to choose a source.',
    tag: `izumi-tv-${pairingId}`,
    data: { openPath },
  })
  let delivered = 0
  let failed = 0
  const dead = []
  await Promise.all(subscriptions.map(async (subscription) => {
    try {
      await webpush.sendNotification({
        endpoint: subscription.endpoint,
        keys: { p256dh: subscription.p256dh, auth: subscription.auth },
      }, payload, {
        TTL: Math.floor(COMPANION_REQUEST_TTL_MS / 1000),
        urgency: 'high',
        vapidDetails,
      })
      delivered += 1
    } catch (error) {
      failed += 1
      const status = Number(error?.statusCode || 0)
      if (status === 404 || status === 410) dead.push(subscription.endpoint_hash)
    }
  }))
  if (dead.length) {
    await env.DB.batch(dead.map((endpointHash) => env.DB.prepare('DELETE FROM companion_push_subscriptions WHERE endpoint_hash = ?').bind(endpointHash)))
  }
  return { delivered, failed }
}

async function createCompanionRequest(request, env, pairingId, expectedRequestId) {
  const pairing = await authenticateTv(request, env, pairingId)
  if (!pairing) return json({ error: 'TV authentication failed.' }, 401)
  const value = await body(request)
  if (!validId(value.requestId) || value.requestId !== expectedRequestId || !validCompanionEnvelope(value.payload)) {
    return json({ error: 'Invalid encrypted companion request.' }, 400)
  }
  const now = Date.now()
  await cleanupCompanion(env, now)
  const existing = await env.DB.prepare('SELECT state, expires_at AS expiresAt FROM companion_requests WHERE pairing_id = ? AND request_id = ?')
    .bind(pairingId, value.requestId).first()
  if (existing) return json({ ok: true, duplicate: true, state: existing.state, expiresAt: Number(existing.expiresAt) })
  const count = await env.DB.prepare("SELECT COUNT(*) AS count FROM companion_requests WHERE pairing_id = ? AND state NOT IN ('cancelled', 'expired')")
    .bind(pairingId).first()
  if (Number(count?.count || 0) >= MAX_COMPANION_REQUESTS) return json({ error: 'This TV has too many pending requests.' }, 429)
  const expiresAt = now + COMPANION_REQUEST_TTL_MS
  await env.DB.prepare("INSERT INTO companion_requests (pairing_id, request_id, payload, state, issued_at, expires_at, updated_at) VALUES (?, ?, ?, 'queued', ?, ?, ?)")
    .bind(pairingId, value.requestId, value.payload, now, expiresAt, now).run()
  const push = await sendCompanionPush(request, env, String(pairing.owner_device_id), pairingId, value.requestId)
  return json({ ok: true, state: 'queued', expiresAt, notified: push.delivered, pushFailures: push.failed })
}

async function companionRequestForMobile(request, env, pairingId, requestId) {
  const deviceId = await authenticate(request, env)
  if (!deviceId) return json({ error: 'Authentication failed.' }, 401)
  if (!await companionMemberPairing(env, deviceId, pairingId)) return json({ error: 'Companion request not found.' }, 404)
  const row = await env.DB.prepare('SELECT payload, state, issued_at AS issuedAt, expires_at AS expiresAt FROM companion_requests WHERE pairing_id = ? AND request_id = ?')
    .bind(pairingId, requestId).first()
  if (!row) return json({ error: 'Companion request not found.' }, 404)
  if (Number(row.expiresAt) <= Date.now() && !['accepted', 'cancelled'].includes(String(row.state))) {
    await env.DB.prepare("UPDATE companion_requests SET state = 'expired', updated_at = ? WHERE pairing_id = ? AND request_id = ?").bind(Date.now(), pairingId, requestId).run()
    return json({ error: 'This TV request has expired.' }, 410)
  }
  return json(row)
}

async function companionRequestStatus(request, env, pairingId, requestId) {
  if (request.method === 'GET') {
    const pairing = await authenticateTv(request, env, pairingId) || await ownerPairing(request, env, pairingId)
    if (!pairing) return json({ error: 'TV authentication failed.' }, 401)
    const row = await env.DB.prepare('SELECT state, expires_at AS expiresAt, updated_at AS updatedAt FROM companion_requests WHERE pairing_id = ? AND request_id = ?')
      .bind(pairingId, requestId).first()
    return row ? json(row) : json({ error: 'Companion request not found.' }, 404)
  }
  const deviceId = await authenticate(request, env)
  if (!deviceId) return json({ error: 'Authentication failed.' }, 401)
  const value = await body(request)
  if (!['opened', 'accepted', 'cancelled'].includes(value.state)) return json({ error: 'Invalid companion request state.' }, 400)
  const owned = await companionMemberPairing(env, deviceId, pairingId)
  if (!owned) return json({ error: 'Companion request not found.' }, 404)
  const now = Date.now()
  const result = await env.DB.prepare("UPDATE companion_requests SET state = ?, updated_at = ? WHERE pairing_id = ? AND request_id = ? AND expires_at > ? AND state NOT IN ('accepted', 'cancelled', 'expired')")
    .bind(value.state, now, pairingId, requestId, now).run()
  return Number(result.meta?.changes || 0) ? json({ ok: true, state: value.state }) : json({ error: 'This TV request is no longer active.' }, 409)
}

async function removeCompanionPairing(request, env, pairingId) {
  const deviceId = await authenticate(request, env)
  if (deviceId) {
    const result = await env.DB.prepare(`DELETE FROM companion_pairings WHERE pairing_id = ? AND (owner_device_id = ? OR EXISTS
      (SELECT 1 FROM companion_client_members m WHERE m.pairing_id = companion_pairings.pairing_id AND m.device_id = ?))`)
      .bind(pairingId, deviceId, deviceId).run()
    return Number(result.meta?.changes || 0) ? json({ ok: true }) : json({ error: 'Companion pairing not found.' }, 404)
  }
  const pairing = await authenticateTv(request, env, pairingId)
  if (!pairing) return json({ error: 'Authentication failed.' }, 401)
  await env.DB.prepare('DELETE FROM companion_pairings WHERE pairing_id = ?').bind(pairingId).run()
  return json({ ok: true })
}

async function resolverProfile(request, env) {
  const deviceId = await authenticate(request, env)
  if (!deviceId) return json({ error: 'Authentication failed.' }, 401)
  // Local cleanup must never delete the original owner's shared profile or accounts.
  const ownerDeviceId = request.method === 'DELETE' ? deviceId : await companionOwnerDevice(env, deviceId)
  if (request.method === 'GET') {
    const row = await env.DB.prepare('SELECT profile_json AS profile, updated_at AS updatedAt FROM resolver_profiles WHERE owner_device_id = ?')
      .bind(ownerDeviceId).first()
    if (!row) return json({ profile: publicResolverProfile(defaultResolverProfile()), updatedAt: null })
    try {
      const profile = normalizeResolverProfile(JSON.parse(row.profile), new URL(request.url).origin)
      return json({
        profile: publicResolverProfile(profile, new URL(request.url).origin),
        updatedAt: Number(row.updatedAt),
      })
    } catch {
      return json({ profile: publicResolverProfile(defaultResolverProfile()), updatedAt: null })
    }
  }
  if (request.method === 'DELETE') {
    await env.DB.prepare('DELETE FROM connected_accounts WHERE owner_device_id = ?').bind(deviceId).run()
    await env.DB.prepare('DELETE FROM resolver_profiles WHERE owner_device_id = ?').bind(deviceId).run()
    return json({ ok: true })
  }
  try {
    const profile = normalizeResolverProfile(await body(request), new URL(request.url).origin)
    profile.collections = normalizeCollections(profile.collections)
    const now = Date.now()
    await env.DB.prepare('INSERT INTO resolver_profiles (owner_device_id, profile_json, updated_at) VALUES (?, ?, ?) ON CONFLICT(owner_device_id) DO UPDATE SET profile_json = excluded.profile_json, updated_at = excluded.updated_at')
      .bind(ownerDeviceId, JSON.stringify(profile), now).run()
    return json({ ok: true, profile: publicResolverProfile(profile, new URL(request.url).origin), updatedAt: now })
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : 'Invalid resolver profile.' }, 400)
  }
}

async function ownerAccounts(request, env) {
  const deviceId = await authenticate(request, env)
  if (!deviceId) return json({ error: 'Authentication failed.' }, 401)
  const owner = await companionOwnerDevice(env, deviceId)
  const input = request.method === 'GET' ? Object.fromEntries(new URL(request.url).searchParams) : await body(request)
  const profileId = input.profileId || 'default'
  if (!/^[A-Za-z0-9_-]{1,100}$/.test(profileId)) return json({ error: 'Invalid profile.' }, 400)
  if (request.method === 'GET') return json({ accounts: await readAccounts(env.DB, owner, profileId) })
  if (!accountServices.includes(input.service)) return json({ error: 'Invalid account service.' }, 400)
  try {
    return json(await withAccount(env.DB, owner, profileId, input.service,
      (account, persist, replace) => manageAccount(account, persist, replace, input.service, input)))
  } catch (error) { return json({ error: error.message || 'Account connection failed.' }, 409) }
}

async function tvAccountContext(request, env, pairingId, input) {
  const pairing = await authenticateTv(request, env, pairingId)
  if (!pairing) throw new Error('TV authentication failed.')
  const owner = String(pairing.owner_device_id)
  const row = await env.DB.prepare('SELECT profile_json AS profile FROM resolver_profiles WHERE owner_device_id = ?').bind(owner).first()
  if (!row) throw new Error('Enable independent TV playback in Izumi first.')
  const profile = normalizeResolverProfile(JSON.parse(row.profile), new URL(request.url).origin)
  if (!profile.enabled) throw new Error('Independent TV playback is disabled.')
  const viewer = await viewerForRequest(profile, input)
  return { owner, profile, viewer, profileId: accountScope(profile, viewer) }
}

async function hydrateAccountSources(env, owner, profile, viewer) {
  const profileId = accountScope(profile, viewer)
  const accounts = await readAccounts(env.DB, owner, profileId)
  for (const state of accounts.filter(value => value.connected && value.sources)) {
    try {
      const urls = await withAccount(env.DB, owner, profileId, state.service,
        (account, persist) => accountSources(account, persist, state.service))
      // The user's own configured sources come first: prepending account-derived URLs let the
      // truncation silently evict a source the user had just added on the desktop.
      profile.addons = [...new Set([...profile.addons, ...urls])].slice(0, 16)
    } catch { /* Existing enabled sources remain usable when an external account needs reconnection. */ }
  }
  return accounts
}

async function accountCatalogOptions(env, owner, profileId, profile) {
  const accounts = await readAccounts(env.DB, owner, profileId)
  const options = accounts.filter(value => value.connected && value.profile).map(value => ({ screen: `account-${value.service}`, label: value.service === 'nuvio' ? 'Nuvio library' : 'Stremio library' }))
  const local = collectionOptions(profile.collections || [], 'lc')
  if (local.length) options.push({ screen: 'local-collections', label: 'Your collections', children: local })
  const nuvio = accounts.find(value => value.service === 'nuvio' && value.connected && value.profile)
  if (nuvio) {
    try {
      const data = await withAccount(env.DB, owner, profileId, 'nuvio', (account, persist) => pullAccountCollections(account, persist))
      const groups = collectionOptions(normalizeCollections(data), 'nc')
      if (groups.length) options.push({ screen: 'nuvio-collections', label: 'Nuvio collections', children: groups })
    } catch {
      const option = options.find(value => value.screen === 'account-nuvio')
      if (option) option.description = 'Nuvio could not refresh. Check TV accounts in Izumi.'
    }
  }
  return options
}

async function tvAccounts(request, env, pairingId) {
  try {
    const input = await body(request)
    const { owner, profile, viewer, profileId } = await tvAccountContext(request, env, pairingId, input)
    if (input.action === 'status') {
      const accounts = await readAccounts(env.DB, owner, profileId)
      return json({ playbackSync: accounts.some(value => value.connected && value.profile && value.playback) })
    }
    if (input.action === 'progress') {
      if (!viewerAllows(input.media, viewer)) throw new Error('This title is above this profile’s viewing limit.')
      const accounts = await readAccounts(env.DB, owner, profileId)
      const results = []
      for (const state of accounts.filter(value => value.connected && value.playback)) {
        results.push({ service: state.service, ...await withAccount(env.DB, owner, profileId, state.service,
          (account, persist) => pushAccountProgress(account, persist, state.service, input)) })
      }
      return json({ ok: true, results })
    }
    return json({ options: await accountCatalogOptions(env, owner, profileId, profile) })
  } catch (error) { return json({ error: error.message || 'TV account sync failed.' }, 409) }
}

async function externalAccountSnapshot(env, owner, profile, viewer, input) {
  const profileId = accountScope(profile, viewer), screen = String(input.screen || '')
  if (screen.startsWith('lc-')) {
    const snapshot = await collectionSnapshot(profile, profile.collections || [], screen, 'lc', input.page || 1, input.offsets || [])
    if (!snapshot) throw new Error('This folder is no longer available. Reopen the catalogue picker to refresh your collections.')
    return snapshot
  }
  if (screen !== 'account-nuvio' && screen !== 'account-stremio' && !screen.startsWith('nc-')) return null
  const service = screen === 'account-stremio' ? 'stremio' : 'nuvio'
  if (screen.startsWith('nc-')) {
    const collections = await withAccount(env.DB, owner, profileId, service, (account, persist) => pullAccountCollections(account, persist))
    const snapshot = await collectionSnapshot(profile, normalizeCollections(collections), screen, 'nc', input.page || 1, input.offsets || [])
    if (!snapshot) throw new Error('This Nuvio folder is no longer available. Reopen the catalogue picker to refresh.')
    return snapshot
  }
  const data = await withAccount(env.DB, owner, profileId, service, (account, persist) => pullAccount(account, persist, service))
  if (!data) throw new Error('Connect and select this account in Izumi → Sync → TV accounts.')
  const base = profile.addons[0]
  if (!base) throw new Error('Enable account sources or add a Stremio source in TV playback settings first.')
  const library = data.library.filter(value => service === 'nuvio' || !value.removed).map(value => accountMedia(value, service, base)).filter(Boolean)
  const progress = (service === 'nuvio' ? data.progress : data.library).map(value => accountMedia(value, service, base)).filter(value => value?.resumePositionSeconds)
  const history = (service === 'nuvio' ? data.history || [] : data.library.filter(value => value.state?.lastWatched)).map(value => accountMedia(value, service, base)).filter(Boolean)
  const page = Number(input.page || 1)
  if (!Number.isInteger(page) || page < 1 || page > 1000) throw new Error('Invalid library page.')
  const query = String(input.query || '').trim().toLowerCase().slice(0, 80)
  const matching = query ? library.filter(item => item.title.toLowerCase().includes(query)) : library
  const pageItems = matching.slice((page - 1) * 200, page * 200)
  const rows = [{ id: `${service}-continue`, title: 'Continue watching', kind: 'continue', items: page === 1 ? progress.slice(0, 40) : [] }, { id: `${service}-library-${page}`, title: page === 1 ? 'My library' : 'More from my library', kind: 'catalog', items: pageItems }].filter(row => row.items.length)
  return { app: 'izumi', kind: 'companion-home', version: 1, revision: `cloud-${screen}-${Date.now()}`, generatedAt: Date.now(), catalog: { screen, label: service === 'nuvio' ? 'Nuvio library' : 'Stremio library' },
    rows, collectionPage: { page, hasMore: matching.length > page * 200, errors: [] }, hero: rows[0]?.items[0], history: history.slice(0, 200), views: { myList: pageItems, search: pageItems }, spoilersHidden: profile.catalog.hideSpoilers }
}

async function resolveForTv(request, env, pairingId) {
  const pairing = await authenticateTv(request, env, pairingId)
  if (!pairing) return json({ error: 'TV authentication failed.' }, 401)
  const now = Date.now()
  const input = await body(request)
  if (!input.tvSourceResults) {
    const gate = await env.DB.prepare('UPDATE companion_pairings SET last_resolve_at = ? WHERE pairing_id = ? AND last_resolve_at <= ?')
      .bind(now, pairingId, now - RESOLVER_MIN_INTERVAL_MS).run()
    if (!Number(gate.meta?.changes || 0)) return json({ error: 'Wait before starting another source lookup.' }, 429)
  }
  const row = await env.DB.prepare('SELECT profile_json AS profile FROM resolver_profiles WHERE owner_device_id = ?')
    .bind(String(pairing.owner_device_id)).first()
  if (!row) return json({
    error: 'Cloud source resolving has not been configured for this TV.',
    code: 'RESOLVER_NOT_CONFIGURED',
  }, 409)
  let profile
  try { profile = normalizeResolverProfile(JSON.parse(row.profile), new URL(request.url).origin) } catch {
    return json({ error: 'The cloud resolver profile is invalid. Open Izumi and save it again.', code: 'RESOLVER_INVALID' }, 409)
  }
  try {
    const viewer = await viewerForRequest(profile, input)
    await hydrateAccountSources(env, String(pairing.owner_device_id), profile, viewer)
    const tvLookupContext = { pairingId, profileId: viewer?.id ?? 'default', startedAt: now }
    const tvContinuation = input.tvSourceResults ? await prepareTvSourceContinuation(profile, input, tvLookupContext) : undefined
    if (tvContinuation && !await consumeTvSourceLookup(env.DB, pairingId, tvContinuation.issuedAt, now)) {
      return json({ error: 'This TV source lookup was already used or superseded. Start playback again.', code: 'RESOLVER_LOOKUP_EXPIRED' }, 409)
    }
    if (viewer && (viewer.ratingLimit < 18 || !viewer.allowAdult)) {
      const metadata = await resolveMediaDetails(input, profile)
      if (!viewerAllows(metadata, viewer)) throw new Error('This title is above this profile’s viewing limit.')
    }
    const result = await resolveDirectSources(profile, input, fetch, { tvLookupContext, tvContinuation })
    const ownerKey = await env.DB.prepare('SELECT token_hash FROM devices WHERE id = ?').bind(String(pairing.owner_device_id)).first()
    if (ownerKey?.token_hash) {
      const tickets = new Map()
      for (const candidate of result.candidates) for (const track of candidate.subtitles) {
        try {
          const target = track.download ?? track.url
          const key = JSON.stringify(target)
          if (!tickets.has(key)) tickets.set(key, await subtitleTicket(target, pairingId, ownerKey.token_hash))
          track.url = `${new URL(request.url).origin}/v1/companion/pairings/${pairingId}/subtitles?ticket=${tickets.get(key)}`
          delete track.download
        } catch { /* Direct delivery remains available for unsupported addresses. */ }
      }
    }
    return json({
      ok: true,
      ...result,
      fallback: result.candidates.length || !profile.connectedDeviceFallback ? null : 'paired-device',
    })
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : 'Source resolution failed.', code: 'RESOLVER_FAILED' }, 409)
  }
}

async function detailsForTv(request, env, pairingId) {
  const pairing = await authenticateTv(request, env, pairingId)
  if (!pairing) return json({ error: 'TV authentication failed.' }, 401)
  const now = Date.now()
  const gate = await env.DB.prepare('UPDATE companion_pairings SET last_details_at = ? WHERE pairing_id = ? AND last_details_at <= ?')
    .bind(now, pairingId, now - DETAILS_MIN_INTERVAL_MS).run()
  if (!Number(gate.meta?.changes || 0)) return json({ error: 'Wait before starting another detail lookup.' }, 429)
  const row = await env.DB.prepare('SELECT profile_json AS profile FROM resolver_profiles WHERE owner_device_id = ?')
    .bind(String(pairing.owner_device_id)).first()
  let profile = defaultResolverProfile()
  try { if (row) profile = normalizeResolverProfile(JSON.parse(row.profile), new URL(request.url).origin) } catch {
    return json({ error: 'The cloud profile is invalid. Save it again in Izumi.', code: 'RESOLVER_INVALID' }, 409)
  }
  try {
    const input = await body(request)
    const viewer = await viewerForRequest(profile, input)
    await hydrateAccountSources(env, String(pairing.owner_device_id), profile, viewer)
    const details = await resolveMediaDetails(input?.media ?? input, profile)
    if (!viewerAllows(details, viewer)) throw new Error('This title is above this profile’s viewing limit.')
    return details
      ? json({ ok: true, details })
      : json({ error: 'Cloud episode metadata is unavailable for this catalogue title.', code: 'DETAILS_UNAVAILABLE' }, 404)
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : 'Episode metadata lookup failed.', code: 'DETAILS_FAILED' }, 409)
  }
}

async function householdForTv(request, env, pairingId) {
  const pairing = await authenticateTv(request, env, pairingId)
  if (!pairing) return json({ error: 'TV authentication failed.' }, 401)
  const row = await env.DB.prepare('SELECT profile_json AS profile FROM resolver_profiles WHERE owner_device_id = ?')
    .bind(String(pairing.owner_device_id)).first()
  if (!row) return json({ household: null })
  try {
    const profile = normalizeResolverProfile(JSON.parse(row.profile), new URL(request.url).origin)
    // Only household display metadata and salted PIN verifiers; never resolver credentials.
    return json({ household: profile.household ?? null })
  } catch { return json({ error: 'Save profiles again in Izumi.' }, 409) }
}

async function catalogForTv(request, env, pairingId) {
  const pairing = await authenticateTv(request, env, pairingId)
  if (!pairing) return json({ error: 'TV authentication failed.' }, 401)
  const now = Date.now()
  const gate = await env.DB.prepare('UPDATE companion_pairings SET last_catalog_at = ? WHERE pairing_id = ? AND last_catalog_at <= ?')
    .bind(now, pairingId, now - CATALOG_MIN_INTERVAL_MS).run()
  if (!Number(gate.meta?.changes || 0)) return json({ error: 'Wait before starting another catalogue request.' }, 429)
  const row = await env.DB.prepare('SELECT profile_json AS profile FROM resolver_profiles WHERE owner_device_id = ?')
    .bind(String(pairing.owner_device_id)).first()
  if (!row) return json({ error: 'Cloud catalogues have not been configured for this TV.', code: 'CATALOG_NOT_CONFIGURED' }, 409)
  try {
    const profile = normalizeResolverProfile(JSON.parse(row.profile), new URL(request.url).origin)
    const input = await body(request)
    const viewer = await viewerForRequest(profile, input)
    const owner = String(pairing.owner_device_id)
    await hydrateAccountSources(env, owner, profile, viewer)
    const snapshot = scopeSnapshot(await externalAccountSnapshot(env, owner, profile, viewer, input) ?? await resolveCatalogSnapshot(profile, input?.screen), profile, viewer)
    if (snapshot) {
      const options = snapshot.catalog.options || profile.catalog.screens.map(screen => ({ screen, label: screen }))
      try { snapshot.catalog.options = [...options, ...await accountCatalogOptions(env, owner, accountScope(profile, viewer), profile)] }
      catch { snapshot.catalog.options = options } // An expired optional account must not block other catalogues.
    }
    return snapshot ? json({ ok: true, snapshot }) : json({ error: 'This catalogue is not available in the Worker.', code: 'CATALOG_UNAVAILABLE' }, 404)
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : 'Catalogue lookup failed.', code: 'CATALOG_FAILED' }, 409)
  }
}

async function searchForTv(request, env, pairingId) {
  const pairing = await authenticateTv(request, env, pairingId)
  if (!pairing) return json({ error: 'TV authentication failed.' }, 401)
  const now = Date.now()
  const gate = await env.DB.prepare('UPDATE companion_pairings SET last_catalog_at = ? WHERE pairing_id = ? AND last_catalog_at <= ?')
    .bind(now, pairingId, now - CATALOG_MIN_INTERVAL_MS).run()
  if (!Number(gate.meta?.changes || 0)) return json({ error: 'Wait before starting another search.' }, 429)
  const row = await env.DB.prepare('SELECT profile_json AS profile FROM resolver_profiles WHERE owner_device_id = ?')
    .bind(String(pairing.owner_device_id)).first()
  if (!row) return json({ error: 'Cloud search has not been configured for this TV.', code: 'CATALOG_NOT_CONFIGURED' }, 409)
  try {
    const profile = normalizeResolverProfile(JSON.parse(row.profile), new URL(request.url).origin)
    const input = await body(request)
    const viewer = await viewerForRequest(profile, input)
    await hydrateAccountSources(env, String(pairing.owner_device_id), profile, viewer)
    if (/^(account-|nc-|lc-)/.test(String(input.screen))) {
      const snapshot = await externalAccountSnapshot(env, String(pairing.owner_device_id), profile, viewer, input)
      const query = String(input.query || '').trim().toLowerCase().slice(0, 80)
      return json({ ok: true, items: (snapshot?.views?.myList || snapshot?.rows.flatMap(row => row.items) || []).filter(item => viewerAllows(item, viewer) && item.title.toLowerCase().includes(query)).slice(0, 40) })
    }
    const items = (await searchCatalog(profile, input?.screen, input?.query, input?.person, input?.genre)).filter((item) => viewerAllows(item, viewer))
    return json({ ok: true, items })
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : 'Search failed.', code: 'SEARCH_FAILED' }, 409)
  }
}

const ENROLMENT_SCRIPT = `
const status = document.querySelector('[data-status]')
const button = document.querySelector('[data-enable]')
const returnLink = document.querySelector('[data-return]')
const code = new URL(location.href).searchParams.get('code') || ''
if (!/^[A-Za-z0-9_-]{20,64}$/.test(code)) {
  button.disabled = true
  status.textContent = 'This notification enrollment link is invalid or has expired.'
}
function bytes(value) {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - value.length % 4) % 4)
  const binary = atob(padded)
  return Uint8Array.from(binary, character => character.charCodeAt(0))
}
button.addEventListener('click', async () => {
  button.disabled = true
  status.textContent = 'Waiting for notification permission…'
  try {
    const permission = await Notification.requestPermission()
    if (permission !== 'granted') throw new Error('Notification permission was not granted.')
    const registration = await navigator.serviceWorker.register('/v1/companion/sw.js', { scope: '/v1/companion/' })
    const vapidResponse = await fetch('/v1/companion/vapid', { cache: 'no-store' })
    if (!vapidResponse.ok) throw new Error('The Worker could not prepare Web Push.')
    const vapid = await vapidResponse.json()
    const subscription = await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: bytes(vapid.publicKey) })
    const response = await fetch('/v1/companion/subscriptions', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code, subscription: subscription.toJSON() }),
    })
    const result = await response.json().catch(() => ({}))
    if (!response.ok) throw new Error(result.error || 'The Worker rejected this subscription.')
    status.textContent = 'TV notifications are enabled for this browser.'
    button.hidden = true
    returnLink.hidden = false
  } catch (error) {
    status.textContent = error instanceof Error ? error.message : String(error)
    button.disabled = false
  }
})
`

const SERVICE_WORKER_SCRIPT = `
self.addEventListener('push', event => {
  if (!event.data) return
  const value = event.data.json()
  event.waitUntil(self.registration.showNotification(value.title || 'Izumi Companion', {
    body: value.body || 'Your TV is waiting.', tag: value.tag || 'izumi-tv',
    data: value.data || {}, renotify: true, requireInteraction: false,
  }))
})
self.addEventListener('notificationclick', event => {
  event.notification.close()
  const path = event.notification.data && event.notification.data.openPath
  const target = typeof path === 'string' && path.startsWith('/v1/companion/open?') ? path : '/v1/companion/enrol'
  event.waitUntil(self.clients.openWindow(new URL(target, self.location.origin).href))
})
`

const OPEN_SCRIPT = `
const link = document.querySelector('[data-open-izumi]')
if (link instanceof HTMLAnchorElement) {
  window.setTimeout(() => { location.href = link.href }, 80)
}
`

function companionEnrolmentPage(request) {
  const origin = new URL(request.url).origin
  const returnLink = `izumi://companion/push-enrolled?worker=${encodeURIComponent(origin)}`
  return documentResponse(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Izumi TV notifications</title><style>body{margin:0;background:#08090d;color:#f7f7fa;font:16px system-ui,sans-serif;display:grid;min-height:100vh;place-items:center}.card{width:min(34rem,calc(100% - 2rem));box-sizing:border-box;padding:2rem;border:1px solid #282b35;border-radius:1.25rem;background:#11131a}h1{font-size:1.75rem;margin:.35rem 0 1rem}p{color:#b7bac5;line-height:1.55}.label{color:#b68cff;font-size:.75rem;font-weight:800;letter-spacing:.16em;text-transform:uppercase}button,a{display:inline-flex;margin-top:1rem;padding:.85rem 1.15rem;border:0;border-radius:.75rem;background:#a970ff;color:#09070d;font:inherit;font-weight:800;text-decoration:none}button:disabled{opacity:.55}</style></head><body><main class="card"><div class="label">Izumi Companion</div><h1>Let your TV reach this phone</h1><p>This browser registers directly with your private Izumi Worker. Izumi does not relay the request through a shared server.</p><p data-status>Enable browser notifications, then return to Izumi.</p><button data-enable type="button">Enable TV notifications</button><a data-return hidden href="${returnLink}">Return to Izumi</a></main><script src="/v1/companion/enrol.js"></script></body></html>`)
}

function companionOpenPage(request, pairingId, requestId) {
  const origin = new URL(request.url).origin
  const deepLink = `izumi://companion/request?worker=${encodeURIComponent(origin)}&pairing=${encodeURIComponent(pairingId)}&request=${encodeURIComponent(requestId)}`
  return documentResponse(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Open Izumi</title><style>body{margin:0;background:#08090d;color:#f7f7fa;font:16px system-ui,sans-serif;display:grid;min-height:100vh;place-items:center}.card{width:min(32rem,calc(100% - 2rem));box-sizing:border-box;padding:2rem;border:1px solid #282b35;border-radius:1.25rem;background:#11131a}h1{font-size:1.75rem;margin:.35rem 0 1rem}p{color:#b7bac5;line-height:1.55}.label{color:#b68cff;font-size:.75rem;font-weight:800;letter-spacing:.16em;text-transform:uppercase}a{display:inline-flex;margin-top:1rem;padding:.85rem 1.15rem;border-radius:.75rem;background:#a970ff;color:#09070d;font-weight:800;text-decoration:none}</style></head><body><main class="card"><div class="label">Izumi Companion</div><h1>Your TV is waiting</h1><p>Opening Izumi so you can choose a source and continue on your TV.</p><a data-open-izumi href="${deepLink}">Open Izumi</a></main><script src="/v1/companion/open.js"></script></body></html>`)
}

async function leave(request, env) {
  const deviceId = await authenticate(request, env)
  if (!deviceId) return json({ error: 'Authentication failed.' }, 401)
  const count = await env.DB.prepare('SELECT COUNT(*) AS count FROM devices').first()
  if (Number(count?.count || 0) <= 1) return json({ error: 'Add another device before removing the last device.' }, 409)
  // Check dependencies in the DELETE itself so a concurrent claim cannot lose its owner.
  const removed = await env.DB.prepare(`DELETE FROM devices WHERE id = ? AND NOT EXISTS (
    SELECT 1 FROM companion_pairings p JOIN companion_client_members m ON m.pairing_id = p.pairing_id
    WHERE p.owner_device_id = devices.id
  )`).bind(deviceId).run()
  if (!Number(removed.meta?.changes)) return json({ error: 'Linked clients depend on this owner registration. Unlink the dependent clients or TVs first, or keep the owner registered.' }, 409)
  return json({ ok: true })
}

const clientLinkApi = createClientLinkApi({ authenticateTv, ownerPairing, body, json, hash, validId,
  validToken, cleanName, normalizeResolverProfile, version: VERSION, maxDevices: MAX_DEVICES })

export default {
  async scheduled(_event, env) {
    await runWorkerUpdate(env, VERSION, { automatic: true })
  },
  async fetch(request, env) {
    try {
      if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders })
      const url = new URL(request.url)
      if (request.method === 'GET' && url.pathname === '/v1/status') {
        return json({
          app: 'izumi-sync',
          version: VERSION,
          recordChunks: 1,
          tvSourceLookup: 1,
          workerUpdate: 1,
          protocol: PROTOCOL,
          claimed: await claimed(env),
          features: ['companion-client-link-v1', 'companion-accounts-v1', 'companion-collections-v1', 'companion-profiles-v1', 'profile-sync-v1', 'companion-wake-v1', 'web-push-v1', 'cloud-resolver-v1', 'cloud-resolver-v2', 'cloud-resolver-debrid-v1', 'cloud-resolver-addons-16', 'cloud-resolver-refine-v1', 'companion-details-v2', 'companion-snapshot-v1', 'companion-progress-v1', 'companion-catalog-v1', 'companion-trailer-v1', 'companion-discovery-v2'],
        })
      }
      const updatePairing = url.pathname.match(/^\/v1\/companion\/pairings\/([A-Za-z0-9_-]{16,80})\/worker-update$/)
      if ((updatePairing || url.pathname === '/v1/worker-update') && ['GET', 'POST'].includes(request.method)) {
        const authorized = updatePairing
          ? await authenticateTv(request, env, updatePairing[1]) || await ownerPairing(request, env, updatePairing[1])
          : await authenticate(request, env)
        if (!authorized) return json({ error: 'Authentication failed.' }, 401)
        return json(request.method === 'POST' ? await runWorkerUpdate(env, VERSION) : await workerUpdateStatus(env, VERSION))
      }
      if (request.method === 'GET' && url.pathname === '/v1/companion/enrol') return companionEnrolmentPage(request)
      if (request.method === 'GET' && url.pathname === '/v1/companion/enrol.js') return scriptResponse(ENROLMENT_SCRIPT)
      if (request.method === 'GET' && url.pathname === '/v1/companion/sw.js') return scriptResponse(SERVICE_WORKER_SCRIPT)
      if (request.method === 'GET' && url.pathname === '/v1/companion/open.js') return scriptResponse(OPEN_SCRIPT)
      if (request.method === 'GET' && url.pathname === '/v1/companion/trailer') return await companionTrailerDocument(request, env)
      if (request.method === 'GET' && url.pathname === '/v1/companion/vapid') {
        const vapid = await ensureVapidKeys(env)
        return json({ publicKey: vapid.publicKey })
      }
      if (request.method === 'POST' && url.pathname === '/v1/companion/subscriptions') return await subscribeCompanion(request, env)
      if (request.method === 'POST' && url.pathname === '/v1/companion/pairings') return await createCompanionPairing(request, env)
      if (request.method === 'POST' && url.pathname === '/v1/companion/enrollments') return await createCompanionEnrollment(request, env)
      if (request.method === 'POST' && url.pathname === '/v1/companion/client-links/claim') return await clientLinkApi.claim(request, env)
      const clientLinkMatch = url.pathname.match(/^\/v1\/companion\/pairings\/([A-Za-z0-9_-]{16,80})\/client-links$/)
      if (clientLinkMatch && ['GET', 'POST', 'DELETE'].includes(request.method)) return await clientLinkApi.links(request, env, clientLinkMatch[1])
      const clientRecoveryMatch = url.pathname.match(/^\/v1\/companion\/pairings\/([A-Za-z0-9_-]{16,80})\/client-recovery$/)
      if (clientRecoveryMatch && ['GET', 'PUT'].includes(request.method)) return await clientLinkApi.recovery(request, env, clientRecoveryMatch[1])
      const openMatch = url.pathname === '/v1/companion/open'
      if (request.method === 'GET' && openMatch) {
        const pairingId = url.searchParams.get('pairing') || ''
        const requestId = url.searchParams.get('request') || ''
        return validId(pairingId) && validId(requestId)
          ? companionOpenPage(request, pairingId, requestId)
          : documentResponse('<!doctype html><title>Invalid Izumi request</title><p>This TV request is invalid.</p>')
      }
      const companionRequestMatch = url.pathname.match(/^\/v1\/companion\/pairings\/([A-Za-z0-9_-]{16,80})\/requests\/([A-Za-z0-9_-]{16,80})$/)
      if (companionRequestMatch && request.method === 'POST') {
        return await createCompanionRequest(request, env, companionRequestMatch[1], companionRequestMatch[2])
      }
      if (companionRequestMatch && request.method === 'GET') {
        return await companionRequestForMobile(request, env, companionRequestMatch[1], companionRequestMatch[2])
      }
      const companionStatusMatch = url.pathname.match(/^\/v1\/companion\/pairings\/([A-Za-z0-9_-]{16,80})\/requests\/([A-Za-z0-9_-]{16,80})\/status$/)
      if (companionStatusMatch && (request.method === 'GET' || request.method === 'POST')) {
        return await companionRequestStatus(request, env, companionStatusMatch[1], companionStatusMatch[2])
      }
      const subtitleMatch = url.pathname.match(/^\/v1\/companion\/pairings\/([A-Za-z0-9_-]{16,80})\/subtitles$/)
      if (subtitleMatch && request.method === 'GET') {
        const owner = await env.DB.prepare('SELECT d.token_hash, r.profile_json FROM devices d JOIN companion_pairings p ON p.owner_device_id = d.id LEFT JOIN resolver_profiles r ON r.owner_device_id = d.id WHERE p.pairing_id = ?').bind(subtitleMatch[1]).first()
        if (!owner?.token_hash) return json({ error: 'Subtitle link is no longer available.' }, 401)
        try { return await downloadSubtitle(url.searchParams.get('ticket'), subtitleMatch[1], owner.token_hash, fetch, Date.now(), target => resolveSubtitleDownload(target, JSON.parse(owner.profile_json || '{}').subtitleServices)) }
        catch { return json({ error: 'The subtitle could not be loaded. Reopen the title or choose another track.' }, 409) }
      }
      const companionResolveMatch = url.pathname.match(/^\/v1\/companion\/pairings\/([A-Za-z0-9_-]{16,80})\/resolve$/)
      const accountMatch = url.pathname.match(/^\/v1\/companion\/pairings\/([A-Za-z0-9_-]{16,80})\/accounts$/)
      if (accountMatch && request.method === 'POST') return await tvAccounts(request, env, accountMatch[1])
      if (url.pathname === '/v1/accounts' && ['GET', 'POST'].includes(request.method)) return await ownerAccounts(request, env)
      if (companionResolveMatch && request.method === 'POST') {
        return await resolveForTv(request, env, companionResolveMatch[1])
      }
      const companionDetailsMatch = url.pathname.match(/^\/v1\/companion\/pairings\/([A-Za-z0-9_-]{16,80})\/details$/)
      if (companionDetailsMatch && request.method === 'POST') {
        return await detailsForTv(request, env, companionDetailsMatch[1])
      }
      const companionSnapshotMatch = url.pathname.match(/^\/v1\/companion\/pairings\/([A-Za-z0-9_-]{16,80})\/snapshots$/)
      if (companionSnapshotMatch && (request.method === 'GET' || request.method === 'PUT')) {
        return await companionSnapshot(request, env, companionSnapshotMatch[1])
      }
      const companionProgressMatch = url.pathname.match(/^\/v1\/companion\/pairings\/([A-Za-z0-9_-]{16,80})\/progress$/)
      if (companionProgressMatch && (request.method === 'GET' || request.method === 'PUT')) {
        return await companionProgress(request, env, companionProgressMatch[1])
      }
      const discoveryMatch = url.pathname.match(/^\/v1\/companion\/pairings\/([A-Za-z0-9_-]{16,80})\/discovery$/)
      if (discoveryMatch && (request.method === 'GET' || request.method === 'PUT')) {
        return await companionDiscoveryFeedback(request, env, discoveryMatch[1])
      }
      const householdMatch = url.pathname.match(/^\/v1\/companion\/pairings\/([A-Za-z0-9_-]{16,80})\/household$/)
      if (householdMatch && request.method === 'GET') return await householdForTv(request, env, householdMatch[1])
      const companionCatalogMatch = url.pathname.match(/^\/v1\/companion\/pairings\/([A-Za-z0-9_-]{16,80})\/catalog$/)
      if (companionCatalogMatch && request.method === 'POST') {
        return await catalogForTv(request, env, companionCatalogMatch[1])
      }
      const companionSearchMatch = url.pathname.match(/^\/v1\/companion\/pairings\/([A-Za-z0-9_-]{16,80})\/search$/)
      if (companionSearchMatch && request.method === 'POST') {
        return await searchForTv(request, env, companionSearchMatch[1])
      }
      const companionTrailerMatch = url.pathname.match(/^\/v1\/companion\/pairings\/([A-Za-z0-9_-]{16,80})\/trailer$/)
      if (companionTrailerMatch && request.method === 'POST') {
        return await createCompanionTrailer(request, env, companionTrailerMatch[1])
      }
      const companionPairingMatch = url.pathname.match(/^\/v1\/companion\/pairings\/([A-Za-z0-9_-]{16,80})$/)
      if (companionPairingMatch && request.method === 'DELETE') {
        return await removeCompanionPairing(request, env, companionPairingMatch[1])
      }
      if (request.method === 'POST' && url.pathname === '/v1/claim') return await claim(request, env)
      if (request.method === 'POST' && url.pathname === '/v1/invites') return await createInvite(request, env)
      if (request.method === 'POST' && url.pathname === '/v1/join') return await join(request, env)
      if (request.method === 'GET' && url.pathname === '/v1/devices/me') {
        const deviceId = await authenticate(request, env)
        return deviceId ? json({ deviceId }) : json({ error: 'Authentication failed.' }, 401)
      }
      if (request.method === 'DELETE' && url.pathname === '/v1/devices/me') return await leave(request, env)
      if (url.pathname === '/v1/resolver/profile' && ['GET', 'PUT', 'DELETE'].includes(request.method)) {
        return await resolverProfile(request, env)
      }
      const chunkMatch = url.pathname.match(/^\/v1\/record-chunks\/([A-Za-z0-9_-]{1,106})\/([A-Za-z0-9_-]{16,80})\/([a-f0-9]{64})$/)
      if (chunkMatch && (request.method === 'GET' || request.method === 'PUT')) return await recordChunk(request, env, chunkMatch[1], chunkMatch[2], chunkMatch[3])
      const match = url.pathname.match(/^\/v1\/records\/([A-Za-z0-9_-]{1,106})$/)
      if (match && (request.method === 'GET' || request.method === 'PUT')) return await records(request, env, match[1])
      return json({ error: 'Not found.' }, 404)
    } catch (error) {
      if (error instanceof SyntaxError) return json({ error: 'Request body must be valid JSON.' }, 400)
      if (error instanceof Error && error.message === 'PAYLOAD_TOO_LARGE') return json({ error: 'Request body is too large.' }, 413)
      return json({ error: error instanceof Error ? error.message : 'Internal Worker error.' }, 500)
    }
  },
}
