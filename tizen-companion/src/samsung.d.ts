interface SamsungAvPlayListener {
  onbufferingstart?: () => void
  onbufferingprogress?: (percent: number) => void
  onbufferingcomplete?: () => void
  oncurrentplaytime?: (milliseconds: number) => void
  onstreamcompleted?: () => void
  onerror?: (error: unknown) => void
  onerrormsg?: (code: unknown, message: string) => void
  onevent?: (eventType: string, eventData: string) => void
  onsubtitlechange?: (duration: number, text: string, data3: unknown, data4: unknown) => void
  ondrmevent?: (drmEvent: string, drmData: unknown) => void
}

interface SamsungAvPlay {
  open(url: string): void
  close(): void
  prepareAsync(success: () => void, error: (error: unknown) => void): void
  setListener(listener: SamsungAvPlayListener): void
  setDisplayRect(x: number, y: number, width: number, height: number): void
  setDisplayMethod?(method: 'PLAYER_DISPLAY_MODE_LETTER_BOX' | 'PLAYER_DISPLAY_MODE_FULL_SCREEN' | string): void
  setBufferingParam?(type: string, unit: string, amount: number): void
  setStreamingProperty?(type: string, value: string): void
  getStreamingProperty?(type: string): string
  setDrm?(type: string, operation: string, properties: string): void
  suspend?(): void
  restore?(restoreTime: number, prepare: boolean, success?: () => void, error?: (error: unknown) => void): void
  play(): void
  pause(): void
  stop(): void
  seekTo(milliseconds: number, success?: () => void, error?: (error: unknown) => void): void
  getState(): 'NONE' | 'IDLE' | 'READY' | 'PLAYING' | 'PAUSED'
  getDuration(): number
  getCurrentTime(): number
  getTotalTrackInfo(): { type: 'VIDEO' | 'AUDIO' | 'TEXT'; index: number; extra_info?: string }[]
  setSelectTrack(type: 'AUDIO' | 'TEXT', index: number): void
  setSilentSubtitle?(silent: boolean): void
  setSubtitlePosition?(milliseconds: number): void
}

interface SamsungTvInputDevice {
  registerKey(name: string): void
  registerKeyBatch?(names: string[]): void
}

interface SamsungTvAudioControl {
  getVolume(): number
  setVolume(volume: number): void
  isMute(): boolean
  setMute(muted: boolean): void
}

interface SamsungSmartViewChannel {
  on(event: string, callback: (data: unknown, from?: unknown) => void): void
  publish(event: string, data: unknown, target?: string): void
  connect(options: { name: string }, callback: (error?: unknown) => void): void
  disconnect(): void
}

interface SamsungSmartViewService {
  channel(id: string): SamsungSmartViewChannel
}

interface Window {
  webapis?: {
    avplay?: SamsungAvPlay
    network?: { getIp(): string }
  }
  tizen?: {
    tvinputdevice?: SamsungTvInputDevice
    tvaudiocontrol?: SamsungTvAudioControl
    application?: { getCurrentApplication(): { exit(): void } }
  }
  msf?: {
    local(callback: (error: unknown, service?: SamsungSmartViewService) => void): void
  }
}
