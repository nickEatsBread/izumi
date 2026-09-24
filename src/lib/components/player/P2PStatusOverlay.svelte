<script lang="ts">
  import Users from '@lucide/svelte/icons/users'
  import ChevronDown from '@lucide/svelte/icons/chevron-down'
  import ChevronUp from '@lucide/svelte/icons/chevron-up'
  import { nowPlayingStream, directTorrentStats, gameMode, commentsOpen } from '$lib/player/session'
  import { discussionExpanded } from '$lib/comments'
  import { currentDirectTorrentPlaybackId, directTorrentHealth } from '$lib/player/direct-torrent'
  import { p2pStatusVisibility } from '$lib/settings/ui'
  import { isDirectP2PStream, shouldShowP2PStatus } from '$lib/player/p2p-status'
  import { formatBitRate } from '$lib/util/format'
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
  const gm = $derived($gameMode)
  const visible = $derived(shouldShowP2PStatus(
    $p2pStatusVisibility,
    directP2P,
    buffering,
    firstFrameSeen,
  ) && torrentReady)
  const iconSize = $derived(gm ? 24 : 18)
  // The docked discussion panel (max-w-md) covers the right of the video; centre over what's left.
  const commentsDocked = $derived(!gm && $commentsOpen && !$discussionExpanded)
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
    <!-- Swarm readout on the player's top edge: peers, download and upload in one bare row, with
         no card or label. It sits in the empty middle of the transparent titlebar strip and above
         the controls' top gradient, so it reads as part of the chrome. Until the first health
         sample lands it shows zeros rather than a separate "connecting" state. -->
    <aside
      class="pointer-events-none absolute inset-x-0 top-0 z-20 flex items-center justify-center whitespace-nowrap font-bold text-neutral-50 [text-shadow:0_1px_2px_#0000001a,0_3px_2px_#0000001a,0_4px_8px_#0000001a]
        {gm ? 'gap-6 pt-5 text-2xl' : 'gap-4 pt-3 text-lg'}"
      style:right={commentsDocked ? 'min(28rem, 100%)' : undefined}
      aria-label="P2P playback status"
    >
      <span class="flex items-center gap-2" title="Peers"><Users size={iconSize} class="drop-shadow" />{stats?.livePeers ?? 0}</span>
      <span class="flex items-center gap-2" title="Download speed"><ChevronDown size={iconSize} class="drop-shadow" />{formatBitRate(downloadMbps)}</span>
      <span class="flex items-center gap-2" title="Upload speed"><ChevronUp size={iconSize} class="drop-shadow" />{formatBitRate(uploadMbps)}</span>
    </aside>
  {/if}
{/if}
