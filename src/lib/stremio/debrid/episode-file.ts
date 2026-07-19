import { VIDEO, JUNK, pickLargestVideo } from './http'
import type { EpisodeWant } from './types'

// Episode-aware in-torrent file selection. A batch/season-pack torrent has many video
// files; the old shared picker (pickLargestVideo) was episode-blind, so "play episode 1"
// of a 4-episode pack played whichever file happened to be biggest (often the last one).
// This module parses episode numbers out of the FILE names and picks the wanted one,
// falling back to the old largest-video behavior whenever nothing matches confidently —
// so movies, single-file torrents and unparseable packs behave exactly as before.

// Extras that must never win an episode match even when numbered — supersets the shared
// JUNK regex with the creditless/textless/menu vocabulary (mirrors relevance.ts, which is
// Stream-typed and release-level, hence the local copy for raw filenames).
const EXTRA = /\b(?:ncop|nced|ncbd|creditless|textless|non-?credits?|clean\s?(?:op|ed|opening|ending)|op\s?\d{1,2}\b|ed\s?\d{1,2}\b|preview|teaser|trailer|promo|pv|cm|menu|sample)\b/i

// Noise stripped before number capture, so codec/resolution/audio tokens can't be read
// as episode numbers. Composite resolutions (720x480) are nothing else in the repo strips.
const NOISE = [
  /\b\d{3,4}\s?x\s?\d{3,4}\b/g, // 1920x1080 / 720x480 composites (before the 1x04 capture!)
  /\b(?:2160|1440|1080|720|480|360|240)p?\b/gi,
  /\b(?:[xh]\.?26[45]|hevc|avc|av1|xvid|divx)\b/gi,
  /\b(?:8|10)-?bit\b/gi,
  /\b(?:19|20)\d{2}\b/g, // years
  /\b(?:aac|flac|opus|ac-?3|e-?ac-?3|ddp?|dts(?:-hd)?|truehd)(?:\d\.\d)?\b/gi,
  /\b\d\.\d\b/g, // audio channels (5.1, 2.0) — after SxxExx capture can't need decimals here
  /\b\d+\s?(?:kbps|fps|ch)\b/gi,
  /\b(?:nc)?(?:op|ed)\s?\d{1,2}\b/gi, // numbered opening/ending markers ("OP1", "NCED 02")
]

export interface ParsedFileEpisode {
  season?: number
  episode?: number
  range?: [number, number] // multi-episode file ("01-04"): both bounds inclusive
}

/** Parse season/episode markers out of a single in-torrent video FILENAME.
 *  Conservative by design: returns {} rather than guessing when ambiguous, so the
 *  caller can fall back to the legacy largest-file pick. */
export function parseFileEpisode(name: string): ParsedFileEpisode {
  // Basename (provider lists carry paths, / or \), extension off, _ → space.
  let s = (name.split(/[/\\]/).pop() ?? name)
    .replace(/\.[a-z0-9]{2,4}$/i, '')
    .replace(/_/g, ' ')
  // Bracket tags are group names / hex CRCs ([ABC1E404] would otherwise read as E404).
  s = s.replace(/\[[^\]]*\]/g, ' ')

  const out: ParsedFileEpisode = {}

  // SxxExx first — the one form where season+episode arrive together.
  const sxe = /\bS(\d{1,2})\s?E(\d{1,4})(?:v\d+)?\b/i.exec(s)
  if (sxe) return { season: Number(sxe[1]), episode: Number(sxe[2]) }

  // De-noise before any bare-number capture.
  for (const rx of NOISE) s = s.replace(rx, ' ')

  // 1x04 form (resolution composites already stripped above).
  const nxn = /\b(\d{1,2})x(\d{1,3})\b/.exec(s)
  if (nxn) return { season: Number(nxn[1]), episode: Number(nxn[2]) }

  // Season marker may accompany a separate episode marker ("Show S01 - 04").
  const season = /\bS(\d{1,2})\b/i.exec(s)
  if (season) {
    out.season = Number(season[1])
    s = s.replace(/\bS\d{1,2}\b/i, ' ') // don't let it feed the number fallback
  }

  // Explicit word markers: Episode 4 / Ep 4 / E04 / #05.
  const word = /(?:\bepisode|\bep\.?|\be|#)\s?(\d{1,4})(?:v\d+)?\b/i.exec(s)
  if (word) return { ...out, episode: Number(word[1]) }

  // Range BEFORE single-hyphen capture, or "01-04" reads as episode 1.
  const range = /(?:^|[\s-])(\d{1,4})\s*[-~]\s*(\d{1,4})\b/.exec(s)
  if (range && Number(range[1]) < Number(range[2])) {
    return { ...out, range: [Number(range[1]), Number(range[2])] }
  }

  // Fansub convention: "Title - 04 (tags)". The fraction is INSIDE the capture on
  // purpose: "04.5" specials parse as 4.5, which never equals an integer want — so a
  // recap can't shadow the real episode 4.
  const hyph = /[\s](?:-|–)\s*(\d{1,4}(?:\.\d)?)(?:v\d+)?\b/.exec(s)
  if (hyph) return { ...out, episode: Number(hyph[1]) }

  // Last resort: exactly ONE standalone number left in the whole name → episode.
  // ("Title 02" → 2; two or more numbers → ambiguous → give up.)
  const nums = [...s.matchAll(/(?<![\d.])(\d{1,4})(?:v\d+)?(?![\d.])/g)]
  if (nums.length === 1) return { ...out, episode: Number(nums[0][1]) }

  return out
}

