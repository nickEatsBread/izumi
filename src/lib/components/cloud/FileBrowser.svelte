<script lang="ts">
  import { cloudFiles, playFile } from '$lib/stremio/debrid/cloud'
  import Play from 'lucide-svelte/icons/play'
  import X from 'lucide-svelte/icons/x'
  import type { DebridFile } from '$lib/stremio/debrid/types'

  const fmtBytes = (n?: number) => {
    if (!n) return '0 MB'
    const u = ['B', 'KB', 'MB', 'GB', 'TB']; let i = 0, v = n
    while (v >= 1024 && i < u.length - 1) { v /= 1024; i++ }
    return `${v.toFixed(1)} ${u[i]}`
  }

  function play(f: DebridFile) {
    const cur = $cloudFiles
    if (cur) playFile(cur.item, f, () => {})
  }
</script>

{#if $cloudFiles}
  <div class="fixed inset-0 z-40 grid place-items-center bg-black/70 p-3 sm:p-6" data-nav-trap>
    <div class="flex max-h-[80vh] w-full max-w-2xl flex-col rounded-xl border border-border bg-background p-4 shadow-xl sm:p-5">
      <div class="mb-3 flex items-center justify-between gap-3">
        <h2 class="min-w-0 truncate text-lg font-black">{$cloudFiles.item.name}</h2>
        <button data-focusable title="Close" onclick={() => cloudFiles.set(null)} class="grid size-10 shrink-0 place-items-center rounded-md hover:bg-accent sm:size-8"><X size={16} /></button>
      </div>
      <div class="space-y-1 overflow-y-auto">
        {#each $cloudFiles.files as f (f.id)}
          <button data-focusable onclick={() => play(f)} class="flex w-full items-center gap-3 rounded-lg border border-border bg-secondary/40 p-2.5 text-left hover:bg-accent">
            <Play size={16} class="shrink-0 text-lime-300" />
            <span class="min-w-0 flex-1 truncate text-sm">{f.name}</span>
            <span class="shrink-0 text-[0.7rem] text-muted-foreground">{fmtBytes(f.size)}</span>
          </button>
        {/each}
      </div>
    </div>
  </div>
{/if}
