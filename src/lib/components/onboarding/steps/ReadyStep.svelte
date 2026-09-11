<script lang="ts">
  import Check from '@lucide/svelte/icons/check'
  import Minus from '@lucide/svelte/icons/minus'
  import { m } from '$lib/paraglide/messages.js'
  import { REMAINDER_ORDER, type RemainderItem, type SetupReadiness } from '$lib/onboarding/readiness'

  let { readiness }: { readiness: SetupReadiness } = $props()

  const label = (item: RemainderItem) => ({
    sources: m.onboarding_ready_sources(),
    playback: m.onboarding_ready_playback(),
    tracker: m.onboarding_ready_list(),
    metadata: m.onboarding_ready_metadata(),
  })[item]

  const detail = (item: RemainderItem) => ({
    sources: m.onboarding_ready_sources_missing(),
    playback: m.onboarding_ready_playback_missing(),
    tracker: m.onboarding_ready_list_missing(),
    metadata: m.onboarding_ready_metadata_missing(),
  })[item]
</script>

<h1 id="setup-title" data-step-heading tabindex="-1" aria-describedby="setup-progress" class="setup-heading">{m.onboarding_ready_title()}</h1>
<p class="mt-3 max-w-2xl text-sm leading-relaxed text-muted-foreground sm:text-base">{m.onboarding_ready_body()}</p>

<ul class="mt-7 divide-y divide-border border-y border-border">
  {#each REMAINDER_ORDER as item}
    <li class="flex items-center gap-3 py-4">
      {#if readiness[item]}<Check size={19} class="shrink-0 text-muted-foreground" />
      {:else}<Minus size={19} class="shrink-0 text-muted-foreground" />{/if}
      <span class="min-w-0 flex-1">
        <span class="block text-sm font-semibold">{label(item)}</span>
        <span class="mt-1 block text-xs text-muted-foreground">{readiness[item] ? m.onboarding_ready() : detail(item)}</span>
      </span>
    </li>
  {/each}
</ul>

<p class="mt-6 text-xs leading-relaxed text-muted-foreground">{m.onboarding_ready_remainder_hint()}</p>
