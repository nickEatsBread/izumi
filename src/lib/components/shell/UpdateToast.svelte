<script lang="ts">
  import { availableUpdate, updatePhase, updateProgress, updateError, updateDismissed, applyUpdate } from '$lib/updater'
  const pct = $derived(Math.round($updateProgress * 100))
</script>

{#if $availableUpdate && !$updateDismissed}
  <div class="fixed bottom-4 right-4 z-50 w-80 rounded-lg border border-border bg-secondary p-3 shadow-xl">
    {#if $updatePhase === 'available'}
      <p class="mb-2 text-sm font-bold">Version {$availableUpdate.version} is ready.</p>
      <div class="flex gap-2">
        <button data-focusable onclick={applyUpdate} class="rounded bg-primary px-3 py-1.5 text-sm font-bold text-primary-foreground">Update now</button>
        <button data-focusable onclick={() => updateDismissed.set(true)} class="rounded px-3 py-1.5 text-sm text-muted-foreground">Later</button>
      </div>
    {:else if $updatePhase === 'downloading'}
      <p class="mb-2 text-sm font-bold">Downloading… {pct}%</p>
      <div class="h-1.5 w-full overflow-hidden rounded bg-background"><div class="h-full bg-primary transition-[width]" style="width:{pct}%"></div></div>
    {:else if $updatePhase === 'ready'}
      <p class="mb-2 text-sm font-bold">Update ready.</p>
      <p class="text-xs text-muted-foreground">Quit izumi to apply {$availableUpdate.version}, then relaunch from Steam.</p>
    {:else if $updatePhase === 'error'}
      <p class="text-sm text-destructive">Update failed: {$updateError}</p>
      <button data-focusable onclick={() => updateDismissed.set(true)} class="mt-2 text-sm text-muted-foreground">Dismiss</button>
    {/if}
  </div>
{/if}
