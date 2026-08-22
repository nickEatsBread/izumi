<script lang="ts">
  import { fade } from 'svelte/transition'
  import { nowPlayingStream, directTorrentStats, gameMode } from '$lib/player/session'
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
  const gm = $derived($gameMode)
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
    transition:fade={{ duration: gm ? 0 : 150 }}
    class="pointer-events-none absolute left-1/2 z-20 min-w-64 max-w-[calc(100%_-_2rem)] -translate-x-1/2 border border-white/15 bg-black/80 text-white shadow-2xl
      {gm ? 'rounded-2xl px-5 py-4' : 'rounded-xl px-4 py-3 backdrop-blur-md'}"
    style:top={buffering ? 'calc(50% + 4.25rem)' : 'max(1rem, var(--player-safe-top, 0px))'}
    aria-label="P2P playback status"
  >
    <div class="mb-1.5 text-center font-black uppercase tracking-[0.18em] text-white/60 {gm ? 'text-xs' : 'text-[10px]'}">P2P activity</div>
    {#if stats}
      <div class="flex items-center justify-center gap-4 font-mono font-bold tabular-nums {gm ? 'text-base' : 'text-sm'}">
        <span><span class="text-emerald-400">↓</span> {(Number.isFinite(stats.downloadMbps) ? stats.downloadMbps : 0).toFixed(1)} Mb/s</span>
        <span><span class="text-sky-400">↑</span> {(Number.isFinite(stats.uploadMbps) ? stats.uploadMbps : 0).toFixed(1)} Mb/s</span>
      </div>
      <div class="mt-1 text-center text-white/70 {gm ? 'text-sm' : 'text-[11px]'}">
        {stats.livePeers} {stats.livePeers === 1 ? 'peer' : 'peers'}
        {#if progress != null}<span class="px-1 text-white/30">·</span>{progress.toFixed(1)}% downloaded{/if}
      </div>
    {:else}
      <div class="text-center font-semibold text-white/80 {gm ? 'text-base' : 'text-sm'}">Connecting to peers…</div>
    {/if}
  </aside>
{/if}
