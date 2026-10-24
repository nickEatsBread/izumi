<script lang="ts">
  import { get } from 'svelte/store'
  import Check from '@lucide/svelte/icons/check'
  import ArrowLeftRight from '@lucide/svelte/icons/arrow-left-right'
  import Info from '@lucide/svelte/icons/info'
  import Minus from '@lucide/svelte/icons/minus'
  import { m } from '$lib/paraglide/messages.js'
  import TrackerTiles from './TrackerTiles.svelte'
  import type { ConnectStates } from '$lib/onboarding/connect-state'
  import { REMAINDER_ORDER, type RemainderItem, type SetupReadiness } from '$lib/onboarding/readiness'
  import { anilistToken, malToken } from '$lib/trackers/config'

  let {
    readiness,
    connections = $bindable(),
    trackers,
    tmdbTip,
    catalogTip,
  }: { readiness: SetupReadiness; connections: ConnectStates; trackers: boolean; tmdbTip: boolean; catalogTip: boolean } = $props()

  // Read once on arrival: signing in here should turn a tile to Connected, not make the whole
  // section vanish under the pointer.
  const hadTracker = Boolean(get(anilistToken) || get(malToken))
  const offerTrackers = $derived(trackers && !hadTracker)

  const label = (item: RemainderItem) => ({
    sources: m.onboarding_ready_sources(),
    playback: m.onboarding_ready_playback(),
  })[item]

  const detail = (item: RemainderItem) => ({
    sources: m.onboarding_ready_sources_missing(),
    playback: m.onboarding_ready_playback_missing(),
  })[item]
</script>

<h1 id="setup-title" data-step-heading tabindex="-1" aria-describedby="setup-progress" class="setup-heading">{m.onboarding_ready_title()}</h1>
<p class="mt-3 max-w-2xl text-sm leading-relaxed text-muted-foreground sm:text-base">{m.onboarding_ready_body()}</p>

<ul class="mt-7 grid grid-cols-[minmax(0,1fr)] gap-3 sm:grid-cols-2">
  {#each REMAINDER_ORDER as item}
    <li class="flex items-center gap-3 rounded-xl border border-border p-4">
      {#if readiness[item]}<Check size={19} class="shrink-0 text-muted-foreground" />
      {:else}<Minus size={19} class="shrink-0 text-muted-foreground" />{/if}
      <span class="min-w-0 flex-1">
        <span class="block text-sm font-semibold">{label(item)}</span>
        <span class="mt-1 block text-xs text-muted-foreground">{readiness[item] ? m.onboarding_ready() : detail(item)}</span>
      </span>
    </li>
  {/each}
</ul>

<!-- Both libraries were picked but only one opens at a time, so say where the other one lives. -->
{#if catalogTip}
  <h2 class="mt-8 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{m.onboarding_ready_good_to_know()}</h2>
  <p class="mt-3 flex max-w-2xl items-start gap-3 text-sm leading-relaxed"><span aria-hidden="true" class="grid size-8 shrink-0 place-items-center rounded-lg bg-secondary text-muted-foreground"><ArrowLeftRight size={16} /></span><span class="pt-1">{m.onboarding_ready_tip_catalogs()}</span></p>
{/if}

{#if offerTrackers}
  <h2 class="mt-8 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{m.onboarding_ready_extras_trackers()}</h2>
  <TrackerTiles bind:connections />
{/if}

{#if tmdbTip}
  <p class="mt-6 flex max-w-2xl items-start gap-2 text-sm leading-relaxed text-muted-foreground"><Info size={17} class="mt-0.5 shrink-0" />{m.onboarding_ready_tmdb_tip()}</p>
{/if}

<p class="mt-6 max-w-2xl text-xs leading-relaxed text-muted-foreground">{m.onboarding_ready_remainder_hint()}</p>
