<script lang="ts">
  // The toolbar block of a theme's docked watch page (`player.dock.below: ["toolbar", …]`): a row of
  // equal dropdowns under the video — the server, the episode, the release and a download — each
  // opening its menu upward, like a streaming site's player settings bar. Every choice takes the
  // route the player's own controls use: episodes go through `playEpisodeInPlayer`, a server or a
  // release is swapped in place at the current position, and "More sources" reopens the picker.
  import { nowPlaying, nowPlayingMedia, nowPlayingStream, playbackRecovery, playerNotice, directTorrentStats } from '$lib/player/session'
  import { playEpisode, playEpisodeInPlayer, playStream } from '$lib/stremio/play'
  import { playerGetProperty } from '$lib/player/native'
  import { animeEpisodeNumbers } from '$lib/catalog/anime-detail'
  import { airedCount } from '$lib/anilist/media'
  import { serverSiblings, variantLabels } from '$lib/player/source-variants'
  import { describe, qualityLabel } from '$lib/stremio/addon'
  import type { Stream } from '$lib/stremio/addon'
  import { downloads, keyFor } from '$lib/downloads/state'
  import { enqueue } from '$lib/downloads/store'
  import { currentDownloadPreferences } from '$lib/downloads/rules'
  import type { PlayerToolbarItem } from '$lib/themes/presentation'
  import ChevronUp from '@lucide/svelte/icons/chevron-up'

  // `menus`: open upward over the video (page flow, right under it) or downward (inside the fixed rail).
  let { items, menus = 'up' }: { items: PlayerToolbarItem[]; menus?: 'up' | 'down' } = $props()

  const context = $derived($nowPlayingMedia)
  const media = $derived(context?.media ?? null)
  const current = $derived($nowPlaying.episode ?? context?.episode ?? null)
  const aired = $derived(media ? airedCount(media) : 0)
  const numbers = $derived(media ? animeEpisodeNumbers(media).filter((n) => aired <= 0 || n <= aired) : [])

  const recovery = $derived($playbackRecovery)
  const currentStream = $derived(recovery?.current ?? null)
  const servers = $derived(currentStream ? [currentStream, ...serverSiblings(currentStream, recovery?.streams ?? [])] : [])
  const serverLabels = $derived(variantLabels(servers))

  // Debrid services by the short code the stream parser reports.
  const DEBRID: Record<string, string> = { RD: 'Real-Debrid', AD: 'AllDebrid', PM: 'Premiumize', TB: 'TorBox', OC: 'Offcloud', DL: 'Debrid-Link' }
  // Where the video is coming from: a local torrent stream, a debrid service, a site's server.
  // A debrid row carries the torrent's infohash too, so the service is checked before P2P.
  const serverLabel = $derived.by(() => {
    const info = currentStream ? describe(currentStream) : null
    if (info?.provider) return DEBRID[info.provider] ?? info.provider
    if ($directTorrentStats || ($nowPlayingStream.infoHash && !currentStream?.__stream)) return 'P2P'
    if (!currentStream || !info) return 'Server'
    if (currentStream.__stream) return serverLabels[0] ?? 'Server'
    return info.addon ?? currentStream.name ?? 'Server'
  })
  const releaseLabel = (s: Stream) => {
    const info = describe(s)
    const name = info.group ?? info.addon ?? s.name ?? 'Source'
    return info.quality ? `${name} · ${qualityLabel(info.quality)}` : name
  }
  // Other releases of this episode: the ranked pool the picker resolved, one row per label.
  const releases = $derived.by(() => {
    const pool = recovery?.streams ?? []
    const seen = new Set<string>()
    const rows: { stream: Stream; label: string }[] = []
    for (const stream of currentStream ? [currentStream, ...pool] : pool) {
      const label = releaseLabel(stream)
      if (seen.has(label)) continue
      seen.add(label)
      rows.push({ stream, label })
      if (rows.length >= 10) break
    }
    return rows
  })

  const download = $derived(media && current != null ? $downloads[keyFor(media.id, current)] : undefined)
  const downloadLabel = $derived(
    !download ? `Episode ${current ?? ''}`.trim()
      : download.status === 'done' ? 'Downloaded'
        : download.status === 'downloading' && download.bytes > 0 ? `Downloading ${Math.round((download.downloaded / download.bytes) * 100)}%`
          : download.status === 'error' ? 'Download failed, retry'
            : download.status === 'paused' ? 'Download paused' : 'Queued',
  )

  let open = $state<PlayerToolbarItem | null>(null)
  let busy = $state(false)
  let root = $state<HTMLElement | undefined>(undefined)
  $effect(() => {
    if (!open) return
    const outside = (event: PointerEvent) => { if (!root?.contains(event.target as Node)) open = null }
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') open = null }
    window.addEventListener('pointerdown', outside, true)
    window.addEventListener('keydown', escape)
    return () => { window.removeEventListener('pointerdown', outside, true); window.removeEventListener('keydown', escape) }
  })
  // The current choice (the playing episode in a long list) is scrolled into view when a menu opens.
  let menu = $state<HTMLElement | undefined>(undefined)
  $effect(() => { if (open) menu?.querySelector<HTMLElement>('[data-state="active"]')?.scrollIntoView({ block: 'nearest' }) })

  async function pickEpisode(n: number) {
    open = null
    if (!media || busy || n === current) return
    busy = true
    try { await playEpisodeInPlayer(media, n) } finally { busy = false }
  }
  async function swap(target: Stream) {
    open = null
    if (!context || busy || target === currentStream) return
    busy = true
    const startSeconds = Number(await playerGetProperty('time-pos').catch(() => '0')) || 0
    await playStream(context.media, context.episode, target, (s) => {
      if (s.status === 'error') playerNotice.set(s.message ?? 'Could not switch source.')
    }, { autoplay: true, startSeconds })
    busy = false
  }
  function moreSources() {
    open = null
    if (context) void playEpisode(context.media, context.episode, () => {}, { forceManual: true, autoplay: true })
  }
  function downloadEpisode() {
    open = null
    if (media && current != null) enqueue(media, current, currentDownloadPreferences())
  }

  const label = (item: PlayerToolbarItem) =>
    item === 'server' ? serverLabel
      : item === 'episode' ? (current != null ? `Episode ${current}` : 'Episodes')
        : item === 'release' ? (currentStream ? releaseLabel(currentStream) : 'Source')
          : 'Download'
