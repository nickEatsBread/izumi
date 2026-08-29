<script lang="ts">
  import { nowPlayingStream, directTorrentStats, gameMode } from '$lib/player/session'
  import { currentDirectTorrentPlaybackId, directTorrentHealth } from '$lib/player/direct-torrent'
  import { p2pStatusVisibility } from '$lib/settings/ui'
  import { isDirectP2PStream, shouldShowP2PStatus } from '$lib/player/p2p-status'
  import AndroidConnectionStatus from './AndroidConnectionStatus.svelte'

  let {
    buffering,
    firstFrameSeen,
    variant = 'desktop',
  }: {
    buffering: boolean
    firstFrameSeen: boolean
    variant?: 'desktop' | 'android'
  } = $props()

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
  const downloadMbps = $derived(stats && Number.isFinite(stats.downloadMbps) ? stats.downloadMbps : 0)
  const uploadMbps = $derived(stats && Number.isFinite(stats.uploadMbps) ? stats.uploadMbps : 0)
  const peerLabel = $derived(stats
    ? `${stats.livePeers} ${stats.livePeers === 1 ? 'peer' : 'peers'}`
    : '')
  const androidHeadline = $derived(
    !stats || (stats.livePeers === 0 && downloadMbps === 0)
      ? 'Finding P2P peers'
      : firstFrameSeen ? 'Rebuffering over P2P' : 'Loading from P2P peers',
  )
  const androidDetail = $derived.by(() => {
    if (!stats) return 'Connecting directly to the swarm…'
    const detail = [peerLabel]
    if (progress != null) detail.push(`${progress.toFixed(1)}% downloaded`)
    if (uploadMbps > 0) detail.push(`↑ ${uploadMbps.toFixed(1)} Mb/s`)
    return detail.join(' · ')
  })
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
  <!-- Like the parent loader, this must unmount without a Svelte outro: macOS marks the webview
       hidden while native mpv is visible, so animation-driven teardown may never complete. -->
  {#if variant === 'android' && buffering}
    <!-- Android's preparation flow already establishes a video-edge loading rail. Keep P2P in
         that same surface instead of stacking a desktop stats card beneath the centre spinner. -->
    <AndroidConnectionStatus
      placement="player"
      headline={androidHeadline}
      detail={androidDetail}
      metric={stats ? `↓ ${downloadMbps.toFixed(1)}` : ''}
      metricLabel={stats ? 'Mb/s' : ''}
      live="off"
    />
  {:else if variant === 'android'}
    <!-- "Always visible" remains useful on Android without reserving the whole lower video edge
         after loading. This compact readout also stays clear of the timeline. -->
    <aside
      class="pointer-events-none absolute left-1/2 top-3 z-20 flex max-w-[calc(100%_-_7rem)] -translate-x-1/2 items-center gap-2 rounded-full border border-white/10 bg-black/70 px-3 py-1.5 text-[11px] font-bold text-white/75 shadow-lg backdrop-blur landscape:top-16"
      aria-label="P2P playback status"
    >
      <span class="size-1.5 shrink-0 rounded-full bg-emerald-400 shadow-[0_0_8px_rgb(52_211_153/.8)]"></span>
      <span class="shrink-0 font-black uppercase tracking-wider text-white/55">P2P</span>
      {#if stats}
        <span class="truncate font-mono tabular-nums"><span class="text-emerald-400">↓</span> {downloadMbps.toFixed(1)} Mb/s · {peerLabel}</span>
      {:else}
        <span class="truncate">Connecting…</span>
      {/if}
    </aside>
  {:else}
    <aside
      class="pointer-events-none absolute left-1/2 z-20 min-w-64 max-w-[calc(100%_-_2rem)] -translate-x-1/2 border border-white/15 bg-black/80 text-white shadow-2xl
        {gm ? 'rounded-2xl px-5 py-4' : 'rounded-xl px-4 py-3 backdrop-blur-md'}"
      style:top={buffering ? 'calc(50% + 4.25rem)' : 'max(1rem, var(--player-safe-top, 0px))'}
      aria-label="P2P playback status"
    >
      <div class="mb-1.5 text-center font-black uppercase tracking-[0.18em] text-white/60 {gm ? 'text-xs' : 'text-[10px]'}">P2P activity</div>
      {#if stats}
        <div class="flex items-center justify-center gap-4 font-mono font-bold tabular-nums {gm ? 'text-base' : 'text-sm'}">
          <span><span class="text-emerald-400">↓</span> {downloadMbps.toFixed(1)} Mb/s</span>
          <span><span class="text-sky-400">↑</span> {uploadMbps.toFixed(1)} Mb/s</span>
        </div>
        <div class="mt-1 text-center text-white/70 {gm ? 'text-sm' : 'text-[11px]'}">
          {peerLabel}
          {#if progress != null}<span class="px-1 text-white/30">·</span>{progress.toFixed(1)}% downloaded{/if}
        </div>
      {:else}
        <div class="text-center font-semibold text-white/80 {gm ? 'text-base' : 'text-sm'}">Connecting to peers…</div>
      {/if}
    </aside>
  {/if}
{/if}
