<script lang="ts">
  import { fade } from 'svelte/transition'
  import { nowPlayingStream, directTorrentStats } from '$lib/player/session'
  import { currentDirectTorrentPlaybackId, directTorrentHealth } from '$lib/player/direct-torrent'
  import { p2pStatusVisibility } from '$lib/settings/ui'
  import { isDirectP2PStream, shouldShowP2PStatus } from '$lib/player/p2p-status'

  let { buffering, firstFrameSeen }: { buffering: boolean; firstFrameSeen: boolean } = $props()

  const directP2P = $derived(isDirectP2PStream($nowPlayingStream))
  const torrentReady = $derived($directTorrentStats != null || currentDirectTorrentPlaybackId() != null)
  const visible = $derived(shouldShowP2PStatus(
    $p2pStatusVisibility,
    directP2P,
    buffering,
    firstFrameSeen,
  ) && torrentReady)
  const stats = $derived($directTorrentStats)
  const progress = $derived(stats && stats.selectedSize > 0
    ? Math.min(100, stats.downloadedBytes / stats.selectedSize * 100)
    : null)
  let healthBusy = false

  async function refresh() {
    if (healthBusy) return
    healthBusy = true
    const playbackId = currentDirectTorrentPlaybackId()
    try {
      const health = await directTorrentHealth()
      if (directP2P && currentDirectTorrentPlaybackId() === playbackId) directTorrentStats.set(health)
    } finally {
      healthBusy = false
    }
  }

  // Poll only while the selected visibility mode can actually paint the panel. The player
  // watchdog also samples health for recovery; this small read covers Android/movie paths that do
  // not have that watchdog and keeps "Always visible" live after startup.
  $effect(() => {
    if (!visible) return
    void refresh()
    const timer = setInterval(refresh, 1_000)
    return () => clearInterval(timer)
  })
</script>

{#if visible}
  <aside
    transition:fade={{ duration: 150 }}
    class="pointer-events-none absolute left-1/2 z-20 min-w-64 max-w-[calc(100%_-_2rem)] -translate-x-1/2 rounded-xl border border-white/15 bg-black/75 px-4 py-3 text-white shadow-2xl backdrop-blur-md"
    style:top={buffering ? 'calc(50% + 4.25rem)' : 'max(1rem, var(--player-safe-top, 0px))'}
    aria-label="P2P playback status"
  >
    <div class="mb-1.5 text-center text-[10px] font-black uppercase tracking-[0.18em] text-white/60">P2P activity</div>
    {#if stats}
      <div class="flex items-center justify-center gap-4 font-mono text-sm font-bold tabular-nums">
        <span><span class="text-emerald-400">↓</span> {(Number.isFinite(stats.downloadMbps) ? stats.downloadMbps : 0).toFixed(1)} Mb/s</span>
        <span><span class="text-sky-400">↑</span> {(Number.isFinite(stats.uploadMbps) ? stats.uploadMbps : 0).toFixed(1)} Mb/s</span>
      </div>
      <div class="mt-1 text-center text-[11px] text-white/65">
        {stats.livePeers} {stats.livePeers === 1 ? 'peer' : 'peers'}
        {#if progress != null}<span class="px-1 text-white/30">·</span>{progress.toFixed(1)}% downloaded{/if}
      </div>
    {:else}
      <div class="text-center text-sm font-semibold text-white/80">Connecting to peers…</div>
    {/if}
  </aside>
{/if}
