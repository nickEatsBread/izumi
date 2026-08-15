type Lookup = () => Promise<number | undefined>

export const KITSU_MAPPING_HEDGE_MS = 250

type LightweightResult = {
  source: 'per-title' | 'mal-id'
  value: number | undefined
}

function safeLookup(lookup: Lookup): Promise<number | undefined> {
  return Promise.resolve().then(lookup).catch(() => undefined)
}

function firstResultOrHedge(primary: Promise<number | undefined>): Promise<LightweightResult | null> {
  return new Promise((resolve) => {
    let settled = false
    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      resolve(null)
    }, KITSU_MAPPING_HEDGE_MS)
    primary.then((value) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve({ source: 'per-title', value })
    })
  })
}

/** Resolve from cheap endpoints first. Hedge a slow per-title request after a short head start so
 *  it cannot gate the independent MAL lookup; the multi-megabyte bulk index remains last resort. */
export async function resolveKitsuMapping(
  perTitle: Lookup,
  byMalId: Lookup,
  bulkIndex: Lookup,
): Promise<number | undefined> {
  const primary = safeLookup(perTitle)
  const first = await firstResultOrHedge(primary)
  if (first?.value != null) return first.value

  const secondary = safeLookup(byMalId)
  if (first) return await secondary ?? await bulkIndex()

  const winner = await Promise.race<LightweightResult>([
    primary.then((value) => ({ source: 'per-title', value })),
    secondary.then((value) => ({ source: 'mal-id', value })),
  ])
  if (winner.value != null) return winner.value

  const remaining = winner.source === 'per-title' ? secondary : primary
  return await remaining ?? await bulkIndex()
}
