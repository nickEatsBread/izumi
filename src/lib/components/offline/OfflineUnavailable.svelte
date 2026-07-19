<script lang="ts">
  import WifiOff from 'lucide-svelte/icons/wifi-off'
  // Shown in place of a network-only page (Search, Schedule, Cloud, My List) while in offline mode.
  let {
    title = 'Unavailable offline',
    subtitle = "You're not connected. This page needs a connection — your downloads are still available.",
  }: { title?: string; subtitle?: string } = $props()
</script>

<div class="grid min-h-[50vh] place-items-center p-8 text-center">
  <div class="max-w-sm">
    <WifiOff size={40} class="mx-auto mb-4 text-muted-foreground" />
    <h2 class="text-lg font-black">{title}</h2>
    <p class="mt-1 text-sm text-muted-foreground">{subtitle}</p>
    <a
      href="/app/downloads"
      data-focusable
      class="mt-5 inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-bold text-primary-foreground"
    >Go to Downloads</a>
  </div>
</div>
