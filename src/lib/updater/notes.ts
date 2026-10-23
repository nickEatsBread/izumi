// Release bodies are generated markdown: an intro line, a "## Changes" list of commit subjects
// with short hashes and PR numbers, and a changelog link. The update dialog shows the list only.

/** Commit types that never describe something a user would notice. */
const INTERNAL = /^(chore|ci|build|test|docs)(\([^)]*\))?!?:/i

/** Plain-text change bullets from a release body, at most `max`, plus how many were cut. */
export function releaseHighlights(body: string, max = 5): { items: string[]; more: number } {
  const all = body.split(/\r?\n/)
    .filter((line) => /^\s*[-*+]\s+/.test(line))
    .map((line) => line.replace(/^\s*[-*+]\s+/, ''))
    .filter((line) => !INTERNAL.test(line))
    .map((line) => line
      .replace(/(\s*\((#\d+|[0-9a-f]{7,40})\))+\s*$/i, '') // trailing (#147) PR refs and (4a650d50) hashes
      .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1') // [text](url) → text
      .replace(/\*\*|`/g, '')
      .replace(/^[a-z]+(\([^)]*\))?!?:\s*/, '') // "fix(scope): ", but not a capitalised "Deck: "
      .trim())
    .filter(Boolean)
    .map((line) => line[0].toUpperCase() + line.slice(1))
  return { items: all.slice(0, max), more: Math.max(0, all.length - max) }
}
