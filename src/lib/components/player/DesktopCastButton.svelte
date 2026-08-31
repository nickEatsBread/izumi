<script lang="ts">
  import { onDestroy } from 'svelte'
  import Cast from '@lucide/svelte/icons/cast'
  import RefreshCw from '@lucide/svelte/icons/refresh-cw'
  import Square from '@lucide/svelte/icons/square'
  import Play from '@lucide/svelte/icons/play'
  import Pause from '@lucide/svelte/icons/pause'
  import RotateCcw from '@lucide/svelte/icons/rotate-ccw'
  import RotateCw from '@lucide/svelte/icons/rotate-cw'
  import Smartphone from '@lucide/svelte/icons/smartphone'
  import Captions from '@lucide/svelte/icons/captions'
  import Volume2 from '@lucide/svelte/icons/volume-2'
  import { playerGetProperty, playerTracks } from '$lib/player/native'
  import { nowPlaying, nowPlayingMedia, nowPlayingStream, playerMenuOpen, playerNotice } from '$lib/player/session'
  import { castSourceDecision, castSubtitleFormat, type CastTrack } from '$lib/player/android-cast'
  import {
    desktopCastSession,
    desktopCastStatus,
    controlDesktopCast,
    desktopCastContentType,
    desktopCastSupportsDlnaSubtitles,
    discoverDesktopCast,
    refreshDesktopCastStatus,
    hasTizenReceiver,
    prepareDesktopCast,
    selectedCastSubtitle,
    startDesktopCast,
    startDesktopCastStatusPolling,
    stopDesktopCast,
    type DesktopCastDevice,
  } from '$lib/player/desktop-cast'
  import {
    subtitleStyleEnabled, subtitleOverrideScope, subtitleFont, subtitleBold, subtitleFontSize,
    subtitleTextColor, subtitleBorderColor, subtitleBorderSize, subtitleShadow, subtitlePosition,
  } from '$lib/settings/ui'
  import { effectiveSubtitleStyle, sessionSubtitleStyle } from '$lib/settings/subtitle-presets'
  import { discoverCompanionReceivers } from '$lib/companion/client'
  import { m } from '$lib/paraglide/messages.js'

  let {
    pos,
    dur,
    buttonClass,
    iconSize = 20,
    cmd,
    onopen,
  }: {
    pos: number
    dur: number
    buttonClass: string
    iconSize?: number
    cmd: (name: string, args?: string[]) => void
    onopen?: () => void
  } = $props()

  let open = $state(false)
  let scanning = $state(false)
  let connectingId = $state<string | null>(null)
  let devices = $state<DesktopCastDevice[]>([])
  let controlling = $state(false)

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
      const [native, companions] = await Promise.all([
        discoverDesktopCast().catch(() => []),
        discoverCompanionReceivers().catch(() => []),
      ])
      const byAddress = new Map(native.map((device) => [device.address, device]))
      for (const companion of companions) {
        byAddress.set(companion.address, {
          ...companion,
          manufacturer: 'Samsung',
          port: 8001,
          protocol: 'tizenReceiver',
        })
      }
      devices = [...byAddress.values()].sort((a, b) => a.name.localeCompare(b.name))
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
      const decision = castSourceDecision(source, tracks, fileFormat, device.protocol === 'googleCast' ? 'googleCast' : 'tv')
      if (!decision.ok) throw new Error(decision.error)

      const selectedTrack = tracks.find((track) => track.type === 'sub' && track.selected)
      const subtitle = selectedCastSubtitle(source, tracks)
      const samsungDlnaSubtitles = desktopCastSupportsDlnaSubtitles(device)
      // A discovered Companion may be installed but closed. Its Application connection below
      // launches it, so preserve receiver-only subtitle formats during source preparation.
      const receiverAvailable = device.protocol === 'tizenReceiver' || await hasTizenReceiver(device)
      const compatible = (source.subtitles ?? []).filter((candidate) => {
        const format = castSubtitleFormat(candidate.url)
        if (!format) return false
        if (format === 'ass') return receiverAvailable
        return receiverAvailable || !samsungDlnaSubtitles || format === 'srt' || format === 'vtt'
      })
      const selectedSubtitle = subtitle && compatible.some((candidate) => candidate.url === subtitle.url)
        ? subtitle
        : null
      const compatibleSubtitles = selectedSubtitle
        ? [selectedSubtitle, ...compatible.filter((candidate) => candidate.url !== selectedSubtitle.url)].slice(0, 8)
        : compatible.slice(0, 8)
      const receiverContentType = desktopCastContentType(device, decision.contentType)
      const selectedIndex = selectedSubtitle
        ? compatibleSubtitles.findIndex((candidate) => candidate.url === selectedSubtitle.url)
        : -1
      const activeTrackIds = selectedIndex >= 0 ? [selectedIndex + 1] : []
      const prepared = await prepareDesktopCast(source, compatibleSubtitles, {
        // Samsung's 2018 AllShare player fails on otherwise valid modern HTTPS CDN endpoints.
        // Give the DLNA fallback a stable LAN HTTP URL. Izumi Companion receives the original
        // source and streams it on the TV; cast_prepare_source still bridges individual resources
        // that are loopback-only or require request headers.
        forceRelay: device.protocol === 'dlna' && !receiverAvailable,
        contentType: receiverContentType,
        subtitleDelivery: receiverAvailable ? 'tizenReceiver' : samsungDlnaSubtitles ? 'samsungDlna' : 'web',
      })
      // Discovery and relay preparation can take several seconds while local playback continues.
      // Read mpv's clock at the LOAD boundary so the TV starts where the viewer actually is now,
      // rather than at the position captured when the cast menu was first opened.
      const livePosition = Number.parseFloat(await playerGetProperty('time-pos').catch(() => ''))
      const castPosition = Number.isFinite(livePosition) ? Math.max(0, livePosition) : Math.max(0, pos)
      const nativeSession = await startDesktopCast({
        device,
        deviceId: device.id,
        url: prepared.url,
        title: $nowPlaying.animeTitle || $nowPlaying.title || 'Izumi',
        contentRating: $nowPlayingMedia?.media.contentRating || ($nowPlayingMedia?.media.isAdult ? '18' : undefined),
        contentType: receiverContentType,
        positionSeconds: castPosition,
        subtitles: prepared.subtitles,
        activeTrackIds,
        receiverPreferred: receiverAvailable,
        subtitleStyle: effectiveSubtitleStyle($sessionSubtitleStyle, {
          enabled: $subtitleStyleEnabled,
          scope: $subtitleOverrideScope,
          font: $subtitleFont,
          bold: $subtitleBold,
          fontSize: $subtitleFontSize,
          textColor: $subtitleTextColor,
          borderColor: $subtitleBorderColor,
          borderSize: $subtitleBorderSize,
          shadow: $subtitleShadow,
          position: $subtitlePosition,
        }),
      })
      const exposesSubtitles = nativeSession.backend !== 'dlna' || samsungDlnaSubtitles
      const remoteSubtitles = exposesSubtitles ? prepared.subtitles : []
      const remoteTrackIds = exposesSubtitles ? activeTrackIds : []
      const session = {
        ...nativeSession,
        mediaId: $nowPlaying.id,
        episode: $nowPlaying.episode,
        subtitles: remoteSubtitles.map((item, index) => ({
          trackId: index + 1,
          title: item.title || item.lang || `Subtitle ${index + 1}`,
          lang: item.lang,
        })),
        activeTrackIds: remoteTrackIds,
      }
      // The receiver starts at this exact position; pause the duplicate local audio only after the
      // LOAD has been confirmed, so a failed Cast attempt never interrupts playback.
      cmd('set', ['pause', 'yes'])
      desktopCastSession.set(session)
      startDesktopCastStatusPolling({
        state: 'playing',
        positionSeconds: castPosition,
        durationSeconds: dur > 0 ? dur : undefined,
      })
      const subtitleWarning = selectedTrack && !selectedSubtitle
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

  async function control(action: 'play' | 'pause' | 'seek' | 'volume' | 'tracks', extra: Record<string, unknown> = {}) {
    if (controlling) return
    controlling = true
    try { await controlDesktopCast({ action, ...extra }) }
    catch (error) { playerNotice.set(message(error)) }
    finally { controlling = false }
  }

  async function pickCastSubtitle(trackId: number | null) {
    const activeTrackIds = trackId == null ? [] : [trackId]
    await control('tracks', { activeTrackIds })
    if ($desktopCastSession) desktopCastSession.set({ ...$desktopCastSession, activeTrackIds })
  }

  async function handoff() {
    try {
      const latest = await refreshDesktopCastStatus().catch(() => $desktopCastStatus)
      await stopDesktopCast()
      desktopCastSession.set(null)
      if (latest) cmd('seek', [String(latest.positionSeconds), 'absolute+exact'])
      cmd('set', ['pause', 'no'])
      playerNotice.set('Playback continued on this device')
      close()
    } catch (error) { playerNotice.set(message(error)) }
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
    aria-label={$desktopCastSession ? `Casting to ${$desktopCastSession.deviceName}` : m.cast_title()}
    aria-pressed={!!$desktopCastSession}
    title={$desktopCastSession ? `Casting to ${$desktopCastSession.deviceName}` : m.cast_title()}
  >
    <Cast size={iconSize} />
  </button>

  {#if open}
    <button class="fixed inset-0 z-20 cursor-default" onclick={close} aria-label="Close Cast devices"></button>
    <div class="absolute bottom-full right-0 z-30 mb-2 w-72 overflow-hidden rounded-xl border border-white/10 bg-neutral-900 p-2 text-sm text-white shadow-2xl [transform:translateZ(0)]">
      <div class="flex items-center justify-between px-2 py-1.5">
        <span class="font-semibold">{m.cast_title()}</span>
        {#if !$desktopCastSession}
          <button data-focusable class="grid size-8 place-items-center rounded-lg text-white/60 hover:bg-white/10" onclick={refresh} disabled={scanning} aria-label={m.cast_scan()}>
            <RefreshCw size={16} class={scanning ? 'animate-spin' : ''} />
          </button>
        {/if}
      </div>

      {#if $desktopCastSession}
        <div class="rounded-lg bg-white/5 px-3 py-2.5">
          <span class="block text-xs uppercase tracking-wide text-white/45">{m.cast_now_casting()}</span>
          <span class="block truncate font-semibold">{$desktopCastSession.deviceName}</span>
          {#if $desktopCastStatus}
            <span class="mt-1 block text-xs capitalize text-white/45">{$desktopCastStatus.state} · {Math.floor($desktopCastStatus.positionSeconds / 60)}:{String(Math.floor($desktopCastStatus.positionSeconds % 60)).padStart(2, '0')}</span>
            {#if $desktopCastStatus.subtitleError}
              <span class="mt-1 block text-xs text-amber-300">Subtitle: {$desktopCastStatus.subtitleError}</span>
            {/if}
          {/if}
        </div>
        <div class="mt-1 grid grid-cols-4 gap-1">
          <button data-focusable onclick={() => control('seek', { positionSeconds: Math.max(0, ($desktopCastStatus?.positionSeconds ?? 0) - 10) })} aria-label={m.cast_seek_back()} class="grid h-9 place-items-center rounded-lg hover:bg-white/10"><RotateCcw size={16} /></button>
          {#if $desktopCastStatus?.state === 'paused'}
            <button data-focusable onclick={() => control('play')} aria-label={m.cast_play()} class="grid h-9 place-items-center rounded-lg hover:bg-white/10"><Play size={16} class="fill-current" /></button>
          {:else}
            <button data-focusable onclick={() => control('pause')} aria-label={m.cast_pause()} class="grid h-9 place-items-center rounded-lg hover:bg-white/10"><Pause size={16} class="fill-current" /></button>
          {/if}
          <button data-focusable onclick={() => control('seek', { positionSeconds: ($desktopCastStatus?.positionSeconds ?? 0) + 10 })} aria-label={m.cast_seek_forward()} class="grid h-9 place-items-center rounded-lg hover:bg-white/10"><RotateCw size={16} /></button>
          <button data-focusable onclick={handoff} aria-label={m.cast_handoff()} class="grid h-9 place-items-center rounded-lg hover:bg-white/10"><Smartphone size={16} /></button>
        </div>
        <label class="mt-2 flex items-center gap-2 rounded-lg bg-white/5 px-3 py-2 text-xs text-white/60">
          <Volume2 size={15} /><span class="sr-only">{m.cast_volume()}</span>
          <input data-focusable type="range" min="0" max="1" step="0.05" value={$desktopCastStatus?.volume ?? 0.5} oninput={(event) => control('volume', { volume: Number(event.currentTarget.value) })} class="min-w-0 flex-1" />
        </label>
        {#if $desktopCastSession.subtitles.length}
          <div class="mt-2 rounded-lg bg-white/5 p-2">
            <p class="mb-1 flex items-center gap-1.5 px-1 text-xs font-bold text-white/50"><Captions size={14} />{m.cast_subtitles()}</p>
            <button data-focusable onclick={() => pickCastSubtitle(null)} class="block w-full rounded-md px-2 py-1.5 text-left text-xs hover:bg-white/10 {$desktopCastSession.activeTrackIds.length ? '' : 'text-theme'}">{m.cast_subtitles_off()}</button>
            {#each $desktopCastSession.subtitles as subtitle (subtitle.trackId)}
              <button data-focusable onclick={() => pickCastSubtitle(subtitle.trackId)} class="block w-full truncate rounded-md px-2 py-1.5 text-left text-xs hover:bg-white/10 {$desktopCastSession.activeTrackIds.includes(subtitle.trackId) ? 'text-theme' : ''}">{subtitle.title}</button>
            {/each}
          </div>
        {/if}
        <button data-focusable class="mt-1 flex w-full items-center gap-2 rounded-lg px-3 py-2.5 text-left transition hover:bg-white/10" onclick={handoff}>
          <Smartphone size={15} /> {m.cast_handoff()}
        </button>
        <button data-focusable class="mt-1 flex w-full items-center gap-2 rounded-lg px-3 py-2.5 text-left text-red-300 transition hover:bg-white/10" onclick={stop}>
          <Square size={14} fill="currentColor" /> {m.cast_stop()}
        </button>
      {:else if scanning && !devices.length}
        <div class="flex items-center gap-2 px-3 py-4 text-white/55">
          <span class="size-3 animate-spin rounded-full border-2 border-white/20 border-t-white/70"></span>
          {m.cast_scanning()}
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
              <span class="block truncate text-xs text-white/40">
                {device.protocol === 'tizenReceiver'
                  ? `${device.model ?? 'Samsung TV'} · Companion receiver`
                  : device.protocol === 'dlna'
                  ? `${device.model ?? device.manufacturer ?? 'Smart TV'} · ${/samsung/i.test(`${device.manufacturer ?? ''} ${device.name}`) ? 'Izumi receiver / DLNA' : 'DLNA'}`
                  : device.model ?? 'Google Cast device'}
              </span>
            </span>
          </button>
        {/each}
      {:else}
        <p class="px-3 py-4 text-white/45">{m.cast_empty()}</p>
      {/if}
    </div>
  {/if}
</div>
