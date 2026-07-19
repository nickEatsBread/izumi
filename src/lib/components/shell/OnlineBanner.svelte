<script lang="ts">
  // Connectivity + offline-mode banner. Four states:
  //  1. disconnected, not in offline mode (mid-session drop) → offer "Switch to offline mode"
  //  2. in offline mode (connected or not) → "showing your downloads" + "Go online"
  //  3. just reconnected (not in offline mode) → transient "Back online"
  //  4. otherwise hidden
  import CloudOff from 'lucide-svelte/icons/cloud-off'
  import Wifi from 'lucide-svelte/icons/wifi'
  import { online } from '$lib/stores/online'
  import { offlineMode, enterOfflineMode, exitOfflineMode } from '$lib/stores/offline'
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

  const barCls =
    'fixed left-0 right-0 top-[env(safe-area-inset-top)] z-40 flex h-7 items-center justify-center gap-2 text-xs font-semibold text-white shadow-md sm:left-14 sm:top-8'
</script>

{#if $offlineMode}
  <div transition:slide={{ duration: 250 }} class="{barCls} bg-neutral-900">
    <CloudOff size={14} /> Offline — showing your downloads
    <button onclick={exitOfflineMode} class="ml-1 underline underline-offset-2 hover:text-white/80">Go online</button>
  </div>
{:else if !$online}
  <div transition:slide={{ duration: 250 }} class="{barCls} bg-neutral-900">
    <CloudOff size={14} /> Offline — check your connection
    <button onclick={enterOfflineMode} class="ml-1 underline underline-offset-2 hover:text-white/80">Switch to offline mode</button>
  </div>
{:else if showBack}
  <div transition:slide={{ duration: 250 }} class="{barCls} bg-green-600">
    <Wifi size={14} /> Back online
  </div>
{/if}
