<script lang="ts">
  import { onDestroy, untrack } from 'svelte'
  import { invoke } from '@tauri-apps/api/core'
  import {
    preferredAudioLang, preferredSubLang, videoFit,
    gifScale, gifMaxSeconds,
    subtitleStyleEnabled, subtitleFont as savedSubtitleFont, subtitleFontSize as savedSubtitleFontSize,
    subtitleTextColor, subtitleBorderColor as savedSubtitleBorderColor,
    subtitleBorderSize as savedSubtitleBorderSize, subtitleShadow as savedSubtitleShadow,
    subtitlePosition as savedSubtitlePosition,
  } from '$lib/settings/ui'
  import { effectiveSubtitleStyle, sessionSubtitleStyle } from '$lib/settings/subtitle-presets'
  import { get } from 'svelte/store'
  import { pickSubtitleTrackId } from '$lib/player/track-policy'
  import { DRM_CATALOG_WAIT_MS, preferredDrmPresentation, shouldAutoReloadHardsub, waitForCatalog } from '$lib/player/preferred-drm'
  import { AUTO_ABR, abrMaxHeight, shouldPinFastStart } from '$lib/player/abr'
  import { gifCapturePlan } from '$lib/player/gif-settings'
  import { encodeVideoFrame } from '$lib/player/video-frame'
  import { BUFFER_SPINNER_DELAY_MS, bufferSpinnerAction } from '$lib/player/overlay-loading'
  import { PLAYER_CAPTURE_CLASS, withPlayerChromeHidden } from '$lib/player/capture-chrome'
  import {
    applyPlayerCommand,
    assToVtt,
    bufferedEnd,
    clampSeekTime,
    drmTextType,
    nearestBifFrame,
    parseBif,
    holdPlaybackDuration,
    playbackDuration,
    emitDrmEnded,
    emitDrmProgress,
    isSolidBlackImageData,
    mapScreenshotCrop,
    mpvColorToCss,
    playerProperty,
    setDrmEngine,
    videoShotRect,
    type DrmAudioChoice,
    type DrmEngine,
    type DrmSnapshot,
    type DrmSubtitle,
    type DrmTrack,
    type StreamDrm,
  } from '$lib/player/drm'
  import { langsEqual } from '$lib/stremio/sublang'

  let {
    url,
    drm,
    startSeconds = 0,
    subtitles = [],
    audioLang = '',
    audioChoices = [],
    previewUrl = '',
    onupdate,
  }: {
    url: string
    drm: StreamDrm
    startSeconds?: number
    subtitles?: DrmSubtitle[]
    audioLang?: string
    audioChoices?: DrmAudioChoice[]
    previewUrl?: string
    onupdate: (snapshot: DrmSnapshot) => void
  } = $props()

  let videoEl = $state<HTMLVideoElement | undefined>(undefined)
  let textEl = $state<HTMLDivElement | undefined>(undefined)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let player: any = null
  let loadGen = 0
  let firstFrame = false
  let buffering = true
  let error: string | null = null
  let ended = false
  let textTracks: DrmTrack[] = []
  let audioTracks: DrmTrack[] = []
  let selectedSid = -1
  let selectedCcid = -1
  let lastProgressAt = 0
  let lastEndedAt = 0
  const blobUrls: string[] = []
  const SWITCH_ID = 10_000
  let liveSubs: DrmSubtitle[] = []
  let liveAudio: DrmAudioChoice[] = []
  let liveAudioLang = ''
  let livePreviewUrl = ''
  let activeManifest = ''
  let switching = false
  let booting = false
  let loadKey = ''
  let skipHardReload = false
  let loopA: number | null = null
  let loopB: number | null = null
  let subtitleScale = $state(1)
  let subtitleOverride = $state(false)
  let subtitleFont = $state('Nunito')
  let subtitleFontSize = $state(42)
  let subtitleColor = $state('#ffffffff')
  let subtitleBorderColor = $state('#000000ff')
  let subtitleBorderSize = $state(3)
  let subtitleShadow = $state(1)
  let subtitlePosition = $state(92)
  let activeReleaseUrl = ''
  const released = new Set<string>()
  const releaseJobs = new Map<string, Promise<void>>()
  let gifActive = false
  let gifSubtitlesHidden = false
  let abrWarmTimer: ReturnType<typeof setTimeout> | undefined
  let qualityMode: 'auto' | number = 'auto'
  let lastGoodDur = 0
  let lastGoodPos = 0

  // Parent player commands can race this component's engine registration during initial mount.
  // Read the same effective style directly as well, so a non-default preset is correct on frame 1.
  $effect(() => {
    const style = effectiveSubtitleStyle($sessionSubtitleStyle, {
      enabled: $subtitleStyleEnabled,
      font: $savedSubtitleFont,
      fontSize: $savedSubtitleFontSize,
      textColor: $subtitleTextColor,
      borderColor: $savedSubtitleBorderColor,
      borderSize: $savedSubtitleBorderSize,
      shadow: $savedSubtitleShadow,
      position: $savedSubtitlePosition,
    })
    subtitleOverride = style.enabled
    subtitleFont = style.font || 'Nunito'
    subtitleFontSize = Math.min(120, Math.max(8, style.fontSize))
    subtitleColor = mpvColorToCss(style.textColor)
    subtitleBorderColor = mpvColorToCss(style.borderColor, '#000000ff')
    subtitleBorderSize = Math.min(12, Math.max(0, style.borderSize))
    subtitleShadow = Math.min(12, Math.max(0, style.shadow))
    subtitlePosition = Math.min(100, Math.max(0, style.position))
  })

  function releasePlayback(target: string): Promise<void> {
    if (!target) return Promise.resolve()
    const pending = releaseJobs.get(target)
    if (pending) return pending
    if (released.has(target)) return Promise.resolve()
    released.add(target)
    const job = fetch(target, { method: 'DELETE', keepalive: true })
      .then(() => {})
      .catch(() => {})
      .finally(() => releaseJobs.delete(target))
    releaseJobs.set(target, job)
    return job
  }

  let bufferUiTimer: ReturnType<typeof setTimeout> | undefined
  function setBuffering(next: boolean) {
    const action = bufferSpinnerAction(buffering, !!bufferUiTimer, next)
    if (action === 'noop') return
    if (action === 'hide') {
      if (bufferUiTimer) {
        clearTimeout(bufferUiTimer)
        bufferUiTimer = undefined
      }
      buffering = false
      publish()
      return
    }
    bufferUiTimer = setTimeout(() => {
      bufferUiTimer = undefined
      buffering = true
      publish()
    }, BUFFER_SPINNER_DELAY_MS)
  }

  function seekRange() {
    try { return player?.seekRange?.() as { start: number; end: number } | undefined }
    catch { return undefined }
  }

  function snapshot(): DrmSnapshot {
    const video = videoEl
    const range = seekRange()
    const dur = holdPlaybackDuration(playbackDuration(video, range), lastGoodDur, switching)
    const pos = holdPlaybackDuration(video?.currentTime ?? 0, lastGoodPos, switching)
    return {
      pos,
      dur,
      buffer: video ? bufferedEnd(video) : 0,
      paused: video?.paused ?? true,
      buffering,
      ended,
      firstFrame,
      volume: video?.volume ?? 1,
      muted: video?.muted ?? false,
      error,
      videoWidth: video?.videoWidth ?? 0,
      videoHeight: video?.videoHeight ?? 0,
    }
  }

  function publish() {
    const snap = snapshot()
    if (snap.dur > 0) lastGoodDur = snap.dur
    if (snap.pos > 0) lastGoodPos = snap.pos
    onupdate(snap)
    const now = Date.now()
    if (snap.dur > 0 && now - lastProgressAt > 250) {
      lastProgressAt = now
      emitDrmProgress(snap.pos, snap.dur)
    }
    if (typeof window !== 'undefined') {
      const w = window as unknown as {
        __izumiDrm?: () => DrmSnapshot
        __izumiDrmTracks?: () => DrmTrack[]
      }
      w.__izumiDrm = snapshot
      w.__izumiDrmTracks = () => engine.tracks()
    }
  }

  type ShakaText = {
    id?: number
    active?: boolean
    language?: string
    originalLanguage?: string
    kind?: string | null
    label?: string | null
    forced?: boolean
  }
  type ShakaAudio = {
    active?: boolean
    language?: string
    originalLanguage?: string
    label?: string | null
    channelsCount?: number | null
    codecs?: string | null
  }

  function sameLang(a?: string, b?: string) {
    return langsEqual(a, b)
  }

  function applyText() {
    if (!player) return
    const id = selectedSid >= 0 ? selectedSid : selectedCcid
    try {
      if (id < 0) {
        player.selectTextTrack?.(null)
        return
      }
      const match = ((player.getTextTracks?.() ?? []) as ShakaText[])
        .find((t) => Number(t.id) === id)
      if (match) player.selectTextTrack(match)
    } catch { /* keep current */ }
  }

  function switchTracks(): DrmSubtitle[] {
    return liveSubs.filter((track) => track.switchUrl && track.kind !== 'captions')
  }

  function manifestQuery(name: string) {
    try { return new URL(activeManifest || url).searchParams.get(name) ?? '' }
    catch { return '' }
  }

  function withQuery(target: string, extra: Record<string, string | undefined>) {
    const next = new URL(target)
    for (const [key, value] of Object.entries(extra)) {
      if (value) next.searchParams.set(key, value)
      else next.searchParams.delete(key)
    }
    return next.toString()
  }

  function samePlaybackUrl(a: string, b: string) {
    try {
      const left = new URL(a)
      const right = new URL(b)
      return left.origin + left.pathname === right.origin + right.pathname
        && left.searchParams.get('hard') === right.searchParams.get('hard')
        && left.searchParams.get('audio') === right.searchParams.get('audio')
    } catch {
      return a === b
    }
  }

  async function reloadManifest(nextUrl: string) {
    if (!player || switching) return
    if (samePlaybackUrl(nextUrl, activeManifest || url)) return
    const video = videoEl
    if (!video) return
    switching = true
    const time = video.currentTime
    const paused = video.paused
    const previous = activeManifest || url
    buffering = true
    publish()
    try {
      await player.load(nextUrl, time)
      activeManifest = nextUrl
      if (nextUrl.includes('/v/') && nextUrl.includes('audio=')) await refreshSidecarSource()
      if (nextUrl.includes('hard=')) {
        selectedCcid = -1
        try { player.selectTextTrack?.(null) } catch { /* burned-in */ }
      } else {
        await attachSubtitles()
      }
      if (!paused) {
        try { await video.play() } catch { /* autoplay may wait */ }
      }
      syncAudioTracks()
      syncTextTracks()
      publish()
    } catch (err) {
      console.warn('[drm] reload failed, restoring', err)
      skipHardReload = nextUrl.includes('hard=')
      try {
        await player.unload?.()
        await player.load(previous, time)
        activeManifest = previous
        if (!paused) {
          try { await video.play() } catch { /* autoplay may wait */ }
        }
      } catch (restoreErr) {
        error = restoreErr instanceof Error ? restoreErr.message : String(restoreErr)
      }
      buffering = false
      publish()
    } finally {
      switching = false
    }
  }

  async function refreshSidecarSource() {
    const meta = drm.refreshUrl || url.replace(/\/manifest\.[^/?]+(?:\?.*)?$/, '/source')
    if (!meta.includes('/v/') || meta === url) return
    try {
      const res = await fetch(meta)
      if (!res.ok) return
      const src = await res.json() as {
        audioLang?: string
        subtitles?: DrmSubtitle[]
        audioTracks?: DrmAudioChoice[]
        previewUrl?: string
      }
      if (typeof src.audioLang === 'string') liveAudioLang = src.audioLang
      if (typeof src.previewUrl === 'string') {
        livePreviewUrl = src.previewUrl
        schedulePreviewWarm()
      }
      if (Array.isArray(src.subtitles)) {
        liveSubs = src.subtitles.map((track) => ({
          url: track.url,
          lang: track.lang ?? (track as { language?: string }).language,
          title: track.title,
          isDefault: track.isDefault,
          kind: track.kind,
          switchUrl: track.switchUrl,
        }))
      }
      if (Array.isArray(src.audioTracks)) {
        liveAudio = src.audioTracks.map((track) => ({
          lang: track.lang ?? (track as { language?: string }).language,
          title: track.title,
          switchUrl: track.switchUrl,
        }))
      }
    } catch { /* keep current lists */ }
  }

  function setSegmentPrefetch(limit: number) {
    if (!player) return
    try {
      player.configure('streaming.segmentPrefetchLimit', limit)
    } catch {
      try { player.configure({ streaming: { segmentPrefetchLimit: limit } }) } catch { /* keep going */ }
    }
  }

  function setAbrEnabled(enabled: boolean) {
    if (!player) return
    try { player.configure('abr.enabled', enabled) }
    catch { try { player.configure({ abr: { enabled } }) } catch { /* keep going */ } }
  }

  function setAbrMaxHeight(height: number) {
    if (!player) return
    try { player.configure('abr.restrictions.maxHeight', height) }
    catch {
      try { player.configure({ abr: { restrictions: { maxHeight: height } } }) } catch { /* keep going */ }
    }
  }

  function applyAbrPolicy() {
    if (!player || qualityMode !== 'auto') return
    setAbrEnabled(true)
    setAbrMaxHeight(abrMaxHeight(qualityMode, firstFrame))
  }

  type ShakaVariant = {
    id?: number
    height?: number
    bandwidth?: number
    active?: boolean
  }

  function variants(): ShakaVariant[] {
    return (player?.getVariantTracks?.() ?? []) as ShakaVariant[]
  }

  function qualityInfo() {
    const available = variants()
    const userQualities = new Set([1080, 720, 480])
    const heights = [...new Set(available.map((track) => Number(track.height) || 0).filter((height) => userQualities.has(height)))]
      .sort((a, b) => b - a)
    const activeHeight = Number(available.find((track) => track.active)?.height)
      || videoEl?.videoHeight
      || 0
    return { mode: qualityMode, activeHeight, heights }
  }

  function emitQualityInfo() {
    window.dispatchEvent(new CustomEvent('izumi-drm-quality', { detail: qualityInfo() }))
  }

  function selectManualQuality(height: number, clearBuffer: boolean) {
    if (!player) return
    const matching = variants().filter((track) => Number(track.height) === height)
    if (!matching.length) return
    const best = matching.reduce((current, next) =>
      (Number(next.bandwidth) || 0) > (Number(current.bandwidth) || 0) ? next : current,
    )
    setAbrEnabled(false)
    if (!best.active) {
      try { player.selectVariantTrack(best, clearBuffer) } catch { /* keep current */ }
    }
    emitQualityInfo()
  }

  function setQuality(mode: string) {
    if (mode === 'auto') {
      qualityMode = 'auto'
      applyAbrPolicy()
      emitQualityInfo()
      return
    }
    const height = Number(mode.replace(/p$/i, ''))
    if (!Number.isFinite(height) || height <= 0 || !qualityInfo().heights.includes(height)) return
    qualityMode = height
    selectManualQuality(height, true)
  }

  function selectFastVariant() {
    if (!player) return
    if (qualityMode !== 'auto') {
      selectManualQuality(qualityMode, false)
      return
    }
    applyAbrPolicy()
  }

  function warmAdaptiveQuality() {
    if (abrWarmTimer) clearTimeout(abrWarmTimer)
    abrWarmTimer = setTimeout(() => {
      abrWarmTimer = undefined
      if (!firstFrame) return
      if (qualityMode === 'auto') applyAbrPolicy()
      else selectManualQuality(qualityMode, false)
      emitQualityInfo()
    }, 400)
  }

  /** Pick the final manifest before Shaka loads. Burned-in subs are a separate MPD;
   * discovering them after the clean MPD caused a full second load and the visible
   * duration sequence 0 → duration → 0 → duration. */
  function preferredInitialManifest(): string {
    return preferredDrmPresentation({
      url,
      audioLang: liveAudioLang || audioLang,
      subtitles: liveSubs,
      audioTracks: liveAudio,
      preferredAudio: get(preferredAudioLang),
      preferredSub: get(preferredSubLang),
      switchAudio: false,
    }).url
  }

  function setSid(id: number) {
    if (id >= 0) selectedCcid = -1
    if (id < 0) {
      selectedSid = -1
      if (manifestQuery('hard')) {
        void reloadManifest(withQuery(activeManifest || url, { hard: undefined }))
        return
      }
      applyText()
      syncTextTracks()
      return
    }
    const hard = switchTracks()[id - SWITCH_ID]
    if (hard?.switchUrl) {
      selectedSid = id
      const audio = manifestQuery('audio')
      const next = withQuery(hard.switchUrl, { audio: audio || undefined })
      if (next !== activeManifest) void reloadManifest(next)
      syncTextTracks()
      return
    }
    if (manifestQuery('hard')) {
      selectedSid = id
      void reloadManifest(withQuery(activeManifest || url, { hard: undefined })).then(() => {
        applyText()
        syncTextTracks()
      })
      return
    }
    selectedSid = id
    applyText()
    syncTextTracks()
  }

  function setCcid(id: number) {
    selectedCcid = id
    if (id >= 0) selectedSid = -1
    applyText()
    syncTextTracks()
  }

  function cycleSid() {
    const ids = [-1, ...textTracks.filter((t) => t.type === 'sub').map((t) => t.id)]
    if (ids.length <= 1) return
    const at = ids.indexOf(selectedSid)
    setSid(ids[(at + 1) % ids.length] ?? -1)
  }

  function setAid(id: number) {
    const chosen = audioTracks.find((t) => t.id === id)
    if (!chosen || !player) return
    if (chosen.switchUrl) {
      const hard = manifestQuery('hard')
      void reloadManifest(withQuery(chosen.switchUrl, { hard: hard || undefined }))
      return
    }
    const audios = (player.getAudioTracks?.() ?? []) as ShakaAudio[]
    const fromList = audios.find((_, i) => i + 1 === id)
      ?? audios.find((t) => (t.originalLanguage || t.language) === chosen.lang)
    if (fromList) {
      try { player.selectAudioTrack(fromList) } catch { /* keep current */ }
    } else {
      const variants = player.getVariantTracks?.() ?? []
      const match = variants.find((v: { audioId?: number; id?: number }) =>
        (v.audioId ?? v.id) === id)
        ?? variants.find((v: { language?: string; audioLanguage?: string }) =>
          (v.audioLanguage || v.language) === chosen.lang)
      if (match) {
        try { player.selectVariantTrack(match, true) } catch { /* keep current */ }
      } else if (chosen.lang) {
        try { player.selectAudioLanguage(String(chosen.lang).split(/[-_]/)[0]) } catch { /* keep current */ }
      }
    }
    syncAudioTracks()
  }

  function syncAudioTracks() {
    if (!player) return
    if (liveAudio.length > 1) {
      const current = liveAudioLang || audioLang || manifestQuery('audio')
      audioTracks = liveAudio.map((track, i) => ({
        id: i + 1,
        type: 'audio',
        lang: track.lang,
        title: track.title,
        selected: sameLang(track.lang, current) || (!current && i === 0),
        switchUrl: track.switchUrl,
      }))
      if (audioTracks.length && !audioTracks.some((t) => t.selected)) audioTracks[0]!.selected = true
      return
    }
    const audios = (player.getAudioTracks?.() ?? []) as ShakaAudio[]
    if (audios.length) {
      audioTracks = audios.map((track, i) => ({
        id: i + 1,
        type: 'audio',
        lang: track.originalLanguage || track.language || audioLang || undefined,
        title: track.label || undefined,
        selected: !!track.active,
        channels: track.channelsCount ?? undefined,
        codec: track.codecs || undefined,
      }))
    } else {
      const variants = player.getVariantTracks?.() ?? []
      const seen = new Map<string, DrmTrack>()
      for (const variant of variants) {
        const lang = String(variant.audioLanguage || variant.language || audioLang || 'und')
        const id = Number(variant.audioId ?? variant.id ?? seen.size + 1)
        const prev = seen.get(lang)
        const selected = !!variant.active || !!prev?.selected
        if (!prev || variant.active) {
          seen.set(lang, {
            id,
            type: 'audio',
            lang,
            selected,
            channels: variant.channelsCount ?? undefined,
            codec: variant.audioCodec || variant.codecs || undefined,
          })
        }
      }
      if (!seen.size && audioLang) {
        seen.set(audioLang, { id: 1, type: 'audio', lang: audioLang, selected: true })
      }
      audioTracks = [...seen.values()]
    }
    if (audioTracks.length && !audioTracks.some((t) => t.selected)) audioTracks[0]!.selected = true
  }

  function syncTextTracks() {
    if (!player) return
    const list = (player.getTextTracks?.() ?? []) as ShakaText[]
    const shaka = list.map((track) => {
      const id = Number(track.id)
      const type = drmTextType(track.kind)
      return {
        id,
        type,
        lang: track.originalLanguage || track.language || undefined,
        title: track.label || undefined,
        selected: type === 'caption' ? selectedCcid === id : selectedSid === id,
        forced: !!track.forced,
      } satisfies DrmTrack
    })
    const hardLang = manifestQuery('hard')
    const extras = switchTracks().map((track, i) => {
      const id = SWITCH_ID + i
      return {
        id,
        type: 'sub' as const,
        lang: track.lang,
        title: track.title,
        selected: selectedSid === id || (!!hardLang && sameLang(track.lang, hardLang)),
        switchUrl: track.switchUrl,
      } satisfies DrmTrack
    })
    textTracks = [...shaka, ...extras]
  }

  function sniffText(url: string, body: string): { mime: string; vtt: string } {
    const ass = /\[script info\]/i.test(body) || /^dialogue:/im.test(body) || /\.ass(\?|$)/i.test(url) || /\.ssa(\?|$)/i.test(url)
    if (ass) return { mime: 'text/vtt', vtt: assToVtt(body) }
    if (/\.srt(\?|$)/i.test(url) || /^\d+\s*\r?\n\d{2}:\d{2}:\d{2}/.test(body)) {
      return { mime: 'text/srt', vtt: body }
    }
    return { mime: 'text/vtt', vtt: body }
  }

  async function attachSubtitles() {
    if (!player) return
    const soft = liveSubs.filter((track) => track.url && !track.switchUrl)
    if (soft.length) {
      await Promise.allSettled(soft.map(async (track) => {
        const kind = track.kind === 'captions' ? 'captions' : 'subtitles'
        try {
          const res = await fetch(track.url)
          const body = await res.text()
          const sniffed = sniffText(track.url, body)
          let uri = track.url
          if (sniffed.mime === 'text/vtt' && sniffed.vtt !== body) {
            const blob = URL.createObjectURL(new Blob([sniffed.vtt], { type: 'text/vtt' }))
            blobUrls.push(blob)
            uri = blob
          }
          await player.addTextTrackAsync(
            uri,
            track.lang || 'und',
            kind,
            sniffed.mime,
            '',
            track.title || track.lang || (kind === 'captions' ? 'CC' : 'Subtitle'),
          )
        } catch (err) {
          console.warn('[drm] subtitle skipped', track.url, err)
        }
      }))
    }
    syncTextTracks()
    applyPreferredSubtitles()
  }

  function applyPreferredSubtitles() {
    const audioPref = (liveAudioLang || audioLang || get(preferredAudioLang) || '').toLowerCase()
    const audioCode = audioPref.startsWith('en') ? 'eng' : 'jpn'
    const id = pickSubtitleTrackId(textTracks, audioCode, get(preferredSubLang))
    if (id === undefined) return
    if (typeof id === 'number' && id >= SWITCH_ID && !shouldAutoReloadHardsub({
      preferredId: id,
      switchIdMin: SWITCH_ID,
      skipHardReload,
      playbackStarted: firstFrame || lastGoodDur > 0,
    })) return
    if (id === 'no') {
      selectedSid = -1
      selectedCcid = -1
      if (manifestQuery('hard')) {
        void reloadManifest(withQuery(activeManifest || url, { hard: undefined }))
        return
      }
      applyText()
      syncTextTracks()
      return
    }
    setSid(id)
  }

  async function pngFromCapture(raw: unknown): Promise<Uint8Array | null> {
    if (typeof raw === 'string') return null
    if (raw instanceof Uint8Array) return raw
    if (raw instanceof ArrayBuffer) return new Uint8Array(raw)
    if (Array.isArray(raw)) return Uint8Array.from(raw)
    if (raw && typeof raw === 'object' && ArrayBuffer.isView(raw)) {
      const view = raw as ArrayBufferView
      return new Uint8Array(view.buffer, view.byteOffset, view.byteLength)
    }
    return null
  }

  async function cropSurfaceToVideo(
    bytes: Uint8Array,
    mime: string,
    video: HTMLVideoElement,
    outMime: 'image/png' | 'image/jpeg',
    maxWidth = Infinity,
  ): Promise<Uint8Array> {
    const bitmap = await createImageBitmap(new Blob([bytes as BlobPart], { type: mime }))
    const fit = getComputedStyle(video).objectFit || 'contain'
    const box = videoShotRect(video, fit)
    const mapped = mapScreenshotCrop(bitmap.width, bitmap.height, window.innerWidth, window.innerHeight, box)
    const sw = Math.max(1, Math.round(mapped.sw))
    const sh = Math.max(1, Math.round(mapped.sh))
    const scale = Number.isFinite(maxWidth) ? Math.min(1, maxWidth / sw) : 1
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(sw * scale))
    canvas.height = Math.max(1, Math.round(sh * scale))
    const ctx = canvas.getContext('2d')
    if (!ctx) {
      bitmap.close()
      return bytes
    }
    ctx.drawImage(bitmap, mapped.sx, mapped.sy, mapped.sw, mapped.sh, 0, 0, canvas.width, canvas.height)
    bitmap.close()
    const sample = ctx.getImageData(0, 0, canvas.width, canvas.height)
    if (isSolidBlackImageData(sample.data)) throw new Error('black screenshot')
    const out = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, outMime, 0.84))
    if (!out || out.size < 16) return bytes
    return new Uint8Array(await out.arrayBuffer())
  }

  /** WebKitGTK/WKWebView do not expose Chromium's compositor screenshot API. Use the decoded
   * video frame there; this also keeps the implementation usable in any future non-CDP webview.
   * Encrypted Widevine frames are uniform black here — callers must reject that. */
  async function canvasVideoFrame(
    video: HTMLVideoElement,
    mime: 'image/png' | 'image/jpeg',
    maxWidth = video.videoWidth,
  ): Promise<Uint8Array> {
    if (!video.videoWidth || !video.videoHeight) throw new Error('video frame unavailable')
    const scale = Math.min(1, Math.max(1, maxWidth) / video.videoWidth)
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(video.videoWidth * scale))
    canvas.height = Math.max(1, Math.round(video.videoHeight * scale))
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('2D frame capture is unavailable')
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
    if (isSolidBlackImageData(ctx.getImageData(0, 0, canvas.width, canvas.height).data)) {
      throw new Error('black screenshot')
    }
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, mime, 0.84))
    if (!blob || blob.size < 16) throw new Error('empty video frame')
    return new Uint8Array(await blob.arrayBuffer())
  }

  async function compositorBytes(quality: number): Promise<{ bytes: Uint8Array; mime: string } | null> {
    try {
      const jpeg = await pngFromCapture(await invoke<unknown>('capture_webview_jpeg', { quality }))
      if (jpeg) return { bytes: jpeg, mime: 'image/jpeg' }
    } catch (captureError) {
      console.warn('[drm] compositor jpeg failed', captureError)
    }
    try {
      const png = await pngFromCapture(await invoke<unknown>('capture_webview_png'))
      if (png) return { bytes: png, mime: 'image/png' }
    } catch (captureError) {
      console.warn('[drm] compositor png failed', captureError)
    }
    return null
  }

  async function captureCropped(
    video: HTMLVideoElement,
    outMime: 'image/png' | 'image/jpeg',
    maxWidth: number,
  ): Promise<Uint8Array | null> {
    const raw = await compositorBytes(outMime === 'image/jpeg' ? 90 : 92)
    if (raw) {
      try {
        return await cropSurfaceToVideo(raw.bytes, raw.mime, video, outMime, maxWidth)
      } catch (error) {
        console.warn('[drm] compositor crop failed', error)
      }
    }
    try {
      return await canvasVideoFrame(video, outMime, maxWidth)
    } catch {
      return null
    }
  }

  async function nextPaint(): Promise<void> {
    if (typeof requestAnimationFrame !== 'function') {
      await new Promise((resolve) => setTimeout(resolve, 32))
      return
    }
    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
    })
  }

  async function concealCaptureChrome(): Promise<void> {
    document.documentElement.classList.add(PLAYER_CAPTURE_CLASS)
    await nextPaint()
  }

  async function restoreCaptureChrome(): Promise<void> {
    document.documentElement.classList.remove(PLAYER_CAPTURE_CLASS)
  }

  let gifBoot: Promise<void> | null = null

  async function screenshot() {
    const video = videoEl
    if (!video) throw new Error('no video')
    const overlay = (selectedSid >= 0 || selectedCcid >= 0) ? textEl : null
    try {
      const png = await encodeVideoFrame(video, 'image/png', video.videoWidth, overlay)
      await invoke('save_player_png', { png })
      return
    } catch (error) {
      console.warn('[drm] decoded screenshot unavailable; using compositor', error)
    }
    const png = await withPlayerChromeHidden(
      () => captureCropped(video, 'image/png', video.videoWidth),
    )
    if (!png) throw new Error('empty screenshot')
    await invoke('save_player_png', { png })
  }

  function finishGifUi() {
    void restoreCaptureChrome()
    if (gifSubtitlesHidden) {
      try { player?.setTextTrackVisibility?.(selectedSid >= 0 || selectedCcid >= 0) } catch { /* keep going */ }
    }
    gifSubtitlesHidden = false
  }

  function gifVideoCrop(video: HTMLVideoElement) {
    const fit = getComputedStyle(video).objectFit || 'contain'
    const box = videoShotRect(video, fit)
    return {
      viewWidth: window.innerWidth,
      viewHeight: window.innerHeight,
      cropX: box.x,
      cropY: box.y,
      cropW: box.width,
      cropH: box.height,
    }
  }

  async function gifStart(includeSubtitles: boolean) {
    if (gifActive || gifBoot) throw new Error('GIF is already recording')
    if (!videoEl || !firstFrame || videoEl.videoWidth <= 0) throw new Error('Video is not ready for GIF capture')
    const plan = gifCapturePlan(get(gifScale), get(gifMaxSeconds))
    const boot = (async () => {
      if (!includeSubtitles && (selectedSid >= 0 || selectedCcid >= 0)) {
        try {
          player?.setTextTrackVisibility?.(false)
          gifSubtitlesHidden = true
        } catch { /* burned-in subtitles cannot be hidden */ }
      }
      await concealCaptureChrome()
      const video = videoEl
      if (!video) throw new Error('Video is not ready for GIF capture')
      await invoke('drm_gif_start', {
        width: plan.width,
        maxFrames: plan.maxFrames,
        fps: plan.fps,
        maxSeconds: plan.maxSeconds,
        ...gifVideoCrop(video),
      })
      gifActive = true
    })()
    gifBoot = boot
    try {
      await boot
    } finally {
      if (gifBoot === boot) gifBoot = null
    }
  }

  async function gifStop() {
    if (gifBoot) await gifBoot.catch(() => {})
    if (!gifActive) throw new Error('GIF is not recording')
    gifActive = false
    try {
      await invoke('drm_gif_stop')
    } finally {
      finishGifUi()
    }
  }

  async function gifAbort() {
    if (gifBoot) await gifBoot.catch(() => {})
    const wasActive = gifActive
    gifActive = false
    finishGifUi()
    if (wasActive) await invoke('drm_gif_abort').catch(() => {})
  }

  const thumbCache = new Map<number, string>()
  const bifCache = new Map<number, string>()
  const BIF_CACHE_MAX = 48
  let bifBytes: Uint8Array | null = null
  let bifIndex: { time: number; start: number; end: number }[] = []
  let loadedPreview = ''
  let previewTried = ''
  let previewGen = 0
  let previewJob: Promise<void> | undefined
  let previewWarmTimer: ReturnType<typeof setTimeout> | undefined

  function schedulePreviewWarm() {
    if (!livePreviewUrl || loadedPreview === livePreviewUrl || previewJob || previewWarmTimer) return
    previewWarmTimer = setTimeout(() => {
      previewWarmTimer = undefined
      void loadPreview()
    }, 1_500)
  }

  function seekSubtitleLine(direction: number) {
    const video = videoEl
    if (!video) return
    const times: number[] = []
    for (const track of Array.from(video.textTracks ?? [])) {
      if (track.mode === 'disabled' || !track.cues) continue
      for (const cue of Array.from(track.cues)) times.push(cue.startTime)
    }
    times.sort((a, b) => a - b)
    const current = video.currentTime
    const target = direction > 0
      ? times.find((time) => time > current + 0.05)
      : direction < 0
        ? [...times].reverse().find((time) => time < current - 0.05)
        : [...times].reverse().find((time) => time <= current + 0.05)
    if (target == null) return
    video.currentTime = clampSeekTime(target, playbackDuration(video, seekRange()), seekRange())
    publish()
  }

  async function loadPreview() {
    const src = livePreviewUrl
    if (!src) {
      bifBytes = null
      bifIndex = []
      loadedPreview = ''
      previewTried = ''
      return
    }
    if (loadedPreview === src && bifBytes) return
    if (previewTried === src && !previewJob) return
    if (previewJob) return previewJob
    const gen = ++previewGen
    previewTried = src
    previewJob = (async () => {
      try {
        const res = await fetch(src)
        if (!res.ok || gen !== previewGen) return
        const buf = new Uint8Array(await res.arrayBuffer())
        if (gen !== previewGen) return
        const parsed = parseBif(buf)
        if (!parsed.length) {
          console.warn('[drm] preview not a BIF', buf.length)
          return
        }
        bifBytes = buf
        bifIndex = parsed
        loadedPreview = src
      } catch (err) {
        console.warn('[drm] preview skipped', err)
      }
    })()
    try {
      await previewJob
    } finally {
      if (gen === previewGen) previewJob = undefined
    }
  }

  function bifUrlAt(time: number): string | null {
    if (!bifBytes || !bifIndex.length) return null
    const frame = nearestBifFrame(bifIndex, time)
    if (!frame) return null
    const key = frame.start
    const cached = bifCache.get(key)
    if (cached) return cached
    const slice = bifBytes.slice(frame.start, frame.end)
    const url = URL.createObjectURL(new Blob([slice], { type: 'image/jpeg' }))
    blobUrls.push(url)
    if (bifCache.size >= BIF_CACHE_MAX) {
      const oldest = bifCache.keys().next().value
      if (oldest != null) {
        const stale = bifCache.get(oldest)
        if (stale) URL.revokeObjectURL(stale)
        bifCache.delete(oldest)
      }
    }
    bifCache.set(key, url)
    return url
  }

  async function cropSpriteTile(
    url: string,
    x: number,
    y: number,
    width: number,
    height: number,
  ): Promise<string | null> {
    try {
      const res = await fetch(url)
      if (!res.ok) return url
      const blob = await res.blob()
      const bitmap = await createImageBitmap(blob)
      const w = Math.max(1, Math.round(width) || bitmap.width)
      const h = Math.max(1, Math.round(height) || bitmap.height)
      const canvas = document.createElement('canvas')
      canvas.width = w
      canvas.height = h
      const ctx = canvas.getContext('2d')
      if (!ctx) {
        bitmap.close()
        return URL.createObjectURL(blob)
      }
      ctx.drawImage(bitmap, x, y, w, h, 0, 0, w, h)
      bitmap.close()
      const out = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.82))
      if (!out) return URL.createObjectURL(blob)
      const cropped = URL.createObjectURL(out)
      blobUrls.push(cropped)
      return cropped
    } catch {
      return url
    }
  }

  async function thumbnail(time: number): Promise<string | null> {
    if (!bifIndex.length && livePreviewUrl && (previewTried !== livePreviewUrl || previewJob)) await loadPreview()
    const fromBif = bifUrlAt(time)
    if (fromBif) return fromBif
    if (!player) return null
    const index = Math.max(0, Math.round(time / 2))
    const hit = thumbCache.get(index)
    if (hit) return hit
    try {
      const tracks = (player.getImageTracks?.() ?? []) as Array<{ id?: number }>
      if (!tracks.length) return null
      const track = tracks[0]
      const raw = await player.getThumbnails?.(track.id ?? track, time)
      const thumb = Array.isArray(raw) ? raw[0] : raw
      if (!thumb) return null
      const uri = String(thumb.uris?.[0] ?? thumb.imageUrl ?? thumb.uri ?? '')
      if (!uri) return null
      const x = Number(thumb.positionX ?? thumb.x ?? 0)
      const y = Number(thumb.positionY ?? thumb.y ?? 0)
      const w = Number(thumb.width ?? 0)
      const h = Number(thumb.height ?? 0)
      const url = (w > 0 && h > 0)
        ? await cropSpriteTile(uri, x, y, w, h)
        : uri
      if (url) thumbCache.set(index, url)
      return url
    } catch {
      return null
    }
  }

  const engine: DrmEngine = {
    command(name, args) {
      const video = videoEl
      if (!video) return
      if (name === 'cycle' && args[0] === 'sid') { cycleSid(); return }
      if (name === 'set' && args[0] === 'sid') {
        setSid(args[1] === 'no' ? -1 : Number(args[1]))
        return
      }
      if (name === 'set' && args[0] === 'ccid') {
        setCcid(args[1] === 'no' ? -1 : Number(args[1]))
        return
      }
      if (name === 'set' && args[0] === 'aid') {
        if (args[1] !== 'no') setAid(Number(args[1]))
        return
      }
      if (name === 'set' && args[0] === 'video-quality') {
        setQuality(args[1] ?? 'auto')
        return
      }
      if (name === 'sub-seek') {
        seekSubtitleLine(Number(args[0] ?? 0))
        return
      }
      if (name === 'set' && (args[0] === 'ab-loop-a' || args[0] === 'ab-loop-b')) {
        const value = args[1] === 'no' ? null : Number(args[1])
        const next = value != null && Number.isFinite(value) ? value : null
        if (args[0] === 'ab-loop-a') loopA = next
        else loopB = next
        return
      }
      if ((name === 'set' || name === 'add') && args[0] === 'sub-scale') {
        const value = Number(args[1])
        if (Number.isFinite(value)) {
          subtitleScale = name === 'set'
            ? Math.min(3, Math.max(0.25, value))
            : Math.min(3, Math.max(0.25, subtitleScale + value))
        }
        publish()
        return
      }
      if (name === 'set' && args[0] === 'sub-ass-override') {
        subtitleOverride = args[1] === 'force' || args[1] === 'yes'
        return
      }
      if (name === 'set' && args[0] === 'sub-font') { subtitleFont = args[1] || 'Nunito'; return }
      if (name === 'set' && args[0] === 'sub-font-size') {
        const value = Number(args[1]); if (Number.isFinite(value)) subtitleFontSize = Math.min(120, Math.max(8, value))
        return
      }
      if (name === 'set' && args[0] === 'sub-color') { subtitleColor = mpvColorToCss(args[1] || ''); return }
      if (name === 'set' && args[0] === 'sub-border-color') { subtitleBorderColor = mpvColorToCss(args[1] || '', '#000000ff'); return }
      if (name === 'set' && args[0] === 'sub-border-size') {
        const value = Number(args[1]); if (Number.isFinite(value)) subtitleBorderSize = Math.min(12, Math.max(0, value))
        return
      }
      if (name === 'set' && args[0] === 'sub-shadow-offset') {
        const value = Number(args[1]); if (Number.isFinite(value)) subtitleShadow = Math.min(12, Math.max(0, value))
        return
      }
      if (name === 'set' && args[0] === 'sub-pos') {
        const value = Number(args[1]); if (Number.isFinite(value)) subtitlePosition = Math.min(100, Math.max(0, value))
        return
      }
      if (name === 'seek') {
        const amount = Number(args[0])
        if (!Number.isFinite(amount)) return
        const mode = args[1] ?? 'relative'
        const range = seekRange()
        const next = mode.startsWith('absolute') ? amount : video.currentTime + amount
        video.currentTime = clampSeekTime(next, playbackDuration(video, range), range)
        publish()
        return
      }
      applyPlayerCommand(video, name, args)
      publish()
    },
    getProperty(name) {
      if (name === 'sid') return selectedSid < 0 ? 'no' : String(selectedSid)
      if (name === 'ccid') return selectedCcid < 0 ? 'no' : String(selectedCcid)
      if (name === 'sub-scale') return String(subtitleScale)
      if (name === 'video-quality-options') return JSON.stringify(qualityInfo())
      if (!videoEl) return ''
      return playerProperty(videoEl, name)
    },
    tracks() {
      syncAudioTracks()
      syncTextTracks()
      return [...audioTracks, ...textTracks]
    },
    screenshot,
    gifStart,
    gifStop,
    gifAbort,
    thumbnail,
    destroy() {
      void teardown()
    },
  }

  async function teardown(clearEngine = true) {
    if (gifActive) await gifAbort()
    const current = player
    player = null
    if (clearEngine && getDrmRef() === engine) setDrmEngine(null)
    if (bufferUiTimer) {
      clearTimeout(bufferUiTimer)
      bufferUiTimer = undefined
    }
    while (blobUrls.length) {
      const u = blobUrls.pop()
      if (u) URL.revokeObjectURL(u)
    }
    bifCache.clear()
    bifBytes = null
    bifIndex = []
    loadedPreview = ''
    previewTried = ''
    previewJob = undefined
    if (previewWarmTimer) {
      clearTimeout(previewWarmTimer)
      previewWarmTimer = undefined
    }
    if (abrWarmTimer) {
      clearTimeout(abrWarmTimer)
      abrWarmTimer = undefined
    }
    if (current) {
      try { await current.unload() } catch { /* already torn down */ }
      try { await current.destroy() } catch { /* already torn down */ }
    }
  }

  function getDrmRef() {
    return engine
  }

  async function load() {
    const key = `${url}|${drm.licenseUrl}|${startSeconds}`
    if (loadKey === key) return
    loadKey = key
    const gen = ++loadGen
    firstFrame = false
    buffering = true
    ended = false
    error = null
    textTracks = []
    audioTracks = []
    selectedSid = -1
    selectedCcid = -1
    loopA = null
    loopB = null
    subtitleScale = 1
    liveSubs = subtitles
    liveAudio = audioChoices
    liveAudioLang = audioLang
    livePreviewUrl = previewUrl
    activeManifest = url
    switching = false
    booting = true
    skipHardReload = false
    lastGoodDur = 0
    lastGoodPos = 0
    previewTried = ''
    previewJob = undefined
    publish()
    setDrmEngine(engine)
    await teardown(false)
    if (activeReleaseUrl && activeReleaseUrl !== (drm.releaseUrl ?? '')) {
      await releasePlayback(activeReleaseUrl)
    }
    activeReleaseUrl = drm.releaseUrl ?? ''
    if (gen !== loadGen) return
    const video = videoEl
    if (!video || !url || (!drm.licenseUrl && !url.startsWith('offline:'))) return
    setDrmEngine(engine)
    try {
      // Catalog refresh mints the scarce play token on providers that defer it.
      // Wait briefly so the first Shaka load is already the preferred presentation.
      const sidecar = refreshSidecarSource()
      const mod = await import('shaka-player')
      if (gen !== loadGen) return
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const raw: any = mod
      const shaka = raw.Player ? raw : raw.default
      shaka.polyfill?.installAll?.()
      if (!shaka.Player?.isBrowserSupported?.()) {
        throw new Error('This device cannot play encrypted video (no EME / Widevine).')
      }
      player = new shaka.Player()
      await player.attach(video)
      if (textEl && typeof player.setVideoContainer === 'function') {
        try { player.setVideoContainer(textEl) } catch { /* native cues still work */ }
      }
      if (gen !== loadGen) return
      const videoRobustness = drm.videoRobustness ? [drm.videoRobustness] : ['SW_SECURE_CRYPTO']
      const audioRobustness = drm.audioRobustness ? [drm.audioRobustness] : videoRobustness
      player.configure({
        abr: { ...AUTO_ABR },
        manifest: {
          retryParameters: { timeout: 30_000, maxAttempts: 2, baseDelay: 250, backoffFactor: 2, fuzzFactor: 0.5 },
        },
        streaming: {
          bufferingGoal: 30,
          rebufferingGoal: 0.35,
          bufferBehind: 20,
          // Give the first required audio/video pair the whole connection. The
          // playing/seeked handlers restore normal read-ahead immediately after
          // a frame is available.
          segmentPrefetchLimit: 0,
          retryParameters: { timeout: 30_000, maxAttempts: 4, baseDelay: 250, backoffFactor: 2, fuzzFactor: 0.5 },
        },
        drm: {
          servers: drm.licenseUrl ? { [drm.keySystem]: drm.licenseUrl } : {},
          advanced: {
            [drm.keySystem]: {
              videoRobustness,
              audioRobustness,
              persistentStateRequired: false,
              distinctiveIdentifierRequired: false,
            },
          },
        },
      })
      applyAbrPolicy()
      if (drm.serverCertificateUrl) {
        const cert = await fetch(drm.serverCertificateUrl).then((r) => r.arrayBuffer())
        if (gen !== loadGen) return
        player.configure(
          `drm.advanced.${drm.keySystem}.serverCertificate`,
          new Uint8Array(cert),
        )
      }
      const net = player.getNetworkingEngine?.()
      net?.registerRequestFilter((type: number, request: { headers: Record<string, string> }) => {
        const LICENSE = shaka.net?.NetworkingEngine?.RequestType?.LICENSE
        if (LICENSE != null && type === LICENSE && drm.licenseHeaders) {
          Object.assign(request.headers, drm.licenseHeaders)
        }
      })
      player.addEventListener('error', (event: { detail?: { code?: number; message?: string; data?: unknown[] } }) => {
        if (switching || booting) return
        const detail = event.detail
        const extra = Array.isArray(detail?.data) ? detail.data.map(String).join(' ') : ''
        error = detail?.message
          || (detail?.code != null ? `Shaka Error ${detail.code}${extra ? `: ${extra}` : ''}` : 'Encrypted playback failed')
        buffering = false
        console.warn('[drm]', detail)
        publish()
      })
      player.addEventListener('buffering', (event: { buffering?: boolean }) => {
        setBuffering(!!event.buffering)
      })
      player.addEventListener('trackschanged', () => {
        syncAudioTracks()
        syncTextTracks()
        emitQualityInfo()
      })
      player.addEventListener('adaptation', emitQualityInfo)
      player.addEventListener('textchanged', () => syncTextTracks())
      // Overlay spinner is already showing. Waiting here lets preferredInitialManifest
      // pick a burned-in MPD before the first load, so the clock does not go
      // 0 → duration → 0 when sidecar/hardsub catalog arrives a moment later.
      await waitForCatalog(sidecar, DRM_CATALOG_WAIT_MS)
      if (gen !== loadGen) return
      const initialManifest = preferredInitialManifest()
      try {
        await player.load(initialManifest, startSeconds || undefined)
        activeManifest = initialManifest
      } catch (loadErr) {
        let hard = ''
        try { hard = new URL(initialManifest).searchParams.get('hard') ?? '' } catch { /* keep */ }
        if (!hard) throw loadErr
        console.warn('[drm] hardsub manifest failed, loading clean', loadErr)
        skipHardReload = true
        try { await player.unload() } catch { /* continue */ }
        const fallback = withQuery(initialManifest, { hard: undefined })
        await player.load(fallback, startSeconds || undefined)
        activeManifest = fallback
        error = null
      }
      booting = false
      if (gen !== loadGen) return
      try { await video.play() } catch { /* autoplay may wait for a gesture */ }
      warmAdaptiveQuality()
      publish()
      void sidecar.then(() => {
        if (gen !== loadGen) return
        syncAudioTracks()
        void attachSubtitles()
      })
    } catch (err) {
      booting = false
      if (gen !== loadGen) return
      error = err instanceof Error ? err.message : String(err)
      buffering = false
      console.warn('[drm] load failed', err)
      publish()
    }
  }

  $effect(() => {
    const el = videoEl
    void url
    void drm.licenseUrl
    if (el) untrack(() => { void load() })
  })

  onDestroy(() => {
    loadGen++
    setDrmEngine(null)
    void releasePlayback(activeReleaseUrl)
    void teardown()
  })
