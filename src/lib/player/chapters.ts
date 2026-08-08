import type { Chapter } from './chapter-skip'

// Chapter navigation. The player already parses the file's chapter list for seekbar ticks and
// OP/ED skip guesses; these are the queries that let the UI offer it as a jump list.
//
// Everything here is pure and assumes a SORTED list — call sortChapters() once where the list is
// stored, not on every query. The active-chapter lookup runs against the playback position, so a
// per-call sort would be work repeated at tick rate for a list that never changes mid-file.

/** Pressing Previous restarts the chapter you are in — unless you only just entered it, in which
 *  case you meant the one before. Standard mpv/DVD behaviour, and what makes the key usable for
 *  "replay this bit" rather than only "skip backwards". */
const PREV_RESTART_S = 3

/** Order a raw mpv chapter list and drop marks that cannot be seeked to. Call once, at the point
 *  the list is stored. Returns a new array; the input is left alone. */
export function sortChapters(chapters: Chapter[]): Chapter[] {
  return chapters
    .filter((c) => Number.isFinite(c.time) && c.time >= 0)
    .sort((a, b) => a.time - b.time)
}

/** Index of the chapter containing `pos`, or -1 when there is none (empty list, or a file whose
 *  first mark is not at 0 and playback has not reached it). Assumes sorted input.
 *
 *  On duplicate `time` values, resolves to the LAST match rather than deduping — a zero-length
 *  chapter sharing a timestamp with its neighbour is not a place you can actually seek to, so the
 *  one that is reachable wins. */
export function activeChapterIndex(chapters: Chapter[], pos: number): number {
  let lo = 0
  let hi = chapters.length - 1
  let found = -1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (chapters[mid].time <= pos) { found = mid; lo = mid + 1 }
    else hi = mid - 1
  }
  return found
}

/** Start of the chapter after `pos`, or null in the last chapter. Null rather than the file end:
 *  a Next key that seeks to the credits roll is worse than one that does nothing.
 *
 *  When `pos` precedes every chapter, activeChapterIndex's not-found sentinel of -1 plus 1 indexes
 *  element 0, which is what makes "jump to the first chapter" fall out for free below. That -1 is
 *  load-bearing here — changing the sentinel value later would silently break this path. */
export function nextChapterTarget(chapters: Chapter[], pos: number): number | null {
  const next = chapters[activeChapterIndex(chapters, pos) + 1]
  return next ? next.time : null
}

/** Start of the current chapter, or of the previous one when `pos` has only just entered this one.
 *  Null when there is nowhere to go back to. See PREV_RESTART_S. */
export function prevChapterTarget(chapters: Chapter[], pos: number): number | null {
  const i = activeChapterIndex(chapters, pos)
  if (i < 0) return null
  if (pos - chapters[i].time >= PREV_RESTART_S) return chapters[i].time
  return i > 0 ? chapters[i - 1].time : null
}

/** m:ss, or h:mm:ss past an hour. The three player components each carry their own private `fmt`
 *  (Controls.svelte, Seekbar.svelte, AndroidPlayer.svelte); this module owns its own rather than
 *  reaching into one of them. Unifying those three is real but unrelated cleanup. */
export function formatChapterTime(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const pad = (n: number) => String(n).padStart(2, '0')
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`
}

/** One-line label for a chapter row.
 *
 *  `title` is typed as a required string, but PlayerOverlay.svelte casts a raw `JSON.parse(...) as
 *  { time, title }[]` at the IPC boundary — a malformed payload can put `undefined` there at
 *  runtime despite the type. The `?.` is deliberate defence against that, not accidental noise. */
export function chapterRowLabel(chapter: Chapter): string {
  return `${chapter.title?.trim() || 'Chapter'} — ${formatChapterTime(chapter.time)}`
}
