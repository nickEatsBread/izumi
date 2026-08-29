<script lang="ts">
  import { onDestroy } from 'svelte'
  import Cast from '@lucide/svelte/icons/cast'
  import RefreshCw from '@lucide/svelte/icons/refresh-cw'
  import Square from '@lucide/svelte/icons/square'
  import { playerGetProperty, playerTracks } from '$lib/player/native'
  import { nowPlaying, nowPlayingStream, playerMenuOpen, playerNotice } from '$lib/player/session'
  import { castSourceDecision, type CastTrack } from '$lib/player/android-cast'
  import {
    desktopCastSession,
    discoverDesktopCast,
    prepareDesktopCast,
    selectedCastSubtitle,
    startDesktopCast,
    stopDesktopCast,
    type DesktopCastDevice,
  } from '$lib/player/desktop-cast'

  let {
    pos,
    buttonClass,
    iconSize = 20,
    cmd,
    onopen,
  }: {
    pos: number
    buttonClass: string
    iconSize?: number
    cmd: (name: string, args?: string[]) => void
    onopen?: () => void
  } = $props()

  let open = $state(false)
  let scanning = $state(false)
  let connectingId = $state<string | null>(null)
  let devices = $state<DesktopCastDevice[]>([])

  function message(error: unknown): string {
    if (typeof error === 'string') return error
    if (error instanceof Error) return error.message
    return 'Casting failed'
  }

  function close() {
    open = false
    playerMenuOpen.set(false)
  }

  async function refresh() {
    scanning = true
    try {
      devices = await discoverDesktopCast()
    } catch (error) {
      playerNotice.set(message(error))
    } finally {
      scanning = false
    }
  }

  function toggle() {
    if (open) {
      close()
      return
    }
    onopen?.()
    open = true
    playerMenuOpen.set(true)
    if (!$desktopCastSession) void refresh()
  }

  async function castTo(device: DesktopCastDevice) {
    if (connectingId) return
    connectingId = device.id
    try {
      const source = $nowPlayingStream
      const [rawTracks, fileFormat] = await Promise.all([
        playerTracks(),
        playerGetProperty('file-format').catch(() => ''),
      ])
      const tracks = JSON.parse(rawTracks) as CastTrack[]
      const decision = castSourceDecision(source, tracks, fileFormat)
      if (!decision.ok) throw new Error(decision.error)

      const selectedTrack = tracks.find((track) => track.type === 'sub' && track.selected)
      const subtitle = selectedCastSubtitle(source, tracks)
      const prepared = await prepareDesktopCast(source, subtitle)
      const session = await startDesktopCast({
        deviceId: device.id,
        url: prepared.url,
        title: $nowPlaying.animeTitle || $nowPlaying.title || 'Izumi',
        contentType: decision.contentType,
        positionSeconds: Math.max(0, pos),
        subtitles: prepared.subtitles,
      })
      desktopCastSession.set(session)
      // The receiver starts at this exact position; pause the duplicate local audio only after the
      // LOAD has been confirmed, so a failed Cast attempt never interrupts playback.
      cmd('set', ['pause', 'yes'])
      const subtitleWarning = selectedTrack && !subtitle
        ? ' The selected subtitle is not available to Cast.'
        : ''
      const detail = subtitleWarning.trim() || decision.warnings[0] || ''
      playerNotice.set(`Casting to ${session.deviceName}${detail ? `. ${detail}` : ''}`)
      close()
    } catch (error) {
      playerNotice.set(message(error))
    } finally {
      connectingId = null
    }
  }

  async function stop() {
    try {
      await stopDesktopCast()
      desktopCastSession.set(null)
      playerNotice.set('Casting stopped')
      close()
    } catch (error) {
      playerNotice.set(message(error))
    }
  }

  onDestroy(() => {
    if (open) playerMenuOpen.set(false)
  })
</script>

<div class="relative">
  <button
    data-focusable
    class="{buttonClass} {$desktopCastSession ? 'bg-primary/25 text-primary' : ''}"
    onclick={toggle}
    aria-label={$desktopCastSession ? `Casting to ${$desktopCastSession.deviceName}` : 'Cast to TV'}
    aria-pressed={!!$desktopCastSession}
    title={$desktopCastSession ? `Casting to ${$desktopCastSession.deviceName}` : 'Cast to TV'}
  >
    <Cast size={iconSize} />
  </button>

  {#if open}
    <button class="fixed inset-0 z-20 cursor-default" onclick={close} aria-label="Close Cast devices"></button>
    <div class="absolute bottom-full right-0 z-30 mb-2 w-72 overflow-hidden rounded-xl border border-white/10 bg-neutral-900 p-2 text-sm text-white shadow-2xl [transform:translateZ(0)]">
      <div class="flex items-center justify-between px-2 py-1.5">
        <span class="font-semibold">Cast to TV</span>
        {#if !$desktopCastSession}
          <button data-focusable class="grid size-8 place-items-center rounded-lg text-white/60 hover:bg-white/10" onclick={refresh} disabled={scanning} aria-label="Scan again">
            <RefreshCw size={16} class={scanning ? 'animate-spin' : ''} />
          </button>
        {/if}
      </div>

      {#if $desktopCastSession}
        <div class="rounded-lg bg-white/5 px-3 py-2.5">
          <span class="block text-xs uppercase tracking-wide text-white/45">Now casting</span>
          <span class="block truncate font-semibold">{$desktopCastSession.deviceName}</span>
        </div>
        <button data-focusable class="mt-1 flex w-full items-center gap-2 rounded-lg px-3 py-2.5 text-left text-red-300 transition hover:bg-white/10" onclick={stop}>
          <Square size={14} fill="currentColor" /> Stop casting
        </button>
      {:else if scanning && !devices.length}
        <div class="flex items-center gap-2 px-3 py-4 text-white/55">
          <span class="size-3 animate-spin rounded-full border-2 border-white/20 border-t-white/70"></span>
          Looking for TVs on this network…
        </div>
      {:else if devices.length}
        {#each devices as device (device.id)}
          <button
            data-focusable
            disabled={!!connectingId}
            class="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition hover:bg-white/10 disabled:opacity-50"
            onclick={() => castTo(device)}
          >
            {#if connectingId === device.id}
              <span class="size-4 shrink-0 animate-spin rounded-full border-2 border-white/20 border-t-white/80"></span>
            {:else}
              <Cast size={17} class="shrink-0 text-white/55" />
            {/if}
            <span class="min-w-0">
              <span class="block truncate font-medium">{device.name}</span>
              <span class="block truncate text-xs text-white/40">{device.model ?? 'Google Cast device'}</span>
            </span>
          </button>
        {/each}
      {:else}
        <p class="px-3 py-4 text-white/45">No Cast devices found. Make sure this computer and TV are on the same network.</p>
      {/if}
    </div>
  {/if}
</div>
