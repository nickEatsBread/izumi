<script lang="ts">
  // Persistent "incognito is on" strip, mirroring OnlineBanner's bar. Always visible while the
  // mode is active so suppressed tracker syncs / history writes are never a silent surprise.
  import VenetianMask from '@lucide/svelte/icons/venetian-mask'
  import { incognito, exitIncognito } from '$lib/stores/incognito'
  import { offlineMode } from '$lib/stores/offline'
  import { online } from '$lib/stores/online'
  import { slide } from 'svelte/transition'

  // OnlineBanner occupies the same top strip when offline; drop below it instead of overlapping.
  const stacked = $derived($offlineMode || !$online)
</script>

{#if $incognito}
  <div transition:slide={{ duration: 250 }}
       class="fixed left-0 right-0 z-40 flex h-7 items-center justify-center gap-2 bg-violet-800 text-xs font-semibold text-white shadow-md sm:left-14
         {stacked ? 'top-[calc(env(safe-area-inset-top)+1.75rem)] sm:top-[3.75rem]' : 'top-[env(safe-area-inset-top)] sm:top-8'}">
    <VenetianMask size={14} /> Incognito — nothing is synced or saved
    <button onclick={exitIncognito} class="ml-1 underline underline-offset-2 hover:text-white/80">Turn off</button>
  </div>
{/if}
