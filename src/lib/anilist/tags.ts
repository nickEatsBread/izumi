// Pure helpers for the advanced-search tag picker — no DOM, unit-tested in tags.test.ts.

export interface MediaTag {
  name: string
  category: string
  rank?: number
  isAdult?: boolean
  isGeneralSpoiler?: boolean
  isMediaSpoiler?: boolean
}

export type TagGroup = { category: string; tags: MediaTag[] }

/**
 * Tri-state cycle for one tag: neutral → include → exclude → neutral. Returns NEW arrays
 * (never mutates). A name is only ever in one list — moving between include/exclude removes
 * it from the other by construction, so a tag can't be in both.
 */
export function cycleTag(name: string, include: string[], exclude: string[]): { include: string[]; exclude: string[] } {
  const inInc = include.includes(name)
  const inExc = exclude.includes(name)
  if (!inInc && !inExc) return { include: [...include, name], exclude } // neutral → include
  if (inInc) return { include: include.filter((n) => n !== name), exclude: [...exclude, name] } // include → exclude
  return { include, exclude: exclude.filter((n) => n !== name) } // exclude → neutral
}

/** The state of a tag for rendering the tri-state chip. */
export function tagState(name: string, include: string[], exclude: string[]): 'include' | 'exclude' | 'neutral' {
  if (include.includes(name)) return 'include'
  if (exclude.includes(name)) return 'exclude'
  return 'neutral'
}

/** Top-level category = the part before the first '-' (e.g. 'Theme-Action' → 'Theme'). */
export function topCategory(category: string): string {
  const i = category.indexOf('-')
  return i === -1 ? category : category.slice(0, i)
}

/**
 * Filter + group tags for the picker: drop spoiler tags unless `showSpoilers`, drop adult
 * tags unless `showAdult`, keep only tags matching `search` (case-insensitive substring on
 * the name), then group by top-level category. A tag already selected (include/exclude) is
 * ALWAYS kept visible so a hidden-but-active tag can be toggled off. Groups and the tags
 * within them come back in the input order.
 */
export function groupTags(
  tags: MediaTag[],
  opts: { search?: string; showSpoilers?: boolean; showAdult?: boolean; selected?: string[] } = {},
): TagGroup[] {
  const q = (opts.search ?? '').trim().toLowerCase()
  const selected = new Set(opts.selected ?? [])
  const groups: TagGroup[] = []
  const byCat = new Map<string, MediaTag[]>()
  for (const t of tags) {
    const isSelected = selected.has(t.name)
    if (!isSelected) {
      if ((t.isGeneralSpoiler || t.isMediaSpoiler) && !opts.showSpoilers) continue
      if (t.isAdult && !opts.showAdult) continue
      if (q && !t.name.toLowerCase().includes(q)) continue
    }
    const cat = topCategory(t.category)
    let bucket = byCat.get(cat)
    if (!bucket) { bucket = []; byCat.set(cat, bucket); groups.push({ category: cat, tags: bucket }) }
    bucket.push(t)
  }
  return groups
}
