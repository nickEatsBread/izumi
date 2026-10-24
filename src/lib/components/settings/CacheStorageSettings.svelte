<script lang="ts">
  import { onMount } from 'svelte'
  import { invoke } from '@tauri-apps/api/core'
  import { formatBytes } from '$lib/util/format'
  import { ioErrorMessage } from '$lib/player/history-io'
  import RefreshButton from '$lib/components/RefreshButton.svelte'
  import SettingsRow from './SettingsRow.svelte'
  import Trash2 from '@lucide/svelte/icons/trash-2'

  // Ids match cache_gc::BUCKETS (cache-storage-settings.test.ts checks it). Anything not listed here is app DATA (downloads, extensions,
  // sync state) — user-owned, and deliberately not clearable from a "caches" screen.
  const BUCKETS = [
    { id: 'thumbs', title: 'Scrub previews', desc: 'Seek-bar thumbnails from the episode playing now', more: 'Generated as you hover and dropped automatically when you leave an episode; anything here is from the episode playing now or a session that ended badly.' },
    { id: 'direct-torrents', title: 'Direct P2P playback', desc: 'Torrent pieces the last session left behind', more: 'Pieces downloaded while streaming a torrent without a debrid service. Cleared on every launch.' },
    { id: 'torrent-metadata', title: 'Torrent metadata', desc: 'Saved torrent info so repeat plays start faster', more: 'Small files that let a torrent you played before start without asking peers for its details again. Anything untouched for 90 days is removed on launch.' },
    { id: 'subs', title: 'Downloaded subtitles', desc: 'Subtitle files; unused ones go after 30 days', more: 'Subtitle files fetched from your subtitle providers. Shared across rewatches; anything untouched for 30 days is removed on launch.' },
    { id: 'gif-capture', title: 'GIF recorder scratch', desc: 'Frames left if the app closed mid-recording', more: 'Frames from a GIF capture. Only holds anything if the app was killed mid-recording.' },
  ]

  let sizes = $state<Record<string, number>>({})
  let busy = $state('')
  let message = $state('')
  let messageError = $state(false)
  let loaded = $state(false)

  const total = $derived(Object.values(sizes).reduce((sum, n) => sum + n, 0))

  async function refresh(clearMessage = true) {
    try {
      const buckets = await invoke<{ id: string; bytes: number }[]>('cache_usage')
      sizes = Object.fromEntries(buckets.map((b) => [b.id, b.bytes]))
      if (clearMessage) { message = ''; messageError = false }
      return true
    } catch (error) {
      message = ioErrorMessage(error, 'Could not read cache sizes.')
      messageError = true
      return false
    } finally {
      loaded = true
    }
  }

  async function clear(bucket: string) {
    busy = bucket
    try {
      const freed = await invoke<number>('clear_cache', { bucket })
      const clearedMessage = freed > 0 ? `Freed ${formatBytes(freed)}.` : 'Nothing to clear.'
      if (await refresh(false)) { message = clearedMessage; messageError = false }
    } catch (error) {
      message = ioErrorMessage(error, 'Could not clear that cache.')
      messageError = true
    }
    busy = ''
  }

  // onMount, not $effect: this reads sizes into $state that the same function writes, and an effect
  // that both starts the read and lands its result is the self-write trap that cancels its own work.
  onMount(() => { void refresh() })
</script>

<SettingsRow
  settingKey="cache-total"
  title="Caches"
  description="Total cached on this device"
  learnMore="What izumi keeps on disk to avoid re-fetching it. All of it regenerates on demand, so clearing costs time, never data. Downloads, source packages and watch history are not caches."
  value={loaded ? formatBytes(total) || '0 B' : '…'}
  controlLayout="stack"
>
  {#snippet control()}
    <RefreshButton
      onRefresh={refresh}
      successLabel="Updated"
      class="min-w-[7rem] rounded-md border border-border px-3 py-2.5 text-sm font-bold hover:bg-accent sm:py-2 sm:text-xs"
    />
    <button data-focusable onclick={() => clear('all')} disabled={busy !== '' || total === 0}
            class="flex items-center gap-2 rounded-md bg-secondary px-3 py-2.5 text-sm font-bold hover:bg-accent disabled:opacity-50 sm:py-2 sm:text-xs">
      <Trash2 size={14} /> Clear all
    </button>
  {/snippet}
</SettingsRow>

{#each BUCKETS as bucket (bucket.id)}
  <SettingsRow
    settingKey={`cache-${bucket.id}`}
    title={bucket.title}
    description={bucket.desc}
    learnMore={bucket.more}
    value={loaded ? formatBytes(sizes[bucket.id] ?? 0) || '0 B' : '…'}
  >
    {#snippet control()}
      <button data-focusable onclick={() => clear(bucket.id)} disabled={busy !== '' || !sizes[bucket.id]}
              class="rounded-md border border-border px-3 py-2 text-sm font-bold hover:bg-accent disabled:opacity-50 sm:py-1.5 sm:text-xs">
        {busy === bucket.id ? 'Clearing…' : 'Clear'}
      </button>
    {/snippet}
  </SettingsRow>
{/each}

{#if message}
  <p role={messageError ? 'alert' : 'status'} class="px-3 py-2.5 text-sm {messageError ? 'text-destructive' : 'text-theme'}">{message}</p>
{/if}
