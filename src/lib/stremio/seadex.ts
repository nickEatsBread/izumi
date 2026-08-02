import { phttp } from '$lib/net/http'
import { get, set } from 'idb-keyval'
import type { Stream } from './parse'

// Curated "best release" annotations, keyed by AniList id.
//
// Read-only, and deliberately NOT a source: it never contributes a stream, it only marks the ones
// the picker already found and explains why they are worth picking. The picker therefore has to
// paint, rank and play with or without it — every function here fails to a silent no-annotation
// state rather than surfacing an error.

export interface SeadexRelease {
  /** Lowercased v1 infoHash, or '' when the tracker withheld it (see HASH below). */
  infoHash: string
  url: string
  tracker: string
  releaseGroup: string
  dualAudio: boolean
  /** The curators' recommendation. False rows are alternates listed for comparison — badging one
   *  of those as "best" would assert the opposite of what the database says. */
  isBest: boolean
}

export interface SeadexEntry {
  anilistId: number
  notes: string
  /** Screenshot-comparison links. */
  comparisons: string[]
  /** The recommended release is still missing episodes. */
  incomplete: boolean
  /** Free text naming a better release that does not exist yet, e.g. "4K JPN BD+?". Not a URL. */
  theoreticalBest: string
  releases: SeadexRelease[]
}

// A v1 infoHash is exactly 40 hex characters. Private-tracker rows come back with the literal
// placeholder '<redacted>' in that field instead, so the shape test — not a string compare against
// one known placeholder — is what keeps an unmatchable row out of the match set. Treating a
// placeholder as a hash would mark every entry sharing it as the same release.
const HASH = /^[0-9a-f]{40}$/i

const str = (v: unknown) => (typeof v === 'string' ? v : '')

/** Is this a link that may be handed to the OS opener?
 *
 *  Comparison links are free text in someone else's database, and clicking one launches it through
 *  the shell — the single point where a third-party record becomes an action on this machine. Only
 *  the two schemes a screenshot comparison can legitimately use are allowed through; a
 *  `javascript:`, `file:` or app-scheme string is dropped rather than rendered as a live button. */
export const isWebLink = (url: string) => /^https?:\/\/\S/i.test(url.trim())

/** Normalize one PocketBase record. Returns undefined for anything that isn't an entry with a
 *  usable AniList id, so a shape change upstream degrades to "no annotation" instead of throwing
 *  inside the picker's render path. */
export function normalizeEntry(raw: unknown): SeadexEntry | undefined {
  const entry = raw as Record<string, unknown> | null | undefined
  const anilistId = Number(entry?.alID)
  if (!entry || !Number.isFinite(anilistId) || anilistId <= 0) return undefined
  const trs = (entry.expand as Record<string, unknown> | undefined)?.trs
  return {
    anilistId,
    notes: str(entry.notes),
    // One comma-joined STRING upstream, not an array. Individual links carry query strings of
    // their own (`?image-position=top+left`), so comma is the only safe separator.
    comparisons: str(entry.comparison).split(',').map((u) => u.trim()).filter(isWebLink),
    incomplete: entry.incomplete === true,
    theoreticalBest: str(entry.theoreticalBest),
    releases: (Array.isArray(trs) ? trs : []).map((raw): SeadexRelease => {
      const tr = (raw ?? {}) as Record<string, unknown>
      const hash = str(tr.infoHash)
      return {
        infoHash: HASH.test(hash) ? hash.toLowerCase() : '',
        url: str(tr.url),
        tracker: str(tr.tracker),
        releaseGroup: str(tr.releaseGroup),
        dualAudio: tr.dualAudio === true,
        isBest: tr.isBest === true,
      }
    }),
  }
}

/** Lowercased infoHashes of the RECOMMENDED releases, for RANKING. Private-tracker rows contribute
 *  nothing — their hash is withheld, so no stream can ever be shown as one of them.
 *
 *  An incomplete entry contributes nothing either: the recommendation is a pack that is still
 *  missing episodes, so promoting it for an episode it does not contain hands the file selector a
 *  torrent without the wanted file, and that falls back to the largest video — silently playing a
 *  different episode. The badge and the notes strip read the entry directly and keep saying so. */
export function bestHashes(entry: SeadexEntry | null | undefined): Set<string> {
  if (entry?.incomplete) return new Set()
  return new Set((entry?.releases ?? []).filter((r) => r.isBest && r.infoHash).map((r) => r.infoHash))
}

export interface SeadexMatch { stream: Stream; release: SeadexRelease }

/** Which of `streams` are one of this entry's curated releases, recommended or alternate.
 *
 *  Matched on infoHash alone, case-insensitively: every indexer reformats release names (and the
 *  addons reformat them again), while the hash survives the round trip unchanged. Pure, so the
 *  match rule can be tested without the cache or the picker. */