/** Episode-aware file pick over a provider's {name,bytes} list. Selection order:
 *  1. exact basename match against the addon's behaviorHints.filename hint,
 *  2. parsed episode === wanted episode (or absolute number), season-gated,
 *  3. a range file ("01-04") containing the wanted episode,
 *  4. undefined — caller falls back to pickLargestVideo (legacy behavior).
 */
export function pickEpisodeVideo<T extends { name: string; bytes: number }>(
  files: T[],
  want?: EpisodeWant,
): T | undefined {
  if (!want) return undefined
  const base = (n: string) => (n.split(/[/\\]/).pop() ?? n).toLowerCase()

  // Addon-provided filename hint: authoritative when it names a real video file here.
  if (want.filename) {
    const hint = base(want.filename)
    const hit = files.find((f) => VIDEO.test(f.name) && base(f.name) === hint)
    if (hit) return hit
  }

  if (want.episode == null && want.abs == null) return undefined
  const candidates = files.filter((f) => VIDEO.test(f.name) && !JUNK.test(f.name) && !EXTRA.test(f.name))
  const parsed = candidates.map((f) => ({ f, p: parseFileEpisode(f.name) }))
  // A parsed season contradicting the wanted season disqualifies (multi-season packs).
  const seasonOk = (p: ParsedFileEpisode) => p.season == null || want.season == null || p.season === want.season

  const exact = parsed.filter(({ p }) => seasonOk(p)
    && ((want.episode != null && p.episode === want.episode) || (want.abs != null && p.episode === want.abs)))
  if (exact.length) {
    // Prefer an explicit season match, then the biggest file (better-quality duplicate).
    return exact.sort((a, b) =>
      Number(b.p.season === want.season) - Number(a.p.season === want.season) || b.f.bytes - a.f.bytes,
    )[0].f
  }

  const inRange = (p: ParsedFileEpisode, n?: number) => n != null && p.range != null && n >= p.range[0] && n <= p.range[1]
  const ranged = parsed.filter(({ p }) => seasonOk(p) && (inRange(p, want.episode) || inRange(p, want.abs)))
  if (ranged.length) {
    // Narrowest range wins (fewest bundled episodes), then size.
    const width = (p: ParsedFileEpisode) => (p.range ? p.range[1] - p.range[0] : Infinity)
    return ranged.sort((a, b) => width(a.p) - width(b.p) || b.f.bytes - a.f.bytes)[0].f
  }

  return undefined
}

/** Drop-in replacement for pickLargestVideo at provider call sites: episode-aware
 *  when a want is supplied, byte-identical legacy behavior otherwise. */
export function pickVideoFile<T extends { name: string; bytes: number }>(
  files: T[],
  want?: EpisodeWant,
): T | undefined {
  return pickEpisodeVideo(files, want) ?? pickLargestVideo(files)
}