</script>

<div class="izumi-capture-root pointer-events-none absolute inset-0">
<video
  bind:this={videoEl}
  class="pointer-events-none absolute inset-0 h-full w-full bg-black outline-none"
  style:object-fit={$videoFit === 'fill' ? 'cover' : 'contain'}
  style:filter="opacity(0.999)"
  style:transform="translateZ(0)"
  style:clip-path="inset(0.5px)"
  autoplay
  playsinline
  disablepictureinpicture
  onplaying={() => {
    setSegmentPrefetch(4)
    firstFrame = true
    setBuffering(false)
    ended = false
    publish()
    schedulePreviewWarm()
    applyPreferredSubtitles()
    // Source replacement reuses this <video>; a late `playing` event from the
    // old buffer can arrive while the new Shaka load is booting. Do not let it
    // enable ABR and discard the new low-rung startup segment.
    if (!booting) warmAdaptiveQuality()
  }}
  onloadeddata={() => {
    if ((videoEl?.videoWidth ?? 0) > 0) firstFrame = true
    publish()
  }}
  onloadedmetadata={() => publish()}
  onpause={() => publish()}
  onplay={() => publish()}
  onwaiting={() => setBuffering(true)}
  onseeking={() => {
    setSegmentPrefetch(0)
    if (shouldPinFastStart(qualityMode, firstFrame)) selectFastVariant()
    setBuffering(true)
  }}
  onseeked={() => {
    setSegmentPrefetch(4)
    if (qualityMode === 'auto') applyAbrPolicy()
    publish()
  }}
  ontimeupdate={() => {
    if (loopA != null && loopB != null && loopB > loopA && (videoEl?.currentTime ?? 0) >= loopB) {
      if (videoEl) videoEl.currentTime = loopA
    }
    publish()
  }}
  onended={() => {
    ended = true
    buffering = false
    publish()
    const now = Date.now()
    if (now - lastEndedAt > 1000) {
      lastEndedAt = now
      emitDrmEnded()
    }
  }}
  onencrypted={() => publish()}
