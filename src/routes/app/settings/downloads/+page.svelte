<script lang="ts">
  import { onMount } from 'svelte'
  import { invoke } from '@tauri-apps/api/core'
  import { downloadDir, downloadConcurrency, downloadCachedOnly } from '$lib/settings/ui'
  import { downloads } from '$lib/downloads/store'
  import Toggle from '$lib/components/settings/Toggle.svelte'

  const fmtBytes = (n: number) => {
    if (!n) return '0 MB'
    const u = ['B', 'KB', 'MB', 'GB', 'TB']; let i = 0, v = n
    while (v >= 1024 && i < u.length - 1) { v /= 1024; i++ }
    return `${v.toFixed(1)} ${u[i]}`
  }
  const used = $derived(Object.values($downloads).filter((d) => d.status === 'done').reduce((s, d) => s + (d.bytes || 0), 0))

  onMount(async () => {
    if (!$downloadDir) { try { $downloadDir = await invoke<string>('download_dir_default') } catch { /* not in Tauri */ } }
  })
</script>

<div class="p-4 sm:p-8">
  <h2 class="mb-1 text-xl font-black">Downloads</h2>
  <p class="mb-4 text-sm text-muted-foreground">Where episodes are saved for offline playback, and how many download at once.</p>

  <div class="max-w-2xl space-y-3">
    <label class="flex flex-col gap-1">
      <span class="text-sm font-bold">Download folder</span>
      <input type="text" data-focusable bind:value={$downloadDir} placeholder="(default: app data / downloads)" class="rounded-md bg-input px-3 py-2 text-sm" />
      <span class="text-xs text-muted-foreground">Absolute path. Leave as the default unless you want downloads on another drive.</span>
    </label>

    <label class="flex items-center justify-between rounded-md border border-border p-3">
      <div>
        <div class="font-bold">Simultaneous downloads</div>
        <p class="mt-1 text-xs text-muted-foreground">1–2 recommended (debrid CDN + disk).</p>
      </div>
      <input type="number" min="1" max="4" data-focusable bind:value={$downloadConcurrency} class="w-20 rounded-md bg-input px-3 py-2 text-right text-sm" />
    </label>

    <Toggle label="Only download cached sources" desc="Skip episodes with no instantly-available (cached) source when downloading in bulk." value={$downloadCachedOnly} onToggle={() => ($downloadCachedOnly = !$downloadCachedOnly)} />

    <div class="flex items-center justify-between rounded-md border border-border p-3 text-sm">
      <span class="font-bold">Storage used</span>
      <span class="tabular-nums text-muted-foreground">{fmtBytes(used)}</span>
    </div>
  </div>
</div>
