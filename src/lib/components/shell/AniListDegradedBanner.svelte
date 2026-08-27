<script lang="ts">
  import AlertTriangle from '@lucide/svelte/icons/triangle-alert'
  import X from '@lucide/svelte/icons/x'
  import { anilistDegraded } from '$lib/anilist/degraded'
  import { catalogProvider, isLegacyAniListCatalog } from '$lib/settings/catalog'
  import { offlineMode } from '$lib/stores/offline'
  import { online } from '$lib/stores/online'
  import { incognito } from '$lib/stores/incognito'
  import { isMacOS } from '$lib/platform'
  import { slide } from 'svelte/transition'

  let detailsOpen = $state(false)
  const stripsAbove = $derived(($offlineMode || !$online ? 1 : 0) + ($incognito ? 1 : 0))
  const offset = $derived(`${stripsAbove * 1.75}rem`)
  const desktopInset = $derived($isMacOS ? 'sm:left-28 sm:right-0' : 'sm:left-14 sm:right-[8.25rem]')
</script>

<svelte:window onkeydown={(event) => { if (detailsOpen && event.key === 'Escape') detailsOpen = false }} />

{#if $anilistDegraded && isLegacyAniListCatalog($catalogProvider)}
  <div data-tauri-drag-region transition:slide={{ duration: 250 }} role="status" style:--banner-offset={offset}
       class="fixed left-0 right-0 top-[calc(env(safe-area-inset-top)+var(--banner-offset))] z-[60] flex min-h-7 items-center justify-center gap-2 bg-amber-700 px-2 py-1 text-center text-xs font-semibold text-white shadow-md sm:top-[var(--banner-offset)] {desktopInset}">
    <AlertTriangle size={14} class="shrink-0" />
    <span>Degraded performance — AniList is unavailable.</span>
    <button onclick={() => (detailsOpen = true)} class="shrink-0 underline underline-offset-2 hover:text-white/80">See error</button>
  </div>
{/if}

{#if detailsOpen && $anilistDegraded}
  <div class="fixed inset-0 z-[80] grid place-items-center bg-black/70 p-4 backdrop-blur-sm">
    <div role="dialog" aria-modal="true" aria-labelledby="anilist-error-title" data-nav-trap
         class="w-full max-w-lg rounded-2xl border border-white/10 bg-neutral-950 p-5 text-white shadow-2xl">
      <div class="flex items-start justify-between gap-4">
        <div>
          <h2 id="anilist-error-title" class="text-lg font-black">Couldn't reach AniList</h2>
          <p class="mt-1 text-sm text-neutral-400">
            {$anilistDegraded.fallbackError
              ? 'The backup catalog services are also temporarily unavailable.'
              : `Public information is temporarily being provided by ${$anilistDegraded.provider ?? 'a backup service'}.`}
          </p>
        </div>
        <button data-focusable aria-label="Close" onclick={() => (detailsOpen = false)}
                class="grid size-9 shrink-0 place-items-center rounded-full hover:bg-white/10"><X size={19} /></button>
      </div>
      <pre class="mt-4 max-h-52 overflow-auto whitespace-pre-wrap break-words rounded-xl bg-white/5 p-4 font-mono text-xs text-neutral-200">{$anilistDegraded.error}</pre>
      {#if $anilistDegraded.fallbackError}
        <p class="mt-4 text-xs font-bold text-neutral-300">Backup services</p>
        <pre class="mt-1 max-h-32 overflow-auto whitespace-pre-wrap break-words rounded-xl bg-white/5 p-4 font-mono text-xs text-neutral-200">{$anilistDegraded.fallbackError}</pre>
      {/if}
      <p class="mt-4 text-xs text-neutral-400">AniList tracking and personalized information may remain unavailable until the service recovers.</p>
    </div>
  </div>
{/if}
