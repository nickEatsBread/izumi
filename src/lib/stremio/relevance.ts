import type { Stream } from './parse'

// Title relevance + cross-production filters for addon/extension streams. Pure
// (no Tauri/stores), so it's unit-testable. A shared kitsu id can pull in unrelated
// torrents or a same-title different production (One Piece's id also maps to the
// 2023 live action); these guard the picker/auto-play without dropping legit files.

export function titleTokens(s: string): string[] {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().split(' ').filter((t) => t.length > 2)
}

const nameOf = (s: Stream) =>
  s.behaviorHints?.filename || s.title?.split('\n')[0] || s.description?.split('\n')[0] || s.name || ''

// Release-name tokens that don't identify the anime (quality/codec/source/container/
// language/crc). Stripped so a short-title release's title ratio isn't diluted.
const RELEASE_JUNK = /^(?:\d{3,4}p|4k|uhd|x26[45]|h26[45]|hevc|avc|av1|xvid|10bit|8bit|hi10p?|bluray|bdrip|bd|blu|ray|web|webrip|webdl|hdtv|dvd|dvdrip|remux|batch|complete|repack|uncensored|dual|multi|subs?|dub|eng|jpn|jap|mkv|mp4|avi|aac|flac|opus|ac3|eac3|ddp?|dts|hdr|dv|nf|cr|amzn|[0-9a-f]{8})$/i

// Scene episode/season markers (S04E25, E25, 1x25) — never part of the anime's TITLE,
// so they must not count as content tokens (they diluted "Dr STONE S04E25" down to
// {subsplease,stone,s04e25} → only 1/3 title match → wrongly dropped).
const SCENE_CODE = /^(?:s\d{1,2}e\d{1,3}|e\d{1,3}|\d{1,3}x\d{1,3})$/i

// Does a release filename plausibly belong to THIS anime? Guards against cross-title
// matches on a shared id. Keeps unknowns (never drop on uncertainty).
export function relevant(stream: Stream, wanted: string[]): boolean {
  const name = nameOf(stream)
  const toks = new Set(titleTokens(name))
  if (!toks.size) return true
  // The release's OWN title words: its tokens minus quality/codec/hash junk, bare
  // numbers, the leading [Group] tag, and scene episode codes. A short-title release
  // ("[SubsPlease] Dr STONE S04E25 NF WEB-DL") must reduce to just {stone} — NOT
  // {subsplease, stone, s04e25} — so its content ratio against a LONG official title
  // ("Dr. Stone: Science Future") isn't sunk by group/episode noise.
  const bare = name.replace(/^\s*\[[^\]]*\]\s*/, '') // drop a leading [Group] tag
  const content = titleTokens(bare).filter(
    (t) => !RELEASE_JUNK.test(t) && !/^\d+$/.test(t) && !SCENE_CODE.test(t),
  )
  for (const w of wanted) {
    const wt = titleTokens(w)
    if (!wt.length) continue
    // (a) release carries ≥50% of the official title's tokens (full-title releases), OR
    if (wt.filter((t) => toks.has(t)).length / wt.length >= 0.5) return true
    // (b) the release's own title words are mostly this anime's (short-title releases):
    //     ≥60% of the release's content tokens appear in the official title.
    if (content.length && content.filter((t) => wt.includes(t)).length / content.length >= 0.6) return true
  }
  return false
}

// Non-episode EXTRA files (openings/endings/creditless/previews/menus) that addons
// sometimes index under an episode. e.g. "Death Note OP 2 [4K 60FPS Creditless].mp4"
// is 4K + tiny, so it wrongly WINS the quality auto-pick over the real episode. Drop
// them. High-precision tokens only (won't touch a normal "Death Note - 37" release).
const EPISODE_EXTRA = /\b(?:ncop\d*|nced\d*|ncbd|creditless|textless|non[-\s]?credit|clean\s+(?:opening|ending)|op\s?\d{1,2}|ed\s?\d{1,2}|preview|teaser|\btrailer\b|promo|\bpv\b|\bcm\b|menu)\b/i
export function isEpisodeExtra(stream: Stream): boolean {
  return EPISODE_EXTRA.test(nameOf(stream))
}

// Same-title, different production. A shared kitsu id (One Piece = the 1999 anime
// AND the 2023 Netflix live action) survives relevant() because the title matches.
// Two independent tells, either drops the file:
//   (1) `absoluteNumbered` — a long-running anime (One Piece, Naruto, Conan) ships as
//       "One Piece - 001", never scene "S01E01", so ANY SxxExx file is a different
//       production (catches a year-less live-action "One Piece S01E01").
//   (2) a disambiguation YEAR newer than the anime's debut alongside scene SxxExx
//       numbering (catches "One.Piece.2023.S01E01" for shorter shows too).
// Both keep unknowns (never drop a plain absolute-numbered release).
export function likelyOtherProduction(stream: Stream, animeYear?: number, absoluteNumbered = false): boolean {
  const name = nameOf(stream)
  const hasSceneEp = /\bS\d{1,2}E\d{1,3}\b/i.test(name)
  if (!hasSceneEp) return false // anime = absolute numbering
  if (absoluteNumbered) return true // long-runner + SxxExx ⇒ not the anime
  if (!animeYear) return false
  const years = [...name.matchAll(/\b(19\d{2}|20\d{2})\b/g)].map((m) => Number(m[1]))
    .filter((y) => y >= 1950 && y <= 2035)
  if (!years.length || years.includes(animeYear)) return false
  return years.some((y) => y > animeYear + 1)
}
