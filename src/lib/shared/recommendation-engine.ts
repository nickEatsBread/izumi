/**
 * Izumi recommendation engine v2. Pure, deterministic and runtime-independent.
 * SPDX-License-Identifier: GPL-3.0-or-later
 * No Svelte, network, storage, account tokens or global clock.
 * The independently licensed TV consumes ranked results over encrypted sync.
 * Scores express ordering, NOT a probability that someone will like a title.
 */
export interface TasteItem {
  key: string
  aliases?: string[]
  title: string
  provider: string
  kind?: string
  genres?: string[]
  tags?: string[]
  people?: string[]
  studios?: string[]
  language?: string
  country?: string
  year?: number
  quality?: number
  votes?: number
}
export interface TasteSignal {
  item: TasteItem
  weight: number
  at?: number
  /** Direct opinions > saves > library tracking > incidental viewing. */
  priority?: number
  source?: string
}
export interface Recommendation {
  key: string
  score: number
  reason: string
  evidence: string[]
  exploration: boolean
}
export interface RecommendationOptions {
  now: number
  limit?: number
  excluded?: string[]
  exploration?: boolean
  signalLimit?: number
}

const DAY = 86_400_000
const clean = (value: string) => value.trim().toLowerCase().replace(/[ _-]+/g, ' ')
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, Number.isFinite(value) ? value : 0))
const identity = (item: TasteItem) => [item.key, ...(item.aliases ?? [])]
const genreName = (value: string) => {
  const key = clean(value)
  return ['science fiction', 'sci fi', 'scifi'].includes(key) ? 'science fiction' : key
}

function features(item: TasteItem): Map<string, { weight: number; label: string }> {
  const result = new Map<string, { weight: number; label: string }>()
  const add = (prefix: string, values: string[], weight: number) => {
    for (const value of values.filter(Boolean).slice(0, 12)) {
      result.set(prefix + ':' + (prefix === 'genre' ? genreName(value) : clean(value)), { weight, label: value })
    }
  }
  add('genre', item.genres ?? [], 1)
  add('tag', item.tags ?? [], .7)
  add('person', item.people ?? [], 1.3)
  add('studio', item.studios ?? [], .65)
  add('language', item.language ? [item.language] : [], .3)
  add('country', item.country ? [item.country] : [], .2)
  add('kind', item.kind ? [item.kind] : [], .15)
  if (item.year) add('decade', [String(Math.floor(item.year / 10) * 10)], .15)
  return result
}

function fraction(value: string): number {
  let hash = 2166136261
  for (let index = 0; index < value.length; index++) hash = Math.imul(hash ^ value.charCodeAt(index), 16777619)
  return (hash >>> 0) / 4294967295
}

function mergeFeatures(first: TasteItem, next: TasteItem): TasteItem {
  const values = (a?: string[], b?: string[]) => [...new Map([...(a ?? []), ...(b ?? [])]
    .filter(Boolean).map(value => [clean(value), value])).entries()]
    .sort(([a], [b]) => a.localeCompare(b)).slice(0, 12).map(([, value]) => value)
  return {
    ...next, ...Object.fromEntries(Object.entries(first).filter(([, value]) => value != null)),
    aliases: [...new Set([...identity(first), ...identity(next)])],
    genres: values(first.genres, next.genres), tags: values(first.tags, next.tags),
    people: values(first.people, next.people), studios: values(first.studios, next.studios),
  }
}

/** Reserve room for viewing evidence even in a large library. Resolve conflicting signals for
 * each title before budgeting so dropping a rating never resurrects a weaker save for that title. */
function budgetSignals(signals: TasteSignal[], limit = signals.length): TasteSignal[] {
  if (signals.length <= limit) return signals
  const buckets = [signals.filter(s => (s.priority ?? 0) >= 3),
    signals.filter(s => s.priority === 2), signals.filter(s => (s.priority ?? 0) < 2)]
  for (const bucket of buckets) bucket.sort((a, b) => (b.at ?? 0) - (a.at ?? 0) || a.item.key.localeCompare(b.item.key))
  const selected = buckets.flatMap((bucket, index) => bucket.splice(0, Math.floor(limit * (index === 0 ? .4 : .3))))
  while (selected.length < limit && buckets.some(bucket => bucket.length)) {
    for (const bucket of buckets) if (bucket.length && selected.length < limit) selected.push(bucket.shift()!)
  }
  return selected
}

/** Cross-provider duplicates use verified IDs, never fuzzy title matching (remakes stay distinct).
 * Union all aliases first so a later bridging record also deduplicates earlier candidates. */
