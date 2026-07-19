<script lang="ts">
  import { onMount } from 'svelte'
  import { page } from '$app/stores'
  import SettingsNav from '$lib/components/settings/SettingsNav.svelte'
  import { isMobile } from '$lib/platform'
  import { heroMedia } from '$lib/stores/hero'
  import ChevronLeft from 'lucide-svelte/icons/chevron-left'
  import * as h from '$lib/haptics'

  let { children } = $props()

  // No hero on any settings page — clear the shared banner.
  heroMedia.set(null)

  let appVersion = $state('')
  let osLine = $state('')
  onMount(async () => {
    try { const { getVersion } = await import('@tauri-apps/api/app'); appVersion = await getVersion() } catch { /* web */ }
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const uad = (navigator as any).userAgentData
      if (uad?.getHighEntropyValues) {
        const v = await uad.getHighEntropyValues(['platform', 'platformVersion', 'architecture'])
        osLine = [v.platform, v.platformVersion, v.architecture].filter(Boolean).join(' ')
      } else { osLine = navigator.platform }
    } catch { osLine = navigator.platform }
  })

  // Mobile is a two-level push/pop: the grouped list index lives at the exact /app/settings path;
  // every other settings route is a "child" that shows a back-header. Treat the exact /app/settings
  // path as the index on mobile.
  const isIndex = $derived($page.url.pathname === '/app/settings')
</script>

{#if $isMobile}
  {#if isIndex}
    <!-- Mobile index: the grouped list, full width. -->
    <div class="p-4">
      <h1 class="mb-4 px-1 text-2xl font-black">Settings</h1>
      <SettingsNav />
      <div class="mt-6 space-y-0.5 px-1 text-xs text-muted-foreground">
        {#if appVersion}<div>Client v{appVersion}</div>{/if}
        {#if osLine}<div>{osLine}</div>{/if}
      </div>
    </div>
  {:else}
    <!-- Mobile child: back-header + the category content. -->
    <div class="min-h-screen">
      <div class="sticky top-0 z-20 flex items-center gap-2 border-b border-border bg-background/95 px-2 py-2 backdrop-blur"
           style="padding-top:max(0.5rem,env(safe-area-inset-top))">
        <a href="/app/settings" data-focusable onclick={() => h.tap()} aria-label="Back to settings"
           class="grid h-10 w-10 place-items-center rounded-full transition-colors active:bg-accent">
          <ChevronLeft size={22} />
        </a>
        <span class="text-lg font-black">Settings</span>
      </div>
      {@render children()}
    </div>
  {/if}
{:else}
  <!-- Desktop: nav rail + content side-by-side (unchanged). -->
  <div class="flex min-h-screen flex-row">
    <aside class="sticky top-0 flex h-screen w-56 shrink-0 flex-col border-r border-border p-4">
      <h1 class="mb-4 px-3 text-2xl font-black">Settings</h1>
      <SettingsNav />
      <div class="mt-auto space-y-0.5 px-3 pt-6 text-xs text-muted-foreground">
        {#if appVersion}<div>Client v{appVersion}</div>{/if}
        {#if osLine}<div>{osLine}</div>{/if}
      </div>
    </aside>
    <div class="min-w-0 flex-1">{@render children()}</div>
  </div>
{/if}
