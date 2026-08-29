import { phttp } from '$lib/net/http'

export type AwardFamily = 'oscar' | 'emmy' | 'golden-globe' | 'bafta' | 'sag' | 'critics-choice' | 'cannes' | 'venice' | 'berlin' | 'other'

export interface AwardSummary {
  family: AwardFamily
  label: string
  wins: number
  nominations: number
  recognitions: AwardRecognition[]
}

export interface AwardRecognition {
  label: string
  result: 'winner' | 'nominee'
}

interface SparqlBinding {
  awardLabel?: { value?: string }
  result?: { value?: string }
}

const FAMILY_ORDER: AwardFamily[] = ['oscar', 'emmy', 'golden-globe', 'bafta', 'sag', 'cannes', 'venice', 'berlin', 'critics-choice']
const FAMILY_LABEL: Record<AwardFamily, string> = {
  oscar: 'Academy Award',
  emmy: 'Primetime Emmy',
  'golden-globe': 'Golden Globe',
  bafta: 'BAFTA',
  sag: 'SAG Award',
  'critics-choice': 'Critics’ Choice',
  cannes: 'Cannes',
  venice: 'Venice',
  berlin: 'Berlin',
  other: 'Award',
}

export function classifyAward(name: string): AwardFamily | null {
  const value = name.toLowerCase()
  if (value.includes('academy award') || value.includes('oscar')) return 'oscar'
  if (value.includes('emmy')) return 'emmy'
  if (value.includes('golden globe')) return 'golden-globe'
  if (value.includes('bafta') || value.includes('british academy')) return 'bafta'
  if (value.includes('screen actors guild') || value.includes('sag award')) return 'sag'
  if (value.includes("critics' choice") || value.includes('critics choice')) return 'critics-choice'
  if (value.includes('palme') || value.includes('cannes')) return 'cannes'
  if (value.includes('golden lion') || value.includes('venice')) return 'venice'
  if (value.includes('golden bear') || value.includes('berlin')) return 'berlin'
  return null
}

const compactProviderAwards = (value: string): string => value
  .replace(/\s+total\s*$/i, '')
  .replace(/\s*&\s*/g, ' · ')
  .replace(/[.!?;]+\s*$/, '')
  .replace(/\s+/g, ' ')
  .trim()

export function namedProviderAward(value?: string): string {
  if (!value) return ''
  const named = /\b(?:academy awards?|oscars?|emmys?|golden globes?|bafta|screen actors guild|sag awards?|critics[’']? choice|cannes|venice|berlin|sundance|sxsw|film festival|grand jury prize)\b/i
  const genericFamilyTotal = /^(?:won|nominated for)\s+\d+\s+(?:academy awards?|oscars?|(?:primetime\s+)?emmys?|golden globes?|baftas?|sag awards?)\b/i
  return value
    .split(/(?<=[.!?;])\s+/)
    .map(compactProviderAwards)
    .find((part) => named.test(part) && !genericFamilyTotal.test(part)) ?? ''
}

export function summarizeAwardBindings(bindings: SparqlBinding[]): AwardSummary[] {
  const unique = new Map<string, { family: AwardFamily; label: string; result: 'won' | 'nominated' }>()
  for (const binding of bindings) {
    const name = binding.awardLabel?.value?.trim()
    const result = binding.result?.value === 'won' ? 'won' : binding.result?.value === 'nominated' ? 'nominated' : null
    if (!name || !result) continue
    unique.set(`${name.toLowerCase()}:${result}`, { family: classifyAward(name) ?? 'other', label: name, result })
  }
  const wonNames = new Set([...unique].filter(([, value]) => value.result === 'won').map(([key]) => key.replace(/:won$/, '')))
  const counts = new Map<string, AwardSummary>()
  for (const [key, value] of unique) {
    if (value.result === 'nominated' && wonNames.has(key.replace(/:nominated$/, ''))) continue
    const bucket = value.family === 'other' ? `other:${value.label.toLowerCase()}` : value.family
    const count = counts.get(bucket) ?? {
      family: value.family,
      label: value.family === 'other' ? value.label : FAMILY_LABEL[value.family],
      wins: 0,
      nominations: 0,
      recognitions: [],
    }
    if (value.result === 'won') count.wins++
    else count.nominations++
    count.recognitions.push({
      label: value.label,
      result: value.result === 'won' ? 'winner' : 'nominee',
    })
    counts.set(bucket, count)
  }
  for (const summary of counts.values()) {
    summary.recognitions.sort((left, right) =>
      Number(right.result === 'winner') - Number(left.result === 'winner')
      || left.label.localeCompare(right.label))
  }
  const known = FAMILY_ORDER.flatMap((family) => counts.get(family) ?? [])
  const named = [...counts.values()]
    .filter((item) => item.family === 'other')
    .sort((left, right) => right.wins - left.wins || right.nominations - left.nominations || left.label.localeCompare(right.label))
  return [...known, ...named].slice(0, 12)
}

const QUERY = `SELECT DISTINCT ?awardLabel ?result WHERE {
  ?work wdt:P345 "IMDB_ID".
  {
    { ?work p:P166 ?statement. ?statement ps:P166 ?award. }
    UNION
    { ?recipient p:P166 ?statement. ?statement pq:P1686 ?work. ?statement ps:P166 ?award. }
    BIND("won" AS ?result)
  }
  UNION
  {
    { ?work p:P1411 ?statement. ?statement ps:P1411 ?award. }
    UNION
    { ?recipient p:P1411 ?statement. ?statement pq:P1686 ?work. ?statement ps:P1411 ?award. }
    BIND("nominated" AS ?result)
  }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
}
LIMIT 800`

const requests = new Map<string, Promise<AwardSummary[]>>()

export function fetchAwardSummary(imdbId: string, signal?: AbortSignal): Promise<AwardSummary[]> {
  if (!/^tt\d+$/i.test(imdbId)) return Promise.resolve([])
  const key = imdbId.toLowerCase()
  const existing = requests.get(key)
  if (existing) return existing
  const query = QUERY.replace('IMDB_ID', key)
  const url = `https://query.wikidata.org/sparql?query=${encodeURIComponent(query)}&format=json`
  const request = phttp(url, {
    signal,
    timeoutMs: 12_000,
    maxBytes: 2 * 1024 * 1024,
    headers: { Accept: 'application/sparql-results+json' },
  }).then(async (response) => {
    if (!response.ok) return []
    const data = await response.json() as { results?: { bindings?: SparqlBinding[] } }
    return summarizeAwardBindings(data.results?.bindings ?? [])
  }).catch(() => []).finally(() => {
    if (signal?.aborted) requests.delete(key)
  })
  requests.set(key, request)
  return request
}
