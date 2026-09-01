<script lang="ts">
  import { page } from '$app/state'
  import { getContextClient, queryStore } from '@urql/svelte'
  import { STAFF_PROFILE_QUERY, type SearchFilters } from '$lib/anilist/detail-queries'
  import type { FuzzyDate } from '$lib/anilist/types'
  import SearchResults from '$lib/components/search/SearchResults.svelte'
  import OfflineUnavailable from '$lib/components/offline/OfflineUnavailable.svelte'
  import { offlineMode } from '$lib/stores/offline'
  import { heroMedia } from '$lib/stores/hero'
  import { showAdult } from '$lib/settings/ui'
  import { openUrl } from '@tauri-apps/plugin-opener'
  import ExternalLink from '@lucide/svelte/icons/external-link'
  import Heart from '@lucide/svelte/icons/heart'

  interface StaffProfile {
    id: number
    name: { full?: string; native?: string; alternative?: string[]; userPreferred?: string }
    languageV2?: string
    image?: { large?: string; medium?: string }
    description?: string
    primaryOccupations?: string[]
    gender?: string
    dateOfBirth?: FuzzyDate
    dateOfDeath?: FuzzyDate
    age?: number
    yearsActive?: number[]
    homeTown?: string
    bloodType?: string
    siteUrl?: string
    favourites?: number
  }

  heroMedia.set(null)
  const client = getContextClient()
  const id = $derived(Number(page.params.id))
  const filters = $derived<SearchFilters>({ staffId: id })
  const store = $derived(queryStore<{ Staff?: StaffProfile | null }>({
    client,
    query: STAFF_PROFILE_QUERY,
    variables: { id },
    pause: $offlineMode || !Number.isFinite(id),
  }))

  function fuzzyDate(date?: FuzzyDate) {
    if (!date?.year) return ''
    if (!date.month) return String(date.year)
    const value = new Date(Date.UTC(date.year, date.month - 1, date.day ?? 1))
    return value.toLocaleDateString(undefined, date.day
      ? { year: 'numeric', month: 'long', day: 'numeric' }
      : { year: 'numeric', month: 'long' })
  }

  function activeYears(years?: number[]) {
    if (!years?.length) return ''
    return years.length > 1 ? `${years[0]}–${years[1] || 'present'}` : `${years[0]}–present`
  }
</script>

{#if $offlineMode}
  <OfflineUnavailable title="Staff pages are unavailable offline" subtitle="Reconnect to browse this person's anime credits." />
{:else}
  <main class="p-4 pb-16 sm:p-8">
    {#if $store.fetching}
      <div class="mb-8 flex gap-4">
        <div class="skeloader aspect-[2/3] w-28 shrink-0 rounded-xl"></div>
        <div class="flex-1 space-y-3"><div class="skeloader h-8 w-64 max-w-full rounded"></div><div class="skeloader h-4 w-40 rounded"></div><div class="skeloader h-16 max-w-xl rounded"></div></div>
      </div>
    {:else if $store.error}
      <div class="rounded-xl border border-destructive/40 bg-destructive/10 p-4">
        <h1 class="font-black">Couldn’t load this staff member</h1>
        <p class="mt-1 text-sm text-muted-foreground">{$store.error.message}</p>
      </div>
    {:else if $store.data?.Staff}
      {@const staff = $store.data.Staff}
      <header class="mb-9 flex flex-col gap-5 sm:flex-row">
        {#if staff.image?.large || staff.image?.medium}
          <img src={staff.image.large ?? staff.image.medium} alt="" class="aspect-[2/3] w-32 shrink-0 rounded-xl bg-muted object-cover shadow-xl sm:w-40" />
        {/if}
        <div class="min-w-0 max-w-4xl flex-1">
          {#if staff.name.native}<p class="text-sm text-muted-foreground">{staff.name.native}</p>{/if}
          <div class="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h1 class="text-3xl font-black">{staff.name.userPreferred ?? staff.name.full ?? 'Staff member'}</h1>
              {#if staff.primaryOccupations?.length}
                <p class="mt-1 text-sm font-bold text-theme">{staff.primaryOccupations.join(' · ')}</p>
              {/if}
            </div>
            {#if staff.siteUrl}
              <button data-focusable type="button" onclick={() => void openUrl(staff.siteUrl!)}
                class="flex items-center gap-2 rounded-lg bg-secondary px-3 py-2 text-sm font-bold transition-colors hover:bg-accent">
                AniList <ExternalLink size={15} />
              </button>
            {/if}
          </div>

          <div class="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
            {#if staff.languageV2}<span>{staff.languageV2}</span>{/if}
            {#if staff.homeTown}<span>From {staff.homeTown}</span>{/if}
            {#if fuzzyDate(staff.dateOfBirth)}<span>Born {fuzzyDate(staff.dateOfBirth)}</span>{/if}
            {#if fuzzyDate(staff.dateOfDeath)}<span>Died {fuzzyDate(staff.dateOfDeath)}</span>{:else if staff.age}<span>Age {staff.age}</span>{/if}
            {#if activeYears(staff.yearsActive)}<span>Active {activeYears(staff.yearsActive)}</span>{/if}
            {#if staff.favourites}<span class="flex items-center gap-1"><Heart size={13} /> {staff.favourites.toLocaleString()} favourites</span>{/if}
          </div>

          {#if staff.description}
            <p class="mt-4 max-w-3xl whitespace-pre-line text-sm leading-relaxed text-muted-foreground">{staff.description}</p>
          {/if}
        </div>
      </header>

      <section>
        <h2 class="mb-4 text-xl font-black">Anime credits</h2>
        {#key `${id}|${$showAdult}`}
          <SearchResults {filters} />
        {/key}
      </section>
    {:else}
      <p class="text-muted-foreground">Staff member not found.</p>
    {/if}
  </main>
{/if}
