import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

// Source-text assertions per repo convention for .svelte wiring: the "Recommended for You" row
// must work with zero tracker account and zero network on the critical path.
const row = readFileSync(fileURLToPath(new URL('../components/cards/PersonalizedRow.svelte', import.meta.url)), 'utf8')
const mergedHome = readFileSync(fileURLToPath(new URL('../components/catalog/MergedCatalogHome.svelte', import.meta.url)), 'utf8')
const home = readFileSync(fileURLToPath(new URL('../../routes/app/home/+page.svelte', import.meta.url)), 'utf8')

describe('local Recommended for You row', () => {
  it('ranks the cached catalog pool locally and warms it off the critical path', () => {
    expect(row).toContain("import { localForYou } from '$lib/recommendations/local-for-you'")
    expect(row).toContain('localCandidatePool, localCandidatesLoading, primeLocalCandidates')
    expect(row).toContain('if (seedIds.length) primeLocalCandidates($catalogProviders)')
    expect(row).toContain('localForYou($durableHistory, $localCandidatePool, {')
  })

  it('merges local picks first and lets AniList edges fill the remaining slots', () => {
    expect(row).toContain('local taste picks lead; AniList community edges fill the remaining slots')
    expect(row).toContain('if (!ranked.length) return localRecommendations')
    expect(row).toContain('forYouId(item.media)')
  })

  it('renders for anonymous viewers and shows a self-clearing skeleton while the pool warms', () => {
    expect(row).toContain('(!recommendations.length && $localCandidatesLoading)')
    expect(row).toContain('const hasTasteData = $derived(!!userName || seedIds.length > 0)')
  })

  it('is not account-gated on either home', () => {
    expect(mergedHome).not.toContain('{#if listUser}{#key listUser}<PersonalizedRow')
    expect(mergedHome).toContain('{#key listUser}<PersonalizedRow userName={listUser}')
    expect(home).toContain('{#key listUser}<PersonalizedRow userName={listUser}')
  })
})
