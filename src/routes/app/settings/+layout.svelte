<script lang="ts">
  import { onMount } from 'svelte'
  import SettingsNav from '$lib/components/settings/SettingsNav.svelte'
  import { heroMedia } from '$lib/stores/hero'

  let { children } = $props()

  // No hero on any settings page — clear the shared banner.
  heroMedia.set(null)

  let appVersion = $state('')
  let osLine = $state('')

  onMount(async () => {
    try {
      const { getVersion } = await import('@tauri-apps/api/app')
      appVersion = await getVersion()
    } catch { /* not in a native runtime (e.g. web preview) */ }
    // OS line — high-entropy UA data if available, else the platform string.
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const uad = (navigator as any).userAgentData
      if (uad?.getHighEntropyValues) {
        const v = await uad.getHighEntropyValues(['platform', 'platformVersion', 'architecture'])
        osLine = [v.platform, v.platformVersion, v.architecture].filter(Boolean).join(' ')
      } else {
        osLine = navigator.platform
      }
    } catch { osLine = navigator.platform }
  })
</script>

<!-- Desktop: nav rail + content side-by-side. Mobile (<=640px): stack vertically —
     the rail becomes a full-width top strip (SettingsNav scrolls horizontally) so the
     content column isn't crushed to a couple of words per line. -->
<div class="flex min-h-screen flex-col sm:flex-row">
  <aside class="flex w-full flex-col border-b border-border p-4 sm:sticky sm:top-0 sm:h-screen sm:w-56 sm:shrink-0 sm:border-b-0 sm:border-r">
    <h1 class="mb-4 px-3 text-2xl font-black">Settings</h1>
    <SettingsNav />
    <div class="mt-auto hidden space-y-0.5 px-3 pt-6 text-xs text-muted-foreground sm:block">
      {#if appVersion}<div>Client v{appVersion}</div>{/if}
      {#if osLine}<div>{osLine}</div>{/if}
    </div>
  </aside>

  <div class="min-w-0 flex-1">
    {@render children()}
  </div>
</div>
