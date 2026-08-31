import type { CastLoadRequest, PlaybackState, PlaybackTrack } from '../types'

export interface AvPlayEvents {
  onBuffering(percent?: number): void
  onState(state: PlaybackState): void
  onTime(positionSeconds: number, durationSeconds: number): void
  onTracks(tracks: PlaybackTrack[]): void
  onSubtitle(text: string, durationMs: number): void
  onLive?(live: boolean): void
  onComplete(): void
  onError(message: string): void
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  if (error && typeof error === 'object' && 'message' in error) return String(error.message)
  return String(error || 'Unknown AVPlay error')
}

function adaptiveValue(request: CastLoadRequest): string {
  const options: string[] = []
  const start = request.adaptive?.startBitrate ?? 'AVERAGE'
  options.push(`STARTBITRATE=${typeof start === 'number' ? Math.round(start) : start}`)
  if (request.adaptive?.minBitrateKbps) options.push(`BITRATES=${Math.round(request.adaptive.minBitrateKbps)}~${Math.round(request.adaptive.maxBitrateKbps || 0) || ''}`)
  else if (request.adaptive?.maxBitrateKbps) options.push(`BITRATES=~${Math.round(request.adaptive.maxBitrateKbps)}`)
  return options.join('|')
}

export class AvPlayController {
  private active?: CastLoadRequest
  private events?: AvPlayEvents
  private generation = 0
  private retryCount = 0
  private recovering = false
  private bufferingTimer?: number
  private suspendedPosition = 0
  private resumeAfterRestore = false

  get available(): boolean {
    return Boolean(window.webapis?.avplay)
  }

  get request(): CastLoadRequest | undefined {
    return this.active
  }

  async load(request: CastLoadRequest, events: AvPlayEvents): Promise<void> {
    this.close()
    this.active = request
    this.events = events
    this.retryCount = 0
    this.recovering = false
    const generation = ++this.generation
    events.onState('buffering')
    try {
      await this.openAndPlay(request.positionSeconds, generation)
    } catch (error) {
      if (this.recovering) return
      if (this.retryCount >= 1 || !this.active) throw error
      this.retryCount += 1
      events.onBuffering()
      try { window.webapis?.avplay?.close() } catch { /* Prepare may already have closed the player. */ }
      const retryGeneration = ++this.generation
      await new Promise((resolve) => window.setTimeout(resolve, 350))
      await this.openAndPlay(request.positionSeconds, retryGeneration)
    }
  }

  private async openAndPlay(positionSeconds: number, generation: number): Promise<void> {
    const player = window.webapis?.avplay
    const request = this.active
    const events = this.events
    if (!player || !request || !events) throw new Error('Samsung AVPlay is unavailable outside a Samsung TV runtime.')

    try {
      player.open(request.url)
      player.setListener({
        onbufferingstart: () => {
          if (generation !== this.generation) return
          events.onState('buffering')
          events.onBuffering()
          this.armBufferingTimeout(generation)
        },
        onbufferingprogress: (percent) => {
          if (generation !== this.generation) return
          events.onBuffering(percent)
          this.armBufferingTimeout(generation)
        },
        onbufferingcomplete: () => this.clearBufferingTimeout(),
        oncurrentplaytime: (milliseconds) => {
          if (generation !== this.generation) return
          events.onTime(milliseconds / 1000, Math.max(0, player.getDuration() / 1000))
        },
        onstreamcompleted: () => generation === this.generation && events.onComplete(),
        onsubtitlechange: (duration, text) => generation === this.generation && events.onSubtitle(text, duration),
        onerror: (error) => this.handleRuntimeError(errorMessage(error), generation),
        onerrormsg: (code, message) => this.handleRuntimeError(message || errorMessage(code), generation),
      })
      player.setDisplayRect(0, 0, 1920, 1080)
      player.setDisplayMethod?.('PLAYER_DISPLAY_MODE_LETTER_BOX')
      this.configureIdlePlayer(player, request)
      await new Promise<void>((resolve, reject) => player.prepareAsync(resolve, reject))
      if (generation !== this.generation) return
      this.clearBufferingTimeout()
      events.onTracks(this.tracks())
      let live = false
      try { live = player.getStreamingProperty?.('IS_LIVE') === 'true' } catch { /* Older firmware can omit this property. */ }
      events.onLive?.(live)
      if (!live && positionSeconds > 0) await this.seek(positionSeconds)
      if (generation !== this.generation) return
      player.play()
      this.recovering = false
      events.onState('playing')
    } catch (error) {
      if (generation !== this.generation) return
      throw new Error(errorMessage(error))
    }
  }