export function rankRecommendations(candidates: TasteItem[], signals: TasteSignal[], options: RecommendationOptions): Recommendation[] {
  const parent = new Map<string, string>()
  const root = (key: string): string => {
    const next = parent.get(key)
    if (!next) { parent.set(key, key); return key }
    if (next === key) return key
    const result = root(next)
    parent.set(key, result)
    return result
  }
  for (const item of [...candidates, ...signals.map(signal => signal.item)]) {
    for (const alias of identity(item)) {
      const a = root(alias), b = root(item.key)
      parent.set(a < b ? b : a, a < b ? a : b)
    }
  }
  const excluded = new Set((options.excluded ?? []).map(root))
  const unique = new Map<string, TasteItem>()
  for (const item of candidates) {
    const key = root(item.key)
    if (!excluded.has(key)) unique.set(key, unique.has(key) ? mergeFeatures(unique.get(key)!, item) : item)
  }
  // One title cannot multiply its influence by being present in history, library and two catalogs.
  const strongest = new Map<string, TasteSignal>()
  for (const signal of signals) {
    if (!Number.isFinite(signal.weight)) continue
    const key = root(signal.item.key)
    const prior = strongest.get(key)
    const newer = !prior || (signal.priority ?? 0) > (prior.priority ?? 0)
      || (signal.priority ?? 0) === (prior.priority ?? 0) && ((signal.at ?? 0) > (prior.at ?? 0)
        || (signal.at ?? 0) === (prior.at ?? 0) && Math.abs(signal.weight) > Math.abs(prior.weight))
    const chosen = newer ? signal : prior!
    strongest.set(key, prior ? { ...chosen, item: mergeFeatures(chosen.item, newer ? prior.item : signal.item) } : chosen)
  }
  const seeds = budgetSignals([...strongest.values()], options.signalLimit).map(signal => ({
    ...signal,
    features: features(signal.item),
    weight: clamp(signal.weight, -3, 3) * (signal.at ? Math.pow(.5, Math.max(0, options.now - signal.at) / (180 * DAY)) : 1),
  }))
  const affinity = new Map<string, number>()
  for (const seed of seeds) for (const [key, feature] of seed.features) {
    affinity.set(key, (affinity.get(key) ?? 0) + seed.weight * feature.weight)
  }
  // Saturation prevents a thousand action titles from making every other genre unreachable.
  for (const [key, weight] of affinity) affinity.set(key, weight / (2 + Math.abs(weight)))
  const hasTaste = seeds.some(seed => seed.weight > .05)
  const scored = [...unique.values()].map(item => {
    const own = features(item)
    let affinityScore = 0
    for (const [key, feature] of own) affinityScore += (affinity.get(key) ?? 0) * feature.weight
    affinityScore /= Math.sqrt(Math.max(1, (item.genres?.length ?? 0) + (item.tags?.length ?? 0) * .4))
    const matches = seeds.filter(seed => seed.weight > .05).map(seed => {
      const shared = [...own.keys()].filter(key => seed.features.has(key) && !/^(kind|decade|country|language):/.test(key))
      const value = shared.reduce((sum, key) => sum + (own.get(key)?.weight ?? 0), 0) * seed.weight
      return { seed, shared, value }
    }).sort((a, b) => b.value - a.value)
    const best = matches[0]?.value > 0 ? matches[0] : undefined
    const sharedLabels = best?.shared.filter(key => key.startsWith('genre:') || key.startsWith('tag:')).slice(0, 3).map(key => own.get(key)!.label) ?? []
    const evidence: string[] = []
    if (best) {
      evidence.push(`Connected to “${best.seed.item.title}” in your ${best.seed.source ?? 'viewing activity'}.`)
      evidence.push(sharedLabels.length ? `Shared interests: ${sharedLabels.join(', ')}.` : 'Shares a credited contributor or studio.')
    }
    const quality = item.quality == null ? .55 : clamp(item.quality, 0, 1)
    const confidence = item.votes == null ? .45 : clamp(Math.log1p(Math.max(0, item.votes)) / 9, .1, 1)
    const reliableQuality = .55 + (quality - .55) * confidence
    const score = affinityScore * 2.4 + reliableQuality * .7
      + fraction(`${Math.floor(options.now / DAY)}:${root(item.key)}`) * .08
    const reason = best
      ? sharedLabels.length ? `${sharedLabels.slice(0, 2).join(' + ')} · inspired by ${best.seed.item.title}` : `A creative connection to ${best.seed.item.title}`
      : hasTaste ? 'Something outside your usual picks' : 'A starting point from your catalogs'
    if (!best) evidence.push(hasTaste ? 'An exploration pick, not a claimed taste match.' : 'No strong taste match yet. Save titles or mark them not for you to shape future picks.')
    evidence.push('Ratings are a small tie-breaker, not a predicted match percentage.')
    return { key: item.key, score, reason, evidence, exploration: !best, item }
  }).sort((a, b) => b.score - a.score || a.key.localeCompare(b.key))
  const selected: typeof scored = []
  const providers = new Map<string, number>()
  while (scored.length && selected.length < (options.limit ?? 60)) {
    let bestIndex = 0, bestScore = -Infinity
    for (let index = 0; index < scored.length; index++) {
      const candidate = scored[index]
      const genreSet = new Set((candidate.item.genres ?? []).map(genreName))
      const repetition = selected.slice(-4).reduce((sum, prior) => {
        const overlap = (prior.item.genres ?? []).filter(genre => genreSet.has(genreName(genre))).length
        return sum + overlap / Math.max(1, genreSet.size)
      }, 0)
      const variety = options.exploration === false ? 0 : repetition * .2 + (providers.get(candidate.item.provider) ?? 0) * .09
      const score = candidate.score - variety
      if (score > bestScore) { bestScore = score; bestIndex = index }
    }
    const [picked] = scored.splice(bestIndex, 1)
    selected.push(picked)
    providers.set(picked.item.provider, (providers.get(picked.item.provider) ?? 0) + 1)
  }
  return selected.map(({ item: _item, ...recommendation }) => recommendation)
}
