<script lang="ts">
  // Owns its own query store (like HomeRow / SearchResults). The parent keys
  // this component on the week offset, so a fresh store with the new
  // start/end range is created — and re-subscribed — on prev/next navigation.
  import { queryStore, getContextClient } from '@urql/svelte'
  import { SCHEDULE_QUERY } from '$lib/anilist/detail-queries'
  import { groupByDay, type Airing } from '$lib/anilist/schedule'
  import DayColumn from './DayColumn.svelte'

  let { start, end }: { start: number; end: number } = $props()

  const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']

  const client = getContextClient()
  const store = queryStore<{ Page: { airingSchedules: Airing[] } }>({
    client,
    query: SCHEDULE_QUERY,
    variables: { start, end },
  })

  const days = $derived(groupByDay($store.data?.Page.airingSchedules ?? [], start))
</script>

{#if $store.fetching}
  <div class="grid grid-cols-2 gap-4 sm:grid-cols-4 lg:grid-cols-7">
    {#each Array.from({ length: 7 }) as _}
      <div class="h-64 animate-pulse rounded-md bg-muted"></div>
    {/each}
  </div>
{:else if $store.error}
  <p class="text-muted-foreground">Failed to load schedule: {$store.error.message}</p>
{:else}
  <div class="grid grid-cols-2 gap-4 sm:grid-cols-4 lg:grid-cols-7">
    {#each DAYS as label, i (label)}
      <DayColumn {label} airings={days[i]} />
    {/each}
  </div>
{/if}
