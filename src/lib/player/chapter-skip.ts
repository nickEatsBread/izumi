import { LABELS, mergeOverlapping, type Segment, type SkipType } from '$lib/stremio/aniskip'

// Fallback skip segments derived from the file's own Matroska chapter titles.
//
// AniSkip is crowdsourced and thin outside popular titles, but well-tagged fansub and BD releases
// ship named chapters ("Opening", "ED", "Preview") — and the player already fetches and draws that
// chapter list, it just never read the titles. This turns them into the same Segment shape so the
// skip button, seekbar bands and automatic skipping all work unchanged.

export interface Chapter { time: number; title: string }

/** An OP/ED outside this range is a mis-tagged chapter, not a theme song. Real openings are 60-105s;
 *  the ceiling is deliberately generous for double-length premieres and creditless endings. */
const MIN_SEGMENT_S = 5
const MAX_THEME_S = 210
/** Recaps run longer than a theme (a "previously on" can be a couple of minutes) but not forever. */
const MAX_RECAP_S = 300

// Anchored, whitelist-only classification. The common generic namings — "Chapter 01", "Part 1",
// "Untitled", "00:00" — MUST fall through to no match: a wrong guess here seeks the user out of
// actual content, which is far worse than showing no skip button at all.
const PATTERNS: { type: SkipType; re: RegExp }[] = [
  { type: 'op', re: /^(?:nc)?op(?:ening)?(?:\s*\d+)?(?:\s*[-–—:|]\s*.*)?$/i },
  { type: 'op', re: /^(?:opening|intro)\b(?:\s+(?:song|theme|credits|sequence|animation))?\b/i },
  { type: 'op', re: /^(?:theme\s*song|title\s*sequence|main\s*title)\b/i },
  { type: 'ed', re: /^(?:nc)?ed(?:ing)?(?:\s*\d+)?(?:\s*[-–—:|]\s*.*)?$/i },
  { type: 'ed', re: /^(?:ending|outro|closing)\b(?:\s+(?:song|theme|credits|sequence|animation))?\b/i },
  { type: 'ed', re: /^(?:end\s*credits|credits)\b/i },
  { type: 'recap', re: /^(?:recap|previously(?:\s+on)?|summary|synopsis)\b/i },
]

/** Classify one chapter title, or null when it isn't recognisably a theme/recap. */
export function classifyChapter(title: string): SkipType | null {
  const clean = title.trim()
  if (!clean) return null
  return PATTERNS.find((p) => p.re.test(clean))?.type ?? null
}

/** Turn a chapter list into skip segments. A chapter runs until the next one starts (the last runs
 *  to `duration`), so an accurate duration is required — pass 0 and you get nothing rather than a
 *  final segment of unknown length. */
export function segmentsFromChapters(chapters: Chapter[], duration: number): Segment[] {
  if (!chapters.length || !(duration > 0)) return []
  const sorted = [...chapters]
    .filter((c) => Number.isFinite(c.time) && c.time >= 0 && c.time < duration)
    .sort((a, b) => a.time - b.time)

  const out: Segment[] = []
  for (let i = 0; i < sorted.length; i++) {
    const type = classifyChapter(sorted[i].title ?? '')
    if (!type) continue
    const start = sorted[i].time
    const end = Math.min(duration, sorted[i + 1]?.time ?? duration)
    const length = end - start
    if (length < MIN_SEGMENT_S) continue
    if (length > (type === 'recap' ? MAX_RECAP_S : MAX_THEME_S)) continue
    out.push({ start, end, type, label: LABELS[type] })
  }
  return mergeOverlapping(out)
}

/** Prefer AniSkip, fill the gaps from chapters.
 *
 *  AniSkip's crowd timings are tuned to the frame; chapter marks are wherever the muxer put them.
 *  So anything AniSkip already covers wins outright, and a chapter-derived segment is only kept
 *  when it doesn't overlap an AniSkip one at all. */
export function mergeSkipSegments(aniskip: Segment[], fromChapters: Segment[]): Segment[] {
  const overlaps = (s: Segment) => aniskip.some((a) => s.start < a.end && a.start < s.end)
  return [...aniskip, ...fromChapters.filter((s) => !overlaps(s))].sort((a, b) => a.start - b.start)
}