</script>

<div bind:this={root} data-slot="watch.toolbar" class="relative grid w-full bg-card text-card-foreground" style:grid-template-columns={`repeat(${items.length}, minmax(0, 1fr))`}>
  {#each items as item (item)}
    <div class="relative min-w-0">
      <button type="button" data-part="watch.toolbar.item" data-item={item} data-state={open === item ? 'open' : 'closed'} data-focusable
              aria-haspopup="menu" aria-expanded={open === item} disabled={busy}
              onclick={() => (open = open === item ? null : item)}
              class="flex h-11 w-full items-center justify-center gap-2 px-4 text-sm transition-colors hover:bg-accent disabled:opacity-60">
        <span class="min-w-0 truncate">{label(item)}</span><ChevronUp size={14} class="shrink-0 opacity-70 {menus === 'down' ? 'rotate-180' : ''}" />
      </button>
      {#if open === item}
        <div data-part="watch.toolbar.menu" data-item={item} role="menu"
             class="absolute left-1/2 z-10 {menus === 'up' ? 'bottom-full mb-1' : 'top-full mt-1'} max-h-[min(60vh,24rem)] min-w-[12rem] max-w-[min(90vw,24rem)] -translate-x-1/2 overflow-y-auto rounded-md border border-border bg-popover py-1 text-sm text-popover-foreground shadow-lg"
             bind:this={menu}>
          {#if item === 'server'}
            {#if servers.length}
              {#each servers as stream, index (stream)}
                <button type="button" role="menuitem" data-part="watch.toolbar.option" data-state={stream === currentStream ? 'active' : undefined}
                        onclick={() => swap(stream)} class="block w-full truncate px-4 py-1.5 text-left hover:bg-accent">{serverLabels[index]}</button>
              {/each}
            {:else}
              <div data-part="watch.toolbar.option" data-state="active" class="px-4 py-1.5">{serverLabel}</div>
            {/if}
          {:else if item === 'episode'}
            {#each numbers as n (n)}
              <button type="button" role="menuitem" data-part="watch.toolbar.option" data-state={n === current ? 'active' : undefined}
                      onclick={() => pickEpisode(n)} class="block w-full px-4 py-1.5 text-left hover:bg-accent">Episode {n}</button>
            {/each}
          {:else if item === 'release'}
            {#each releases as row (row.label)}
              <button type="button" role="menuitem" data-part="watch.toolbar.option" data-state={row.stream === currentStream ? 'active' : undefined}
                      onclick={() => swap(row.stream)} class="block w-full truncate px-4 py-1.5 text-left hover:bg-accent">{row.label}</button>
            {/each}
            <button type="button" role="menuitem" data-part="watch.toolbar.option" onclick={moreSources}
                    class="block w-full px-4 py-1.5 text-left text-muted-foreground hover:bg-accent hover:text-foreground">More sources…</button>
          {:else}
            <button type="button" role="menuitem" data-part="watch.toolbar.option" data-state={download?.status === 'done' ? 'active' : undefined}
                    disabled={!!download && download.status !== 'error'} onclick={downloadEpisode}
                    class="block w-full truncate px-4 py-1.5 text-left hover:bg-accent disabled:cursor-default">{downloadLabel}</button>
          {/if}
        </div>
      {/if}
    </div>
  {/each}
</div>
