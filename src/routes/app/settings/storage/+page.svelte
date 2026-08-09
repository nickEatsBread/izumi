<script lang="ts">
  import { onMount } from 'svelte'
  import { invoke } from '@tauri-apps/api/core'
  import { formatBytes } from '$lib/util/format'
  import { ioErrorMessage } from '$lib/player/history-io'
  import HardDrive from '@lucide/svelte/icons/hard-drive'
  import Trash2 from '@lucide/svelte/icons/trash-2'
  import RefreshCw from '@lucide/svelte/icons/refresh-cw'

  // Ids match cache_gc::BUCKETS. Anything not listed here is app DATA (downloads, extensions,
  // sync state) — user-owned, and deliberately not clearable from a "caches" screen.
  const BUCKETS = [
    {
      id: 'thumbs',
      title: 'Scrub previews',
      desc: 'Seek-bar thumbnails, generated as you hover. Dropped automatically when you leave an episode; anything here is from the episode playing now or a session that ended badly.',
    },
    {
      id: 'direct-torrents',
      title: 'Direct P2P playback',
      desc: 'Pieces downloaded while streaming a torrent without a debrid service. Cleared on every launch — this is what the last session left behind.',
    },
    {
      id: 'subs',
      title: 'Downloaded subtitles',
      desc: 'Subtitle files fetched from OpenSubtitles, SubDL and Jimaku. Shared across rewatches; anything untouched for 30 days is removed on launch.',
    },
    {
      id: 'gif-capture',
      title: 'GIF recorder scratch',
      desc: 'Frames from a GIF capture. Only holds anything if the app was killed mid-recording.',
    },
  ]

  let sizes = $state<Record<string, number>>({})
  let busy = $state('')
  let message = $state('')
  let loaded = $state(false)

  const total = $derived(Object.values(sizes).reduce((sum, n) => sum + n, 0))

  async function refresh() {
    try {
      const buckets = await invoke<{ id: string; bytes: number }[]>('cache_usage')
      sizes = Object.fromEntries(buckets.map((b) => [b.id, b.bytes]))
      message = ''
    } catch (error) {
      message = ioErrorMessage(error, 'Could not read cache sizes.')
    }
    loaded = true
  }

  async function clear(bucket: string) {
    busy = bucket
    try {
      const freed = await invoke<number>('clear_cache', { bucket })
      message = freed > 0 ? `Freed ${formatBytes(freed)}.` : 'Nothing to clear.'
      await refresh()
    } catch (error) {
      message = ioErrorMessage(error, 'Could not clear that cache.')
    }
    busy = ''
  }

  // onMount, not $effect: this reads sizes into $state that the same function writes, and an effect
  // that both starts the read and lands its result is the self-write trap that cancels its own work.
  onMount(() => { void refresh() })
</script>

<div class="p-4 sm:p-8">
  <h2 class="mb-1 text-xl font-black">Storage</h2>
  <p class="mb-6 max-w-2xl text-sm text-muted-foreground">
    What izumi keeps on disk to avoid re-fetching it. All of it regenerates on demand, so clearing
    any of it costs time, never data. Your downloads, extensions and watch history are not caches and
    are not listed here.
  </p>

  <div class="max-w-2xl space-y-4">
    <div class="flex items-center justify-between rounded-xl border border-border p-4">
      <div class="flex items-center gap-3">
        <HardDrive size={20} class="text-muted-foreground" />
        <div>
          <div class="font-black">{loaded ? formatBytes(total) || '0 B' : '…'}</div>
          <div class="text-xs text-muted-foreground">Total cached on this device</div>
        </div>
      </div>
      <div class="flex gap-2">
        <button data-focusable onclick={refresh} aria-label="Refresh sizes"
                class="flex items-center gap-2 rounded-md border border-border px-3 py-2 text-xs font-bold hover:bg-accent">
          <RefreshCw size={14} /> Refresh
        </button>
        <button data-focusable onclick={() => clear('all')} disabled={busy !== '' || total === 0}
                class="flex items-center gap-2 rounded-md bg-secondary px-3 py-2 text-xs font-bold hover:bg-accent disabled:opacity-50">
          <Trash2 size={14} /> Clear all
        </button>
      </div>
    </div>

    {#each BUCKETS as bucket (bucket.id)}
      <section class="rounded-xl border border-border p-4">
        <div class="flex items-start justify-between gap-4">
          <div class="min-w-0">
            <h3 class="font-black">{bucket.title}</h3>
            <p class="mt-1 text-xs text-muted-foreground">{bucket.desc}</p>
          </div>
          <div class="shrink-0 text-right">
            <div class="font-bold tabular-nums">{loaded ? formatBytes(sizes[bucket.id] ?? 0) || '0 B' : '…'}</div>
            <button data-focusable onclick={() => clear(bucket.id)} disabled={busy !== '' || !sizes[bucket.id]}
                    class="mt-2 rounded-md border border-border px-3 py-1.5 text-xs font-bold hover:bg-accent disabled:opacity-50">
              {busy === bucket.id ? 'Clearing…' : 'Clear'}
            </button>
          </div>
        </div>
      </section>
    {/each}

    {#if message}<p class="text-sm text-theme">{message}</p>{/if}
  </div>
</div>