  private configureIdlePlayer(player: SamsungAvPlay, request: CastLoadRequest): void {
    try { player.setBufferingParam?.('PLAYER_BUFFER_FOR_PLAY', 'PLAYER_BUFFER_SIZE_IN_SECOND', 5) } catch { /* Firmware-specific. */ }
    try { player.setBufferingParam?.('PLAYER_BUFFER_FOR_RESUME', 'PLAYER_BUFFER_SIZE_IN_SECOND', 3) } catch { /* Firmware-specific. */ }
    try { player.setBufferingParam?.('PLAYER_BUFFER_SIZE', 'PLAYER_BUFFER_SIZE_IN_SECOND', 20) } catch { /* Firmware-specific. */ }
    if (/\.m3u8(?:$|\?)|\.mpd(?:$|\?)/i.test(request.url) || /mpegurl|dash/i.test(request.contentType || '') || request.adaptive) {
      try { player.setStreamingProperty?.('ADAPTIVE_INFO', adaptiveValue(request)) } catch { /* Fixed-quality streams ignore this. */ }
    }
    if (request.cookies) try { player.setStreamingProperty?.('COOKIE', request.cookies) } catch { /* Optional. */ }
    if (request.userAgent) try { player.setStreamingProperty?.('USER_AGENT', request.userAgent) } catch { /* Optional. */ }
    if (request.drm && player.setDrm) {
      const properties = {
        LicenseServer: request.drm.licenseServer,
        HttpHeader: request.drm.headers ? Object.entries(request.drm.headers).map(([key, value]) => `${key}: ${value}`).join('\r\n') : undefined,
        CustomData: request.drm.customData,
        DeleteLicenseAfterUse: request.drm.deleteLicenseAfterUse,
      }
      const system = request.drm.system === 'widevine' ? 'WIDEVINE_CDM' : 'PLAYREADY'
      player.setDrm(system, 'SetProperties', JSON.stringify(properties))
    }
  }

  private armBufferingTimeout(generation: number): void {
    this.clearBufferingTimeout()
    this.bufferingTimer = window.setTimeout(() => this.handleRuntimeError('Playback stopped responding while buffering.', generation), 20_000)
  }

  private clearBufferingTimeout(): void {
    if (this.bufferingTimer) window.clearTimeout(this.bufferingTimer)
    this.bufferingTimer = undefined
  }

  private handleRuntimeError(message: string, generation: number): void {
    if (generation !== this.generation || this.recovering) return
    if (this.retryCount >= 1 || !this.active || !this.events) {
      this.clearBufferingTimeout()
      this.events?.onError(message)
      return
    }
    this.retryCount += 1
    this.recovering = true
    const resumeAt = this.currentTime() || this.active.positionSeconds
    this.events.onState('buffering')
    this.events.onBuffering()
    try { window.webapis?.avplay?.stop() } catch { /* Already stopped. */ }
    try { window.webapis?.avplay?.close() } catch { /* Already closed. */ }
    const retryGeneration = ++this.generation
    window.setTimeout(() => {
      void this.openAndPlay(resumeAt, retryGeneration)
        .then(() => { this.recovering = false })
        .catch((error) => {
          this.recovering = false
          if (retryGeneration === this.generation) this.events?.onError(`${message} ${errorMessage(error)}`)
        })
    }, 350)
  }

