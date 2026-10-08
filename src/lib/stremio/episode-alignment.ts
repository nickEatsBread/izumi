// Repairs for the per-episode season numbering a mapping service attaches to AniList episodes.
//
// The service pairs AniList episodes with episode-database rows by air date, and that pairing slips
// in two recognisable ways. A new season whose AniList dates run ahead of the database (an early
// streaming premiere, a double-episode premiere) leaves episode 1 unmatched, pairs episode 2 with
// the database's first episode, and every later episode inherits the lag: episode 2 is then asked
// for as S2E1, the season verifier rightly discards every file that comes back, and only the few
// rows found by other ids survive. Long-running shows instead show single rows that jumped onto a
// neighbour, which made the verifier accept the neighbouring episode's absolute-numbered files.
//
// AniList numbering is sequential, so both slips are visible as a row that duplicates its neighbour.
// Repairs follow AniList's count because releases do: even where the database folds a double
// premiere into one row, the second episode ships as its own S01E02 under its own title.
// Only shapes with exactly one consistent explanation are repaired; anything else is left as given.

export interface EpisodeNumbers {
  season?: number
  /** Number within `season`. */
  episode?: number
  /** Number across the whole series. */
  abs?: number
}

const int = (value: unknown): value is number => typeof value === 'number' && Number.isInteger(value)

/** The episode numbers with folded premieres and single misplaced rows repaired. Pure. */
export function alignEpisodeNumbers(input: Record<number, EpisodeNumbers>): Record<number, EpisodeNumbers> {
  const rows: Record<number, EpisodeNumbers> = {}
  for (const [key, row] of Object.entries(input)) rows[Number(key)] = { ...row }
  const numbers = Object.keys(rows).map(Number).filter(Number.isInteger).sort((a, b) => a - b)
  if (numbers.length < 2) return rows
  const first = numbers.find((number) => number >= 1)
  if (first != null) unfoldPremiere(rows, first)
  for (const number of numbers) closeGap(rows, number)
  return rows
}

// The entry's first two episodes share one database episode. With nothing before the first one,
// it is the anchor: the rows after it shift up by one for as long as they still follow the lagging
// count, and stop where the service's numbering has already caught up.
function unfoldPremiere(rows: Record<number, EpisodeNumbers>, first: number) {
  const anchor = rows[first], next = rows[first + 1]
  if (!anchor || !next || !int(anchor.season) || next.season !== anchor.season) return
  if (!int(anchor.episode) || next.episode !== anchor.episode) return
  if (int(anchor.abs) && int(next.abs) && next.abs !== anchor.abs) return
  // The pair shares one absolute number; take it from whichever of the two carries it.
  const abs = int(anchor.abs) ? anchor.abs : next.abs
  for (let number = first + 1; ; number++) {
    const row = rows[number], lag = number - first - 1
    if (!row || row.season !== anchor.season || row.episode !== anchor.episode + lag) break
    row.episode = anchor.episode + lag + 1
    if (int(abs) && row.abs === abs + lag) row.abs = abs + lag + 1
  }
}

// A row that duplicates one neighbour while its two neighbours leave exactly one number free
// between them belongs in that free number. The in-season number is only compared inside one
// season; the absolute number runs across seasons. A season's first row has no same-season row
// before it, so once its absolute number shows it is the misplaced one, it takes the in-season
// number just before the row it duplicated.
function closeGap(rows: Record<number, EpisodeNumbers>, number: number) {
  const before = rows[number - 1], row = rows[number], after = rows[number + 1]
  if (!before || !row || !after) return
  if (int(row.season) && before.season === row.season && after.season === row.season
    && int(before.episode) && int(after.episode) && after.episode - before.episode === 2
    && (row.episode === before.episode || row.episode === after.episode)) {
    row.episode = before.episode + 1
  }
  if (int(before.abs) && int(after.abs) && after.abs - before.abs === 2
    && (row.abs === before.abs || row.abs === after.abs)) {
    row.abs = before.abs + 1
    if (int(row.season) && before.season !== row.season && after.season === row.season
      && int(after.episode) && row.episode === after.episode && after.episode > 1) {
      row.episode = after.episode - 1
    }
  }
}

export interface ProviderEpisode {
  seasonNumber?: number
  episodeNumber?: number
  absoluteEpisodeNumber?: number
  /** Episode-database id of THIS episode; it moves with the repaired numbers. */
  tvdbId?: number
}

/**
 * The mapping service's `episodes` object with every numbered row repaired by
 * {@link alignEpisodeNumbers}. Unchanged rows and special keys keep their identity; a repaired row
 * is a copy whose episode-database id is taken from the row that originally carried its new
 * numbers, or dropped when no single row did.
 */
export function alignProviderEpisodes<T extends ProviderEpisode>(
  episodes: Record<string, T> | null | undefined,
): Record<string, T> {
  const result: Record<string, T> = { ...(episodes ?? {}) }
  const numbered: Record<number, EpisodeNumbers> = {}
  for (const [key, row] of Object.entries(result)) {
    if (!/^\d+$/.test(key) || !row) continue
    numbered[Number(key)] = { season: row.seasonNumber, episode: row.episodeNumber, abs: row.absoluteEpisodeNumber }
  }
  const aligned = alignEpisodeNumbers(numbered)
  const owners = new Map<string, T[]>()
  for (const [key, row] of Object.entries(result)) {
    if (!/^\d+$/.test(key) || !row || !int(row.seasonNumber) || !int(row.episodeNumber)) continue
    const slot = `${row.seasonNumber}:${row.episodeNumber}`
    owners.set(slot, [...(owners.get(slot) ?? []), row])
  }
  for (const [key, numbers] of Object.entries(aligned)) {
    const row = result[key]
    if (numbers.episode === row.episodeNumber && numbers.abs === row.absoluteEpisodeNumber) continue
    const movedSlot = numbers.episode !== row.episodeNumber
    const owner = movedSlot ? owners.get(`${numbers.season}:${numbers.episode}`) : undefined
    result[key] = {
      ...row,
      episodeNumber: numbers.episode,
      absoluteEpisodeNumber: numbers.abs,
      tvdbId: movedSlot ? (owner?.length === 1 ? owner[0].tvdbId : undefined) : row.tvdbId,
    }
  }
  return result
}
