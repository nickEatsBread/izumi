<script lang="ts">
  // Informational connectivity banner: slides a dark "Offline" bar
  // down from under the titlebar while offline, and a green "Back online" bar for a
  // couple of seconds after reconnecting, then retracts.
  import CloudOff from 'lucide-svelte/icons/cloud-off'
  import Wifi from 'lucide-svelte/icons/wifi'
  import { online } from '$lib/stores/online'
  import { slide } from 'svelte/transition'

  let showBack = $state(false)
  let wasOffline = false
  let t: ReturnType<typeof setTimeout>

  $effect(() => {
    if (!$online) {
      wasOffline = true
      showBack = false
    } else if (wasOffline) {
      wasOffline = false
      showBack = true
      clearTimeout(t)
      t = setTimeout(() => (showBack = false), 2500)
    }
    return () => clearTimeout(t)
  })
</script>

{#if !$online}
  <div transition:slide={{ duration: 250 }}
       class="fixed left-0 right-0 top-[env(safe-area-inset-top)] z-40 flex h-7 items-center justify-center gap-2 bg-neutral-900 text-xs font-semibold text-white shadow-md sm:left-14 sm:top-8">
    <CloudOff size={14} /> Offline — check your connection
  </div>
{:else if showBack}
  <div transition:slide={{ duration: 250 }}
       class="fixed left-0 right-0 top-[env(safe-area-inset-top)] z-40 flex h-7 items-center justify-center gap-2 bg-green-600 text-xs font-semibold text-white shadow-md sm:left-14 sm:top-8">
    <Wifi size={14} /> Back online
  </div>
{/if}