  play(): void {
    const player = window.webapis?.avplay
    if (player && ['READY', 'PAUSED'].includes(player.getState())) player.play()
  }

  pause(): void {
    const player = window.webapis?.avplay
    if (player?.getState() === 'PLAYING') player.pause()
  }

  suspend(): void {
    const player = window.webapis?.avplay
    if (!player || !this.active) return
    try {
      this.suspendedPosition = this.currentTime()
      this.resumeAfterRestore = player.getState() === 'PLAYING'
      if (player.suspend) player.suspend()
      else if (this.resumeAfterRestore) player.pause()
    } catch { /* The application may already be hidden or stopped. */ }
  }

  async restore(): Promise<void> {
    const player = window.webapis?.avplay
    if (!player || !this.active) return
    try {
      if (player.restore) {
        await new Promise<void>((resolve, reject) => player.restore!(Math.round(this.suspendedPosition * 1000), false, resolve, reject))
      }
      if (this.resumeAfterRestore && ['READY', 'PAUSED'].includes(player.getState())) player.play()
    } catch (error) {
      this.handleRuntimeError(errorMessage(error), this.generation)
    }
  }

  async seek(positionSeconds: number): Promise<void> {
    const player = window.webapis?.avplay
    if (!player) return
    await new Promise<void>((resolve, reject) => {
      player.seekTo(Math.max(0, Math.round(positionSeconds * 1000)), resolve, reject)
    })
  }

  currentTime(): number {
    try { return Math.max(0, (window.webapis?.avplay?.getCurrentTime() ?? 0) / 1000) } catch { return 0 }
  }

  duration(): number {
    try { return Math.max(0, (window.webapis?.avplay?.getDuration() ?? 0) / 1000) } catch { return 0 }
  }

  tracks(): PlaybackTrack[] {
    const player = window.webapis?.avplay
    if (!player) return []
    try {
      return player.getTotalTrackInfo().flatMap((track) => {
        if (track.type !== 'AUDIO' && track.type !== 'TEXT') return []
        let details: Record<string, unknown> = {}
        try { details = JSON.parse(track.extra_info || '{}') as Record<string, unknown> } catch { /* malformed metadata */ }
        const language = String(details.language || details.track_lang || '').trim()
        const channels = Number(details.channels) || 0
        const codec = String(details.fourCC || '').trim()
        const fallback = track.type === 'AUDIO' ? 'Audio' : 'Subtitles'
        const parts = [language ? language.toUpperCase() : fallback]
        if (track.type === 'AUDIO' && channels) parts.push(`${channels}ch`)
        else if (codec) parts.push(codec)
        return [{ type: track.type, index: track.index, language, label: parts.join(' · ') }]
      })
    } catch {
      return []
    }
  }

  selectTrack(type: 'AUDIO' | 'TEXT', index: number): void {
    window.webapis?.avplay?.setSelectTrack(type, index)
    if (type === 'TEXT') window.webapis?.avplay?.setSilentSubtitle?.(false)
  }

  hideSubtitles(hidden: boolean): void {
    try { window.webapis?.avplay?.setSilentSubtitle?.(hidden) } catch { /* unsupported stream */ }
  }

  setSubtitleDelay(milliseconds: number): void {
    try { window.webapis?.avplay?.setSubtitlePosition?.(milliseconds) } catch { /* unsupported stream */ }
  }

  close(): void {
    this.generation += 1
    this.clearBufferingTimeout()
    const player = window.webapis?.avplay
    if (player) {
      try { if (player.getState() !== 'NONE') player.stop() } catch { /* already stopped */ }
      try { player.close() } catch { /* already closed */ }
    }
    this.active = undefined
    this.events = undefined
    this.recovering = false
    this.resumeAfterRestore = false
  }
}
