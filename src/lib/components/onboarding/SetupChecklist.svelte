<script lang="ts">
  import { goto } from '$app/navigation'
  import ArrowRight from '@lucide/svelte/icons/arrow-right'
  import X from '@lucide/svelte/icons/x'
  import { m } from '$lib/paraglide/messages.js'
  import { setupChecklistDismissed, setupRemainder, type RemainderItem } from '$lib/onboarding/readiness'
  import { addonUrls } from '$lib/stremio/sources'
  import { debridKey, extensionUrls, torrentPlaybackMode } from '$lib/settings/ui'
  import { tmdbReadToken } from '$lib/settings/catalog'
  import { anilistToken, kitsuToken, malToken, simklToken } from '$lib/trackers/config'

  const destination: Record<RemainderItem, string> = {
    sources: '/app/settings/store',
    // The debrid key and the P2P toggle sit behind the Playback tab; the screen defaults to My sources.
    playback: '/app/settings/sources?tab=playback',
    tracker: '/app/settings/accounts',
    metadata: '/app/settings/catalog',
  }

  const label = (item: RemainderItem) => ({
    sources: m.setup_remainder_sources(),
    playback: m.setup_remainder_playback(),
    tracker: m.setup_remainder_tracker(),
    metadata: m.setup_remainder_metadata(),
  })[item]

  /** A row clears itself once the thing it asks for exists, however the user got there. */
  const satisfied = $derived<Record<RemainderItem, boolean>>({
    sources: $addonUrls.length > 0 || $extensionUrls.length > 0,
    playback: $torrentPlaybackMode === 'direct' || Boolean($debridKey),
    tracker: Boolean($anilistToken || $malToken || $kitsuToken || $simklToken),
    metadata: Boolean($tmdbReadToken.trim()),
  })
  const items = $derived($setupRemainder.filter((item) => !satisfied[item]))

  function dismiss(item: RemainderItem) {
    setupRemainder.update((values) => values.filter((value) => value !== item))
  }
</script>

{#if items.length && !$setupChecklistDismissed}
  <section aria-labelledby="setup-checklist-title" class="mx-4 mb-6 rounded-2xl border border-border bg-secondary/30 p-4">
    <div class="flex items-center gap-3">
      <div class="min-w-0 flex-1">
        <h2 id="setup-checklist-title" class="text-sm font-bold">{m.setup_checklist_title()}</h2>
        <p class="mt-0.5 text-xs text-muted-foreground">{m.setup_checklist_count({ count: String(items.length) })}</p>
      </div>
      <button type="button" data-focusable onclick={() => setupChecklistDismissed.set(true)} aria-label={m.setup_checklist_dismiss()} class="grid size-9 shrink-0 place-items-center rounded-lg text-muted-foreground hover:bg-secondary"><X size={16} /></button>
    </div>
    <ul class="mt-3 grid grid-cols-[minmax(0,1fr)] gap-2">
      {#each items as item (item)}
        <li class="flex items-center gap-2">
          <button type="button" data-focusable onclick={() => goto(destination[item])} class="flex min-h-11 flex-1 items-center justify-between gap-3 rounded-lg bg-background px-3 text-left text-sm font-semibold hover:bg-accent">
            {label(item)}<ArrowRight size={15} class="shrink-0 text-muted-foreground" />
          </button>
          <button type="button" data-focusable onclick={() => dismiss(item)} aria-label={m.setup_checklist_dismiss_item({ item: label(item) })} class="grid size-9 shrink-0 place-items-center rounded-lg text-muted-foreground hover:bg-secondary"><X size={14} /></button>
        </li>
      {/each}
    </ul>
  </section>
{/if}
