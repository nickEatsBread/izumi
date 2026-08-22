<script lang="ts">
  import { onMount } from 'svelte'
  import { invoke } from '@tauri-apps/api/core'
  import { directTorrentStats, bumpPlayerOverlay, gameMode } from '$lib/player/session'

  let values = $state<Record<string, string>>({})
  const properties = [
    ['Video', 'video-format'],
    ['Resolution', 'video-params/w'],
    ['FPS', 'estimated-vf-fps'],
    ['Dropped', 'frame-drop-count'],
    ['Audio', 'audio-codec-name'],
    ['Cache', 'demuxer-cache-duration'],
    ['Bitrate', 'video-bitrate'],
    ['Sync', 'avsync'],
  ] as const

  async function refresh() {
    const entries = await Promise.all(properties.map(async ([label, property]) => {
      try { return [label, await invoke<string>('player_get_property', { name: property })] as const }
      catch { return [label, '—'] as const }
    }))
    values = Object.fromEntries(entries)
    if ($gameMode) bumpPlayerOverlay()
  }

  onMount(() => {
    void refresh()
    const timer = setInterval(refresh, 1000)
    return () => clearInterval(timer)
  })

  const gib = (bytes: number) => `${(bytes / 1024 ** 3).toFixed(2)} GiB`
  const mib = (bytes: number) => `${(bytes / 1024 ** 2).toFixed(bytes < 10 * 1024 ** 2 ? 2 : 0)} MiB`
  // The engine reporting "finished" while the player is still waiting means the torrent believes
  // it has nothing left to fetch, and it will shed its seeders — call that out rather than making
  // it inferable from a peer count.
  const p2p = $derived($directTorrentStats)
</script>

<aside class="pointer-events-none absolute right-5 top-16 z-20 max-h-[calc(100vh-5rem)] w-72 overflow-hidden rounded-lg border border-white/15 bg-black/90 p-3 font-mono text-xs text-white shadow-2xl">
  <div class="mb-2 font-sans text-xs font-black uppercase tracking-widest text-white/60">Playback stats</div>
  {#each properties as [label]}
    <div class="flex justify-between gap-3 py-0.5"><span class="text-white/55">{label}</span><span class="truncate text-right">{values[label] ?? '—'}</span></div>
  {/each}

  {#if p2p}
    <div class="mb-2 mt-3 border-t border-white/15 pt-2 font-sans text-xs font-black uppercase tracking-widest text-white/60">Direct P2P</div>
    <div class="flex justify-between gap-3 py-0.5"><span class="text-white/55">Engine</span><span class="truncate text-right {p2p.error ? 'text-red-400' : ''}">{p2p.error ?? p2p.state}</span></div>
    <div class="flex justify-between gap-3 py-0.5"><span class="text-white/55">Down</span><span class="truncate text-right">{p2p.downloadMbps.toFixed(1)} Mb/s</span></div>
    <div class="flex justify-between gap-3 py-0.5"><span class="text-white/55">Up</span><span class="truncate text-right">{p2p.uploadMbps.toFixed(1)} Mb/s</span></div>
    <div class="flex justify-between gap-3 py-0.5"><span class="text-white/55">Peers</span><span class="truncate text-right">{p2p.livePeers} live / {p2p.connectingPeers} conn / {p2p.queuedPeers} queued</span></div>
    <div class="flex justify-between gap-3 py-0.5"><span class="text-white/55">Dropped</span><span class="truncate text-right {p2p.notNeededPeers > 0 ? 'text-amber-400' : ''}">{p2p.notNeededPeers} not-needed / {p2p.deadPeers} dead</span></div>
    <div class="flex justify-between gap-3 py-0.5"><span class="text-white/55">Seen</span><span class="truncate text-right">{p2p.seenPeers}</span></div>
    <div class="flex justify-between gap-3 py-0.5"><span class="text-white/55">File</span><span class="truncate text-right">{gib(p2p.downloadedBytes)} / {gib(p2p.selectedSize)}</span></div>
    {#if p2p.streamRequestCount > 0}
      <div class="flex justify-between gap-3 py-0.5"><span class="text-white/55">Local stream</span><span class="truncate text-right {p2p.streamReadFailed ? 'text-red-400' : ''}">{p2p.streamStatus ?? '—'} · {mib(p2p.streamBytesServed)} · {p2p.streamFirstByteMs == null ? 'waiting' : `${p2p.streamFirstByteMs} ms`}{p2p.streamReadFailed ? ' · failed' : p2p.streamReadFinished ? ' · done' : ''}</span></div>
    {/if}
    {#if p2p.finished}
      <div class="mt-1 rounded bg-amber-500/20 px-1.5 py-1 text-[10px] leading-tight text-amber-300">Engine reports FINISHED — it will stop asking peers for data.</div>
    {/if}
  {/if}
</aside>
