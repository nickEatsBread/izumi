<script lang="ts">
  let { tabs, active = $bindable() }: { tabs: string[]; active: string } = $props()
</script>
<div class="mb-4 flex gap-1 border-b border-border">
  {#each tabs as tab (tab)}
    <button
      data-focusable
      onclick={() => (active = tab)}
      class="relative px-4 py-2 text-sm font-bold transition-colors {active === tab ? 'text-foreground' : 'text-muted-foreground hover:text-foreground'}"
    >
      {tab}
      {#if active === tab}
        <span class="absolute inset-x-0 -bottom-px h-0.5 bg-accent"></span>
      {/if}
    </button>
  {/each}
</div>
