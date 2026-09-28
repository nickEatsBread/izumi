// The series page's sections (API 3 `detail.sections`): which get a tab, in what order and under
// which name, the tab open on arrival, and whether phones move the facts into Overview. Without a
// theme this reproduces izumi's own tabs exactly.
import type { DetailSection, DetailSections, TabLabel } from '$lib/themes/presentation'

/** izumi's own tab order. Desktop calls Overview "Details" and puts it last. */
const PHONE_ORDER: readonly DetailSection[] = ['episodes', 'overview', 'relations', 'characters', 'recommended']
const DESKTOP_ORDER: readonly DetailSection[] = ['episodes', 'relations', 'characters', 'recommended', 'overview']
const PHONE_LABELS: Record<DetailSection, string> = { episodes: 'Episodes', overview: 'Overview', relations: 'Relations', characters: 'Characters', recommended: 'Recommended' }
const DESKTOP_LABELS: Record<DetailSection, string> = { episodes: 'Episodes', overview: 'Details', relations: 'Relations', characters: 'Cast & Crew', recommended: 'Recommended' }

/** The fixed tab names a theme picks from (`detail.sections.labels`). */
export const TAB_LABEL_TEXT: Record<TabLabel, string> = {
  overview: 'Overview', info: 'Info', details: 'Details', about: 'About', home: 'Home',
  episodes: 'Episodes', watch: 'Watch',
  relations: 'Relations', related: 'Related',
  characters: 'Characters', cast: 'Cast',
  recommended: 'Recommended', 'more-like-this': 'More like this',
}

export interface ResolvedSections {
  mode: 'tabs' | 'stack'
  /** Sections with a tab (stacked: the sections drawn first), in order. */
  tabs: DetailSection[]
  /** Sections without a tab: rendered inside Overview after its own content (stacked: after `tabs`). */
  folded: DetailSection[]
  labels: Record<DetailSection, string>
  /** The tab open on arrival. */
  initial: DetailSection
  /** Phones: the facts, countdown, release timing, genres and synopsis sit inside Overview. */
  infoInOverview: boolean
}

/** `episodesTabbed` is false when the episodes sit in a right-hand rail or below the info: then they
 *  render there and never take a tab. */
export function resolveSections(sections: DetailSections | undefined, options: { phone: boolean; episodesTabbed: boolean }): ResolvedSections {
  const available = (options.phone ? PHONE_ORDER : DESKTOP_ORDER).filter((id) => id !== 'episodes' || options.episodesTabbed)
  const listed = sections?.tabs?.filter((id) => available.includes(id))
  const tabs: DetailSection[] = !listed ? [...available] : listed.includes('overview') ? listed : [...listed, 'overview']
  const folded = listed ? available.filter((id) => !tabs.includes(id)) : []
  const labels = { ...(options.phone ? PHONE_LABELS : DESKTOP_LABELS) }
  for (const [id, label] of Object.entries(sections?.labels ?? {}) as [DetailSection, TabLabel | undefined][]) {
    if (label) labels[id] = TAB_LABEL_TEXT[label]
  }
  const initial = sections?.default && tabs.includes(sections.default) ? sections.default : tabs[0]
  return { mode: sections?.mode ?? 'tabs', tabs, folded, labels, initial, infoInOverview: options.phone && sections?.info === 'overview' }
}

/** Where the desktop stacked and split pages show the synopsis. izumi's own page keeps a short one
 *  in the info column and the whole text in Overview (`both`). A theme that composes the sections
 *  shows it once: in the info column (`info`), or in Overview with `info: "overview"` (`overview`),
 *  so Overview never repeats the info column. */
export function desktopSynopsis(sections: DetailSections | undefined): 'both' | 'info' | 'overview' {
  if (!sections) return 'both'
  return sections.info === 'overview' ? 'overview' : 'info'
}

/** Whether the episode list is on the page, and with it what sits at its top (the Continue card):
 *  always when the episodes sit `outside` the sections (a right-hand rail, below the header) or the
 *  sections are stacked; otherwise while `open` is the Episodes tab, or Overview with the episodes
 *  folded into it. */
export function episodesOnPage(view: ResolvedSections, open: DetailSection, outside: boolean): boolean {
  if (outside || view.mode === 'stack') return true
  return open === 'episodes' || (open === 'overview' && view.folded.includes('episodes'))
}
