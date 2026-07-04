<script lang="ts">
  import { onMount } from 'svelte'
  import SettingsNav from '$lib/components/settings/SettingsNav.svelte'
  import { heroMedia } from '$lib/stores/hero'

  let { children } = $props()

  // No hero on any settings page — clear the shared banner.
  heroMedia.set(null)

  let appVersion = $state('')
  let tauriVersion = $state('')
  let osLine = $state('')

  onMount(async () => {
    try {
      const { getVersion, getTauriVersion } = await import('@tauri-apps/api/app')
      appVersion = await getVersion()
      tauriVersion = await getTauriVersion()
    } catch { /* not in Tauri (e.g. web preview) */ }
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

<div class="flex min-h-screen">
  <aside class="sticky top-0 flex h-screen w-56 shrink-0 flex-col border-r border-border p-4">
    <h1 class="mb-4 px-3 text-2xl font-black">Settings</h1>
    <SettingsNav />
    <div class="mt-auto space-y-0.5 px-3 pt-6 text-xs text-muted-foreground">
      {#if appVersion}<div>Client v{appVersion}</div>{/if}
      {#if tauriVersion}<div>Tauri {tauriVersion}</div>{/if}
      {#if osLine}<div>{osLine}</div>{/if}
    </div>
  </aside>

  <div class="min-w-0 flex-1">
    {@render children()}
  </div>
</div>