></video>
<div
  bind:this={textEl}
  class="drm-text pointer-events-none absolute inset-0 overflow-hidden text-center leading-snug"
  class:drm-text-override={subtitleOverride}
  style:font-family={subtitleOverride ? subtitleFont : undefined}
  style:font-size={subtitleOverride ? `${subtitleFontSize / 13.125 * subtitleScale}vmin` : `${3.2 * subtitleScale}vmin`}
  style:color={subtitleOverride ? subtitleColor : undefined}
  style:padding-bottom={subtitleOverride ? `${100 - subtitlePosition}%` : undefined}
  style:--drm-sub-border={subtitleOverride ? `${subtitleBorderSize / 2}px ${subtitleBorderColor}` : undefined}
  style:--drm-sub-shadow={subtitleOverride ? `${subtitleShadow}px ${subtitleShadow}px ${Math.max(1, subtitleShadow * 2)}px #000000cc` : undefined}
></div>
</div>

<style>
  .drm-text:not(.drm-text-override) { color: white; text-shadow: 0 1px 2px #000, 0 0 6px #000; }
  .drm-text-override :global(*) {
    font-family: inherit !important;
    font-size: inherit !important;
    color: inherit !important;
    -webkit-text-stroke: var(--drm-sub-border) !important;
    paint-order: stroke fill;
    text-shadow: var(--drm-sub-shadow) !important;
  }
</style>