export function matchSeadexStreams(
  entry: SeadexEntry | null | undefined,
  streams: Stream[],
): SeadexMatch[] {
  const byHash = new Map<string, SeadexRelease>()
  // Recommended rows win a hash collision: the same torrent listed twice can only be described one
  // way on the row, and "best" is the more useful of the two things to say about it.
  for (const release of entry?.releases ?? []) {
    if (!release.infoHash) continue
    const seen = byHash.get(release.infoHash)
    if (!seen || (release.isBest && !seen.isBest)) byHash.set(release.infoHash, release)
  }
  if (!byHash.size) return []
  const out: SeadexMatch[] = []
  for (const stream of streams) {
    const release = stream.infoHash ? byHash.get(stream.infoHash.toLowerCase()) : undefined
    if (release) out.push({ stream, release })
  }
  return out
}

const API = 'https://releases.moe/api/collections/entries/records'
// Ask for only the fields that survive normalization. The default response embeds every torrent's
// full file listing, which is ~24x the payload for a batch entry and is never read here.
const FIELDS = [
  'alID', 'notes', 'comparison', 'incomplete', 'theoreticalBest',
  'expand.trs.infoHash', 'expand.trs.url', 'expand.trs.tracker',
  'expand.trs.releaseGroup', 'expand.trs.dualAudio', 'expand.trs.isBest',
].join(',')

const key = (anilistId: number) => `seadex-entry-${anilistId}`
const stampKey = (anilistId: number) => `seadex-entry-ts-${anilistId}`
// A week. An entry changes when someone finds a better release — months apart per title — and this
// is a volunteer-run instance with no published rate limits, so the correct cadence is the one that
// almost never asks.
const TTL_MS = 7 * 864e5

// Coalesce concurrent callers per id, same as the id map and the AniZip cache: opening the picker,
// a binge continuation re-mounting it, and the ranking pass can all want the same id while the
// first GET is still in flight, and each would otherwise be a separate request.
const inflight = new Map<number, Promise<SeadexEntry | null>>()

// What every lookup so far learned, for callers that cannot await one. The picker mounts an effect
// and re-ranks when the entry lands; the automatic paths rank inside a synchronous settings
// snapshot and have nowhere to put a promise. Without this they would rank with no curated
// preference at all, and "best" would mean two different things depending on whether a human was
// looking. Small and per-title, so it lives for the session rather than being evicted.
const known = new Map<number, Set<string>>()
const NONE: ReadonlySet<string> = new Set()

/** The curated recommendations already known for this title, read synchronously. Empty until some
 *  lookup has completed — a first automatic pick on a cold cache simply ranks the way an uncurated
 *  title does, which is the same thing it did before the annotation existed. */
export function knownBestHashes(anilistId: number | null | undefined): ReadonlySet<string> {
  return (anilistId ? known.get(anilistId) : undefined) ?? NONE
}

/** The curated entry for an AniList id — null when there is none, and also null when we could not
 *  find out. Never rejects: callers treat absence and failure identically. */
export function getSeadexEntry(anilistId: number | null | undefined): Promise<SeadexEntry | null> {
  if (!anilistId || anilistId <= 0) return Promise.resolve(null)
  const running = inflight.get(anilistId)
  if (running) return running
  const load = loadEntry(anilistId)
    .then((entry) => { known.set(anilistId, bestHashes(entry)); return entry })
    .finally(() => inflight.delete(anilistId))
  inflight.set(anilistId, load)
  return load
}

async function loadEntry(anilistId: number): Promise<SeadexEntry | null> {
  const [cached, stamp] = await Promise.all([
    get<SeadexEntry | null>(key(anilistId)),
    get<number>(stampKey(anilistId)),
  ])
  // A cached `null` is a real answer worth keeping, unlike the id map's empty index: most titles
  // have no curated entry at all, and re-asking for every one of those on every picker open is
  // exactly the traffic the TTL exists to prevent. `undefined` (nothing stored) is the miss.
  // What is never written is a FAILED lookup — the writes below happen only once a response has
  // parsed, so an outage falls through to whatever was already stored instead of pinning a null.
  if (cached !== undefined && stamp != null && Date.now() - stamp < TTL_MS) return cached
  try {
    const url = `${API}?filter=${encodeURIComponent(`alID=${anilistId}`)}&expand=trs&fields=${FIELDS}`
    const response = await phttp(url)
    if (!response.ok) return cached ?? null
    const items = ((await response.json()) as { items?: unknown[] } | null)?.items
    const entry = (Array.isArray(items) ? items : [])
      .map(normalizeEntry)
      .find((e): e is SeadexEntry => !!e) ?? null
    await Promise.all([set(key(anilistId), entry), set(stampKey(anilistId), Date.now())])
    return entry
  }
  catch { return cached ?? null }
}
