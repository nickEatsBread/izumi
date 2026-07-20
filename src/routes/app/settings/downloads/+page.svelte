<script lang="ts">
  import { onMount } from 'svelte'
  import { invoke } from '@tauri-apps/api/core'
  import { open } from '@tauri-apps/plugin-dialog'
  import {
    downloadDir, downloadConcurrency, downloadCachedOnly, downloadQuality, downloadAudio,
    downloadCodec, autoDownloadDelayMinutes,
  } from '$lib/settings/ui'
  import { isAndroid } from '$lib/platform'
  import { downloads } from '$lib/downloads/store'
  import { forceOffline } from '$lib/stores/offline'
  import Toggle from '$lib/components/settings/Toggle.svelte'
  import {
    autoDownloadRules, autoDownloadRunning, removeAutoDownloadRule, runAutoDownloadRules,
    updateAutoDownloadRule,
  } from '$lib/downloads/rules'
  import Trash2 from 'lucide-svelte/icons/trash-2'
  import RefreshCw from 'lucide-svelte/icons/refresh-cw'

  // Desktop: native folder picker → an absolute filesystem path the reqwest downloader can write to.
  // (Android's picker returns a content:// tree URI, which the downloader can't use — so it's
  // offered on desktop only; Android downloads stay in app storage.)
  let pickMsg = $state('')
  async function browse() {
    pickMsg = ''
    try {
      const picked = await open({ directory: true, title: 'Choose download folder' })
      if (typeof picked === 'string') $downloadDir = picked
    } catch {
      pickMsg = 'Folder picker unavailable.'
    }
  }

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
  <p class="mb-4 text-sm text-muted-foreground">Choose which releases downloads should prefer and manage series that watch for newly aired episodes.</p>

  <div class="max-w-2xl space-y-3">
    <Toggle label="Offline mode" desc="Show only downloaded content and skip network requests. Turns on automatically if you open the app with no connection." value={$forceOffline} onToggle={() => ($forceOffline = !$forceOffline)} />

    <label class="flex flex-col gap-1">
      <span class="text-sm font-bold">Download folder</span>
      <span class="flex gap-2">
        <input type="text" data-focusable bind:value={$downloadDir} readonly={$isAndroid} placeholder="(default: app data / downloads)" class="min-w-0 flex-1 rounded-md bg-input px-3 py-2 text-sm {$isAndroid ? 'text-muted-foreground' : ''}" />
        {#if !$isAndroid}
          <button data-focusable onclick={browse} class="shrink-0 rounded-md bg-secondary px-4 py-2 text-sm font-bold transition-colors hover:bg-accent">Browse…</button>
        {/if}
      </span>
      {#if $isAndroid}
        <span class="text-xs text-muted-foreground">On Android, downloads are saved to the app's private storage. Picking a custom folder needs Android's document-provider support and isn't available yet.</span>
      {:else}
        <span class="text-xs text-muted-foreground">Absolute path, or use Browse. Leave as the default unless you want downloads on another drive.{pickMsg ? ` ${pickMsg}` : ''}</span>
      {/if}
    </label>

    <label class="flex items-center justify-between rounded-md border border-border p-3">
      <div>
        <div class="font-bold">Simultaneous downloads</div>
        <p class="mt-1 text-xs text-muted-foreground">1–2 recommended (debrid CDN + disk).</p>
      </div>
      <input type="number" min="1" max="4" data-focusable bind:value={$downloadConcurrency} class="w-20 rounded-md bg-input px-3 py-2 text-right text-sm" />
    </label>

    <section class="rounded-md border border-border p-3">
      <div class="font-bold">Source matching</div>
      <p class="mt-1 text-xs text-muted-foreground">Used by both manual downloads and automatic new-episode downloads. A preference falls back to the best available match when no exact match exists.</p>
      <div class="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <label class="text-sm font-bold">Quality
          <select data-focusable bind:value={$downloadQuality} class="mt-1 w-full rounded-md bg-input px-3 py-2 font-normal"><option value="2160">4K</option><option value="1080">1080p</option><option value="720">720p</option><option value="480">480p</option><option value="any">Any</option></select>
        </label>
        <label class="text-sm font-bold">Audio
          <select data-focusable bind:value={$downloadAudio} class="mt-1 w-full rounded-md bg-input px-3 py-2 font-normal"><option value="sub">Sub</option><option value="dub">Dub</option><option value="any">Any</option></select>
        </label>
        <label class="text-sm font-bold">Codec
          <select data-focusable bind:value={$downloadCodec} class="mt-1 w-full rounded-md bg-input px-3 py-2 font-normal"><option value="any">Any</option><option value="h264">H.264</option><option value="h265">H.265 / HEVC</option><option value="av1">AV1</option></select>
        </label>
      </div>
      <div class="mt-3"><Toggle label="Only download cached sources" desc="Require a source that is already available through the configured debrid service." value={$downloadCachedOnly} onToggle={() => ($downloadCachedOnly = !$downloadCachedOnly)} /></div>
    </section>

    <label class="flex items-center justify-between rounded-md border border-border p-3">
      <div class="pr-4"><div class="font-bold">New-episode delay</div><p class="mt-1 text-xs text-muted-foreground">Wait after the scheduled air time before looking for a release.</p></div>
      <span class="flex items-center gap-2"><input data-focusable type="number" min="0" max="1440" bind:value={$autoDownloadDelayMinutes} class="w-20 rounded-md bg-input px-3 py-2 text-right text-sm" /><span class="text-sm text-muted-foreground">min</span></span>
    </label>

    <section class="rounded-md border border-border p-3">
      <div class="flex items-center justify-between gap-3">
        <div><div class="font-bold">Automatic downloads</div><p class="mt-1 text-xs text-muted-foreground">Enable a series from its episode Download menu. Izumi checks on launch, when reconnecting, and every 15 minutes while running.</p></div>
        <button data-focusable onclick={() => runAutoDownloadRules()} disabled={$autoDownloadRunning} class="flex shrink-0 items-center gap-2 rounded-md bg-secondary px-3 py-2 text-xs font-bold"><RefreshCw size={14} class={$autoDownloadRunning ? 'animate-spin' : ''} /> Check now</button>
      </div>
      {#if !$autoDownloadRules.length}
        <p class="mt-3 rounded-md border border-dashed border-border p-4 text-center text-xs text-muted-foreground">No series enabled. Open a series, choose Download…, then turn on “Auto-download new episodes”.</p>
      {:else}
        <div class="mt-3 space-y-2">
          {#each $autoDownloadRules as rule (rule.id)}
            <div class="flex flex-wrap items-center gap-3 rounded-md bg-secondary/50 p-2.5">
              {#if rule.poster}<img src={rule.poster} alt="" class="h-12 w-9 rounded object-cover" />{/if}
              <div class="min-w-0 flex-1"><div class="truncate text-sm font-bold">{rule.title}</div><div class="text-xs text-muted-foreground">Waiting for episode {rule.nextEpisode}{rule.lastError ? ` · ${rule.lastError}` : ''}</div></div>
              <label class="text-xs font-bold"><input data-focusable type="checkbox" checked={rule.enabled} onchange={(e) => updateAutoDownloadRule(rule.id, { enabled: e.currentTarget.checked })} /> Enabled</label>
              <button data-focusable aria-label={`Remove ${rule.title}`} onclick={() => removeAutoDownloadRule(rule.id)} class="grid size-9 place-items-center rounded-md text-destructive hover:bg-accent"><Trash2 size={16} /></button>
            </div>
          {/each}
        </div>
      {/if}
    </section>

    <div class="flex items-center justify-between rounded-md border border-border p-3 text-sm">
      <span class="font-bold">Storage used</span>
      <span class="tabular-nums text-muted-foreground">{fmtBytes(used)}</span>
    </div>
  </div>
</div>
