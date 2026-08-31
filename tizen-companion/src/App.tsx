import QRCode from 'qrcode'
import { useEffect, useRef, useState } from 'preact/hooks'
import {
  CatalogScreen,
  DetailScreen,
  SEARCH_KEYS,
  SearchScreen,
  SeriesScreen,
  SettingsScreen,
  type SettingsConfirmation,
  TRAILER_CONTROL_EVENT,
  type TrailerControlAction,
} from './components/CatalogScreens'
import { HomeScreen } from './components/HomeScreen'
import { NavigationSkeleton } from './components/NavigationSkeleton'
import { PreviewToolbar } from './components/PreviewToolbar'
import { ErrorScreen, ExitConfirmation, LoadingScreen, PlayerScreen, ReadyScreen } from './components/StateScreens'
import { previewSnapshot, previewSnapshotForCatalog } from './data/preview'
import { AvPlayController } from './lib/avplay'
import { catalogCollections, episodeCountsFor } from './lib/catalog'
import { registerRemoteKeys, remoteAction, type RemoteAction } from './lib/remote'
import { CompanionReceiver } from './lib/receiver'
import { ExternalSubtitleController } from './lib/subtitles'
import type {
  CastControlRequest,
  CastLoadRequest,
  CompanionHomeSnapshot,
  CompanionMedia,
  FocusLocation,
  PairingInfo,
  PlaybackState,
  PlaybackSourceChoice,
  PlaybackTrack,
  PlayerMenu,
  ScreenName,
  SubtitleChoice,
  SubtitlePreferences,
  SubtitleStyle,
} from './types'

interface PlayerView {
  title: string
  state: PlaybackState
  position: number
  duration: number
  isLive: boolean
}

const fallbackMedia: CompanionMedia = {
  ref: { provider: 'izumi', id: 'empty', type: 'anime' },
  title: 'Your anime, on the big screen',
  description: 'Pair Izumi to fill this screen with your own library and progress.',
}

const emptySnapshot: CompanionHomeSnapshot = {
  app: 'izumi',
  kind: 'companion-home',
  version: 1,
  revision: 'unpaired',
  generatedAt: 0,
  catalog: { screen: 'home', label: 'Home' },
  rows: [],
}

const offSubtitle: SubtitleChoice = { id: 'off', label: 'Off', kind: 'off' }
const previewAudioTracks: PlaybackTrack[] = [
  { type: 'AUDIO', index: 0, language: 'ja', label: 'Japanese · Stereo' },
  { type: 'AUDIO', index: 1, language: 'en', label: 'English · 5.1' },
]
const previewSubtitleChoices: SubtitleChoice[] = [
  offSubtitle,
  { id: 'preview-en', label: 'English', kind: 'embedded', index: 0 },
  { id: 'preview-es', label: 'Spanish', kind: 'embedded', index: 1 },
  { id: 'preview-fr', label: 'French', kind: 'embedded', index: 2 },
]

const sourceSubtitlePreferences = (): SubtitlePreferences => ({
  size: 'source',
  background: 'source',
  delayMs: 0,
})

function subtitlePreferencesFor(style?: SubtitleStyle): SubtitlePreferences {
  if (!style?.enabled) return sourceSubtitlePreferences()
  const fontSize = Number(style.fontSize) || 42
  return {
    size: fontSize < 40 ? 'small' : fontSize < 55 ? 'medium' : 'large',
    background: Number(style.shadow) > 0 ? 'shadow' : 'none',
    delayMs: 0,
    castStyle: style,
  }
}

function hasSubtitleAppearanceOverride(preferences: SubtitlePreferences): boolean {
  return Boolean(preferences.castStyle?.enabled)
    || preferences.size !== 'source'
    || preferences.background !== 'source'
}

const scrollAnimations = new WeakMap<HTMLElement, number>()

function animateScroll(element: HTMLElement, property: 'scrollLeft' | 'scrollTop', target: number, duration = 260): void {
  const previous = scrollAnimations.get(element)
  if (previous) cancelAnimationFrame(previous)
  const start = element[property]
  const distance = target - start
  if (Math.abs(distance) < 2) return
  const startedAt = performance.now()
  const tick = (now: number) => {
    const elapsed = Math.min(1, (now - startedAt) / duration)
    const eased = 1 - Math.pow(1 - elapsed, 3)
    element[property] = start + distance * eased
    if (elapsed < 1) scrollAnimations.set(element, requestAnimationFrame(tick))
    else scrollAnimations.delete(element)
  }
  scrollAnimations.set(element, requestAnimationFrame(tick))
}

function focusId(focus: FocusLocation): string {
  if (focus.zone === 'row') return `row-${focus.row}-${focus.index}`
  if (focus.zone === 'grid') return `grid-${focus.index}`
  if (focus.zone === 'keyboard') return `keyboard-${focus.index}`
  if (focus.zone === 'setting') return `setting-${focus.index}`
  return `${focus.zone}-${focus.index}`
}

function initialScreen(): ScreenName {
  const requested = new URLSearchParams(location.search).get('screen')
  if (requested && ['home', 'search', 'trending', 'series', 'movies', 'my-list', 'settings', 'ready', 'loading', 'player', 'error'].includes(requested)) return requested as ScreenName
  return import.meta.env.DEV ? 'home' : 'ready'
}

export function App() {
  const showPreviewTools = import.meta.env.DEV || new URLSearchParams(location.search).has('preview')
  const requestedPreviewCatalog = new URLSearchParams(location.search).get('catalog') ?? previewSnapshot.catalog.screen
  const initialPreviewSnapshot = previewSnapshotForCatalog(requestedPreviewCatalog)
  const [screen, setScreen] = useState<ScreenName>(initialScreen)
  const [snapshot, setSnapshot] = useState<CompanionHomeSnapshot>(initialPreviewSnapshot)
  const [selected, setSelected] = useState<CompanionMedia>(initialPreviewSnapshot.hero ?? fallbackMedia)
  const [focus, setFocus] = useState<FocusLocation>({ zone: 'hero', index: 0 })
  const [activeNav, setActiveNav] = useState(0)
  const [notice, setNotice] = useState('')
  const [safeArea, setSafeArea] = useState(false)
  const [connected, setConnected] = useState(false)
  const [paired, setPaired] = useState(Boolean(localStorage.getItem('izumi.companion.credential')))
  const [pairing, setPairing] = useState<PairingInfo>()
  const [qrCode, setQrCode] = useState<string>()
  const [loadingProgress, setLoadingProgress] = useState(34)
  const [errorMessage, setErrorMessage] = useState('The TV player could not open this source.')
  const [player, setPlayer] = useState<PlayerView>({
    title: previewSnapshot.hero?.title ?? 'Now Playing',
    state: 'playing',
    position: 523,
    duration: 1_422,
    isLive: false,
  })
  const [playerControlFocus, setPlayerControlFocus] = useState(0)
  const [playerToolsActive, setPlayerToolsActive] = useState(false)
  const [playerControlsVisible, setPlayerControlsVisible] = useState(true)
  const [playerMenu, setPlayerMenu] = useState<PlayerMenu | null>(null)
  const [playerMenuFocus, setPlayerMenuFocus] = useState(0)
  const [sourceChoices, setSourceChoices] = useState<PlaybackSourceChoice[]>([])
  const [activeSourceId, setActiveSourceId] = useState<string>()
  const [deviceSourceChangeAvailable, setDeviceSourceChangeAvailable] = useState(false)
  const [audioTracks, setAudioTracks] = useState<PlaybackTrack[]>(showPreviewTools ? previewAudioTracks : [])
  const [activeAudio, setActiveAudio] = useState<number | undefined>(showPreviewTools ? 0 : undefined)
  const [subtitleChoices, setSubtitleChoices] = useState<SubtitleChoice[]>(showPreviewTools ? previewSubtitleChoices : [offSubtitle])
  const [activeSubtitle, setActiveSubtitle] = useState(showPreviewTools ? 'preview-en' : 'off')
  const [subtitleText, setSubtitleText] = useState(showPreviewTools ? 'Even the smallest journey can change the world.' : '')
  const [subtitlePreferences, setSubtitlePreferences] = useState<SubtitlePreferences>(sourceSubtitlePreferences)
  const [searchQuery, setSearchQuery] = useState('')
  const [remoteSearchResults, setRemoteSearchResults] = useState<CompanionMedia[]>()
  const [searchPending, setSearchPending] = useState(false)
  const [searchError, setSearchError] = useState('')
  const [seriesSeason, setSeriesSeason] = useState(0)
  const [settingsConfirmation, setSettingsConfirmation] = useState<SettingsConfirmation>(null)
  const [catalogMenuOpen, setCatalogMenuOpen] = useState(false)
  const [catalogMenuFocus, setCatalogMenuFocus] = useState(0)
  const [navigationPhase, setNavigationPhase] = useState<'idle' | 'loading' | 'leaving'>('idle')
  const [trailerOpen, setTrailerOpen] = useState(false)
  const [exitConfirmation, setExitConfirmation] = useState(false)
  const [exitFocus, setExitFocus] = useState(0)

  const receiverRef = useRef<CompanionReceiver>()
  const avplayRef = useRef(new AvPlayController())
  const activeLoadRef = useRef<CastLoadRequest>()
  const playerRef = useRef(player)
  const noticeTimerRef = useRef<number>()
  const simulationTimerRef = useRef<number>()
  const playRequestGenerationRef = useRef(0)
  const navigationTimerRef = useRef<number>()
  const navigationExitTimerRef = useRef<number>()
  const subtitleTimerRef = useRef<number>()
  const searchTimerRef = useRef<number>()
  const searchResponseTimerRef = useRef<number>()
  const searchQueryRef = useRef(searchQuery)
  const playerControlsTimerRef = useRef<number>()
  const catalogRequestRef = useRef<{ screen: string; label: string; timer: number }>()
  const externalSubtitlesRef = useRef(new ExternalSubtitleController())
  const activeSubtitleRef = useRef(activeSubtitle)
  const subtitlePreferencesRef = useRef(subtitlePreferences)
  const detailReturnScreenRef = useRef<ScreenName>('home')
  const detailReturnFocusRef = useRef<FocusLocation>({ zone: 'hero', index: 1 })
  const lastHomeContentFocusRef = useRef<FocusLocation>({ zone: 'hero', index: 0 })

  const revealPlayerControls = (hold = false) => {
    setPlayerControlsVisible(true)
    if (playerControlsTimerRef.current) window.clearTimeout(playerControlsTimerRef.current)
    if (!hold && playerRef.current.state === 'playing' && !playerToolsActive && !playerMenu) {
      playerControlsTimerRef.current = window.setTimeout(() => setPlayerControlsVisible(false), 3_600)
    }
  }

  const requestExit = () => {
    setExitFocus(0)
    setExitConfirmation(true)
  }

  const exitApplication = () => {
    setExitConfirmation(false)
    const application = window.tizen?.application?.getCurrentApplication()
    if (application) application.exit()
    else showNotice('Exit confirmation works on the TV runtime')
  }

  const updatePlayer = (next: Partial<PlayerView>) => {
    const value = { ...playerRef.current, ...next }
    playerRef.current = value
    setPlayer(value)
  }

  const audioSnapshot = () => {
    const audio = window.tizen?.tvaudiocontrol
    if (!audio) return {}
    try { return { volume: audio.getVolume() / 100, muted: audio.isMute() } } catch { return {} }
  }

  const publishStatus = (forced = false, error?: string) => {
    const request = activeLoadRef.current
    if (!request) return
    const view = playerRef.current
    receiverRef.current?.publishStatus({
      sessionId: request.sessionId,
      state: view.state,
      positionSeconds: view.position,
      durationSeconds: view.duration || undefined,
      ...audioSnapshot(),
      error,
      forced,
    })
  }

  const selectAudioTrack = (track: PlaybackTrack) => {
    try { if (avplayRef.current.available) avplayRef.current.selectTrack('AUDIO', track.index) } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'This audio track is unavailable.')
    }
    setActiveAudio(track.index)
    setPlayerMenu(null)
  }

  const selectSubtitleChoice = (choice: SubtitleChoice) => {
    activeSubtitleRef.current = choice.id
    setActiveSubtitle(choice.id)
    setSubtitleText('')
    externalSubtitlesRef.current.clear()
    if (choice.kind === 'off') avplayRef.current.hideSubtitles(true)
    else if (choice.kind === 'embedded' && choice.index != null) {
      avplayRef.current.hideSubtitles(hasSubtitleAppearanceOverride(subtitlePreferencesRef.current))
      try { if (avplayRef.current.available) avplayRef.current.selectTrack('TEXT', choice.index) } catch (error) {
        setErrorMessage(error instanceof Error ? error.message : 'This subtitle track is unavailable.')
      }
      if (showPreviewTools && !activeLoadRef.current) setSubtitleText('Even the smallest journey can change the world.')
    } else if (choice.kind === 'external' && choice.url) {
      avplayRef.current.hideSubtitles(true)
      void externalSubtitlesRef.current.load(choice.url, choice.contentType).catch(() => {
        setNotice('That subtitle file could not be loaded on this TV.')
      })
    }
    setPlayerMenu(null)
  }

  const changeSubtitleAppearance = (setting: 'size' | 'background' | 'delay') => {
    const current = subtitlePreferencesRef.current
    const sizes: SubtitlePreferences['size'][] = ['source', 'small', 'medium', 'large']
    const backgrounds: SubtitlePreferences['background'][] = ['source', 'none', 'shadow', 'box']
    const delays = [-500, 0, 500, 1_000]
    const next: SubtitlePreferences = setting === 'size'
      ? { ...current, castStyle: undefined, size: sizes[(sizes.indexOf(current.size) + 1) % sizes.length] }
      : setting === 'background'
        ? { ...current, castStyle: undefined, background: backgrounds[(backgrounds.indexOf(current.background) + 1) % backgrounds.length] }
        : { ...current, delayMs: delays[(delays.indexOf(current.delayMs) + 1) % delays.length] }
    subtitlePreferencesRef.current = next
    setSubtitlePreferences(next)
    if (activeSubtitleRef.current.startsWith('embedded-')) {
      avplayRef.current.hideSubtitles(hasSubtitleAppearanceOverride(next))
      if (!hasSubtitleAppearanceOverride(next)) setSubtitleText('')
    }
    avplayRef.current.setSubtitleDelay(next.delayMs)
  }

  const stopPlayback = (destination: ScreenName = 'home') => {
    // Publish the terminal state before clearing the authenticated sender session. Android uses
    // this to stop its session-only HTTP-relay foreground service at EOF and on explicit stop.
    updatePlayer({ state: 'idle' })
    publishStatus(true)
    avplayRef.current.close()
    activeLoadRef.current = undefined
    receiverRef.current?.clearPlayback()
    externalSubtitlesRef.current.clear()
    setSubtitleText('')
    setPlayerMenu(null)
    setSourceChoices([])
    setActiveSourceId(undefined)
    updatePlayer({ position: 0 })
    setScreen(destination)
  }

  const startAvPlay = async (request: CastLoadRequest) => {
    playRequestGenerationRef.current += 1
    if (simulationTimerRef.current) window.clearTimeout(simulationTimerRef.current)
    const requestedPreferences = subtitlePreferencesFor(request.subtitleStyle)
    subtitlePreferencesRef.current = requestedPreferences
    setSubtitlePreferences(requestedPreferences)
    const externalChoices: SubtitleChoice[] = request.subtitles.map((track, index) => ({
      id: `external-${track.id ?? index + 1}`,
      label: track.title || track.lang?.toUpperCase() || `Subtitle ${index + 1}`,
      kind: 'external',
      url: track.url,
      contentType: track.contentType,
    }))
    setSubtitleChoices([offSubtitle, ...externalChoices])
    const requestedSubtitle = externalChoices.find((choice) => request.activeTrackIds.includes(Number(choice.id.replace('external-', ''))))
    selectSubtitleChoice(requestedSubtitle ?? offSubtitle)
    activeLoadRef.current = request
    setLoadingProgress(12)
    updatePlayer({ title: request.title, state: 'buffering', position: request.positionSeconds, duration: 0, isLive: false })
    setScreen('loading')
    publishStatus(true)
    try {
      await avplayRef.current.load(request, {
        onBuffering: (percent) => {
          setLoadingProgress(Math.max(12, Number(percent) || 12))
          updatePlayer({ state: 'buffering' })
          publishStatus()
        },
        onState: (state) => {
          updatePlayer({ state })
          if (state === 'playing' || state === 'paused') setScreen('player')
          publishStatus(true)
        },
        onTime: (position, duration) => {
          updatePlayer({ position, duration })
          if (activeSubtitleRef.current.startsWith('external-')) {
            setSubtitleText(externalSubtitlesRef.current.textAt(position, subtitlePreferencesRef.current.delayMs))
          }
        },
        onTracks: (tracks) => {
          const audio = tracks.filter((track) => track.type === 'AUDIO')
          const embedded = tracks.filter((track) => track.type === 'TEXT').map((track): SubtitleChoice => ({
            id: `embedded-${track.index}`,
            label: track.label,
            kind: 'embedded',
            index: track.index,
          }))
          setAudioTracks(audio)
          setActiveAudio(audio[0]?.index)
          setSubtitleChoices([offSubtitle, ...externalChoices, ...embedded])
        },
        onLive: (isLive) => updatePlayer({ isLive }),
        onSubtitle: (text, durationMs) => {
          if (!activeSubtitleRef.current.startsWith('embedded-')) return
          if (!hasSubtitleAppearanceOverride(subtitlePreferencesRef.current)) {
            setSubtitleText('')
            return
          }
          setSubtitleText(text)
          if (subtitleTimerRef.current) window.clearTimeout(subtitleTimerRef.current)
          subtitleTimerRef.current = window.setTimeout(() => setSubtitleText(''), Math.max(500, durationMs || 3_000))
        },
        onComplete: () => {
          publishStatus(true)
          stopPlayback('ready')
        },
        onError: (message) => {
          setErrorMessage(message)
          publishStatus(true, message)
          setScreen('error')
        },
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      setErrorMessage(message)
      publishStatus(true, message)
      setScreen('error')
    }
  }

  const handleControl = (command: CastControlRequest) => {
    if (command.action === 'status') publishStatus(true)
    else if (command.action === 'play') {
      avplayRef.current.play()
      updatePlayer({ state: 'playing' })
      setScreen('player')
      publishStatus(true)
    } else if (command.action === 'pause') {
      avplayRef.current.pause()
      updatePlayer({ state: 'paused' })
      publishStatus(true)
    } else if (command.action === 'seek' && Number.isFinite(command.positionSeconds)) {
      const position = Math.max(0, Number(command.positionSeconds))
      void avplayRef.current.seek(position).then(() => {
        updatePlayer({ position })
        publishStatus(true)
      })
    } else if (command.action === 'volume') {
      const audio = window.tizen?.tvaudiocontrol
      try {
        if (audio && command.volume != null) audio.setVolume(Math.round(Math.max(0, Math.min(1, command.volume)) * 100))
        if (audio && command.muted != null) audio.setMute(command.muted)
      } catch { /* Audio control is optional in the browser/emulator. */ }
      publishStatus(true)
    } else if (command.action === 'stop') {
      stopPlayback('ready')
      if (command.exitApp) {
        // Let the terminal idle status reach the sender before Tizen tears down the application.
        window.setTimeout(() => {
          try { window.tizen?.application?.getCurrentApplication().exit() } catch { /* TV runtime only. */ }
        }, 100)
      }
    } else if (command.action === 'tracks') {
      const request = activeLoadRef.current
      const trackId = command.activeTrackIds?.[0]
      if (request && trackId != null) {
        const track = request.subtitles.find((entry, index) => (entry.id ?? index + 1) === trackId)
        if (track) selectSubtitleChoice({
          id: `external-${trackId}`,
          label: track.title || track.lang?.toUpperCase() || 'Subtitles',
          kind: 'external',
          url: track.url,
          contentType: track.contentType,
        })
      } else selectSubtitleChoice(offSubtitle)
      publishStatus(true)
    }
  }

  useEffect(() => {
    registerRemoteKeys()
    const receiver = new CompanionReceiver({
      onConnection: setConnected,
      onPaired: setPaired,
      onPairingInfo: setPairing,
      onSnapshot: (next) => {
        const pendingCatalog = catalogRequestRef.current
        if (pendingCatalog && next.catalog.screen === pendingCatalog.screen) {
          window.clearTimeout(pendingCatalog.timer)
          catalogRequestRef.current = undefined
          showNotice(`${pendingCatalog.label} catalogue loaded`)
        }
        setSnapshot(next)
        setSelected(next.hero ?? next.rows[0]?.items[0] ?? fallbackMedia)
        setFocus({ zone: 'hero', index: 0 })
        setScreen('home')
      },
      onSearchResults: (query, items, error) => {
        if (query.trim().toLowerCase() !== searchQueryRef.current.trim().toLowerCase()) return
        if (searchResponseTimerRef.current) window.clearTimeout(searchResponseTimerRef.current)
        setRemoteSearchResults(items)
        setSearchPending(false)
        setSearchError(error ?? '')
      },
      onLoad: (request) => {
        setSourceChoices([])
        setActiveSourceId(undefined)
        void startAvPlay(request)
      },
      onControl: handleControl,
      onDeviceSourceAvailability: setDeviceSourceChangeAvailable,
    })
    receiverRef.current = receiver
    void receiver.connect().catch((error) => {
      if (!showPreviewTools) {
        setErrorMessage(error instanceof Error ? error.message : 'The Samsung receiver service is unavailable.')
        setScreen('error')
      }
    })
    const statusTimer = window.setInterval(() => {
      if (!activeLoadRef.current) return
      if (avplayRef.current.available) {
        updatePlayer({ position: avplayRef.current.currentTime(), duration: avplayRef.current.duration() })
      }
      publishStatus()
    }, 1_000)
    return () => {
      window.clearInterval(statusTimer)
      if (subtitleTimerRef.current) window.clearTimeout(subtitleTimerRef.current)
      if (simulationTimerRef.current) window.clearTimeout(simulationTimerRef.current)
      if (navigationTimerRef.current) window.clearTimeout(navigationTimerRef.current)
      if (navigationExitTimerRef.current) window.clearTimeout(navigationExitTimerRef.current)
      if (playerControlsTimerRef.current) window.clearTimeout(playerControlsTimerRef.current)
      if (catalogRequestRef.current) window.clearTimeout(catalogRequestRef.current.timer)
      if (searchTimerRef.current) window.clearTimeout(searchTimerRef.current)
      if (searchResponseTimerRef.current) window.clearTimeout(searchResponseTimerRef.current)
      receiver.disconnect()
      avplayRef.current.close()
    }
  }, [])

  useEffect(() => {
    if (!pairing) return
    let cancelled = false
    void QRCode.toDataURL(pairing.link, {
      width: 260,
      margin: 1,
      color: { dark: '#050505', light: '#ffffff' },
      errorCorrectionLevel: 'H',
    }).then((value) => { if (!cancelled) setQrCode(value) })
    return () => { cancelled = true }
  }, [pairing?.link])

  useEffect(() => {
    document.body.classList.toggle('avplay-visible', screen === 'player' && avplayRef.current.available)
  }, [screen])

  useEffect(() => {
    if (screen !== 'player') {
      if (playerControlsTimerRef.current) window.clearTimeout(playerControlsTimerRef.current)
      return
    }
    revealPlayerControls(player.state !== 'playing' || playerToolsActive || Boolean(playerMenu))
  }, [screen, player.state, playerToolsActive, playerMenu])

  useEffect(() => {
    searchQueryRef.current = searchQuery
    if (searchTimerRef.current) window.clearTimeout(searchTimerRef.current)
    if (searchResponseTimerRef.current) window.clearTimeout(searchResponseTimerRef.current)
    if (showPreviewTools || screen !== 'search' || !searchQuery.trim()) {
      setSearchPending(false)
      setSearchError('')
      setRemoteSearchResults(undefined)
      return
    }
    setRemoteSearchResults(undefined)
    setSearchError('')
    setSearchPending(true)
    const requestedQuery = searchQuery.trim()
    searchTimerRef.current = window.setTimeout(() => {
      if (!receiverRef.current?.requestSearch(requestedQuery)) {
        setSearchPending(false)
        setSearchError('Open izumi on the paired device to search this catalogue.')
        return
      }
      searchResponseTimerRef.current = window.setTimeout(() => {
        if (searchQueryRef.current.trim() !== requestedQuery) return
        setSearchPending(false)
        setSearchError('The paired device did not answer. Try again when izumi is open.')
      }, 7_000)
    }, 280)
    return () => {
      if (searchTimerRef.current) window.clearTimeout(searchTimerRef.current)
      if (searchResponseTimerRef.current) window.clearTimeout(searchResponseTimerRef.current)
    }
  }, [searchQuery, screen, showPreviewTools])

  useEffect(() => {
    const playerController = avplayRef.current
    const onVisibility = () => {
      if (document.hidden) playerController.suspend()
      else void playerController.restore()
    }
    document.addEventListener('visibilitychange', onVisibility)
    return () => document.removeEventListener('visibilitychange', onVisibility)
  }, [])

  useEffect(() => {
    const element = document.querySelector<HTMLElement>(`[data-focus-id="${focusId(focus)}"]`)
    if (!element || ['ready', 'loading', 'player', 'error'].includes(screen)) return
    element.focus()
    if (focus.zone === 'row') {
      const strip = element.parentElement
      if (strip) {
        const left = element.offsetLeft
        const right = left + element.offsetWidth
        if (left < strip.scrollLeft) animateScroll(strip, 'scrollLeft', Math.max(0, left - 24), 220)
        else if (right > strip.scrollLeft + strip.clientWidth) animateScroll(strip, 'scrollLeft', right - strip.clientWidth + 24, 220)
      }
      const rows = element.closest<HTMLElement>('.catalog-rows')
      if (rows) {
        const bounds = element.getBoundingClientRect()
        const container = rows.getBoundingClientRect()
        if (focus.row === 0) animateScroll(rows, 'scrollTop', 0, 240)
        else if (bounds.bottom > container.bottom - 24) animateScroll(rows, 'scrollTop', rows.scrollTop + bounds.bottom - container.bottom + 48, 300)
        else if (bounds.top < container.top + 20) animateScroll(rows, 'scrollTop', Math.max(0, rows.scrollTop + bounds.top - container.top - 24), 300)
      }
    }
    if (focus.zone === 'grid') {
      const gridScroller = element.closest<HTMLElement>('.browse-catalog, .search-results')
      if (gridScroller) {
        const bounds = element.getBoundingClientRect()
        const container = gridScroller.getBoundingClientRect()
        if (bounds.bottom > container.bottom - 20) animateScroll(gridScroller, 'scrollTop', gridScroller.scrollTop + bounds.bottom - container.bottom + 28, 260)
        else if (bounds.top < container.top + 20) animateScroll(gridScroller, 'scrollTop', Math.max(0, gridScroller.scrollTop + bounds.top - container.top - 24), 260)
      }
    }
    if (focus.zone === 'episode') {
      const scroller = element.closest<HTMLElement>('.series-library-scroll')
      if (scroller) {
        const bounds = element.getBoundingClientRect()
        const container = scroller.getBoundingClientRect()
        if (bounds.bottom > container.bottom - 12) animateScroll(scroller, 'scrollTop', scroller.scrollTop + bounds.bottom - container.bottom + 18, 240)
        else if (bounds.top < container.top + 12) animateScroll(scroller, 'scrollTop', Math.max(0, scroller.scrollTop + bounds.top - container.top - 18), 240)
      }
    }
    if (focus.zone === 'relation') {
      const strip = element.parentElement
      if (strip) {
        const left = element.offsetLeft
        const right = left + element.offsetWidth
        if (left < strip.scrollLeft) animateScroll(strip, 'scrollLeft', Math.max(0, left - 24), 220)
        else if (right > strip.scrollLeft + strip.clientWidth) animateScroll(strip, 'scrollLeft', right - strip.clientWidth + 24, 220)
      }
    }
  }, [focus, screen])

  useEffect(() => {
    if (!showPreviewTools || screen !== 'player' || player.state !== 'playing' || activeLoadRef.current) return
    const timer = window.setInterval(() => {
      const view = playerRef.current
      updatePlayer({ position: Math.min(view.duration, view.position + 1) })
    }, 1_000)
    return () => window.clearInterval(timer)
  }, [screen, player.state, showPreviewTools])

  const showNotice = (message: string) => {
    setNotice(message)
    if (noticeTimerRef.current) window.clearTimeout(noticeTimerRef.current)
    noticeTimerRef.current = window.setTimeout(() => setNotice(''), 2_600)
  }

  const openDetails = (media: CompanionMedia) => {
    detailReturnScreenRef.current = screen
    detailReturnFocusRef.current = focus
    setSelected(media)
    setFocus({ zone: 'detail', index: 0 })
    setScreen('details')
  }

  const closeDetails = () => {
    setScreen(detailReturnScreenRef.current)
    setFocus(detailReturnFocusRef.current)
  }

  const collections = catalogCollections(snapshot)
  const allMedia = collections.search
  const normalizedSearch = searchQuery.trim().toLowerCase()
  const localSearchResults = allMedia.filter((item) => {
    const searchable = [item.title, item.subtitle, item.placement?.label].filter(Boolean).join(' ').toLowerCase()
    return !normalizedSearch || searchable.includes(normalizedSearch)
  })
  const searchResults = normalizedSearch && remoteSearchResults !== undefined ? remoteSearchResults : localSearchResults
  const searchSuggestionPool = Array.from(new Set(allMedia.flatMap((item) => [
    item.title,
    ...(item.subtitle?.split('·').map((value) => value.trim()).filter((value) => value.length > 2 && !/^\d/.test(value) && !/episodes?/i.test(value)) ?? []),
    item.placement?.label,
  ].filter((value): value is string => Boolean(value)))))
  const searchSuggestions = searchSuggestionPool
    .filter((value) => !normalizedSearch || value.toLowerCase().includes(normalizedSearch))
    .sort((left, right) => {
      if (!normalizedSearch) return left.localeCompare(right)
      return Number(right.toLowerCase().startsWith(normalizedSearch)) - Number(left.toLowerCase().startsWith(normalizedSearch)) || left.localeCompare(right)
    })
    .slice(0, 4)
  const trendingItems = collections.trending
  const seriesItems = collections.series
  const movieItems = collections.movies
  const myListItems = collections.myList
  const catalogOptions = snapshot.catalog.options?.length
    ? snapshot.catalog.options
    : [{ screen: snapshot.catalog.screen, label: snapshot.catalog.label }]

  const changeFocus = (next: FocusLocation) => {
    setFocus(next)
    if (next.zone === 'row') {
      const item = snapshot.rows[next.row]?.items[next.index]
      if (item) setSelected(item)
    }
  }

  const openCatalogMenu = () => {
    const selectedIndex = Math.max(0, catalogOptions.findIndex((option) => option.screen === snapshot.catalog.screen))
    if (screen !== 'home') {
      setSelected(snapshot.hero ?? snapshot.rows[0]?.items[0] ?? fallbackMedia)
      lastHomeContentFocusRef.current = { zone: 'hero', index: 0 }
    }
    setActiveNav(0)
    setScreen('home')
    setCatalogMenuOpen(true)
    setCatalogMenuFocus(selectedIndex)
    changeFocus({ zone: 'catalog', index: selectedIndex })
  }

  const closeCatalogMenu = () => {
    setCatalogMenuOpen(false)
    changeFocus({ zone: 'nav', index: -1 })
  }

  const selectCatalogOption = (index: number) => {
    const option = catalogOptions[index]
    if (!option) return
    if (showPreviewTools) {
      const next = previewSnapshotForCatalog(option.screen)
      setSnapshot(next)
      setSelected(next.hero ?? next.rows[0]?.items[0] ?? fallbackMedia)
      lastHomeContentFocusRef.current = { zone: 'hero', index: 0 }
      setCatalogMenuOpen(false)
      changeFocus({ zone: 'hero', index: 0 })
      showNotice(`${option.label} catalogue loaded`)
      return
    }
    if (!receiverRef.current?.requestCatalog(option.screen)) {
      showNotice('Pair izumi before changing catalogues')
      return
    }
    if (catalogRequestRef.current) window.clearTimeout(catalogRequestRef.current.timer)
    const timer = window.setTimeout(() => {
      if (catalogRequestRef.current?.screen !== option.screen) return
      catalogRequestRef.current = undefined
      setNavigationPhase('idle')
      showNotice(`${option.label} did not respond. Still showing ${snapshot.catalog.label}.`)
    }, 8_000)
    catalogRequestRef.current = { screen: option.screen, label: option.label, timer }
    setCatalogMenuOpen(false)
    changeFocus({ zone: 'nav', index: -1 })
    beginNavigationTransition()
    showNotice(`Switching to ${option.label}`)
  }

  const moveHomeFocus = (action: RemoteAction) => {
    let next = focus
    if (focus.zone !== 'nav') lastHomeContentFocusRef.current = focus
    if (focus.zone === 'nav') {
      if (action === 'up') next = { zone: 'nav', index: Math.max(-1, focus.index - 1) }
      else if (action === 'down') next = { zone: 'nav', index: Math.min(6, focus.index + 1) }
      else if (action === 'right') next = lastHomeContentFocusRef.current
    } else if (focus.zone === 'hero') {
      if (action === 'left') next = focus.index === 1 ? { zone: 'hero', index: 0 } : { zone: 'nav', index: activeNav }
      else if (action === 'right') next = { zone: 'hero', index: Math.min(1, focus.index + 1) }
      else if (action === 'down' && snapshot.rows[0]?.items.length) next = { zone: 'row', row: 0, index: 0 }
    } else if (focus.zone === 'row') {
      const row = snapshot.rows[focus.row]
      if (action === 'left') next = focus.index > 0
        ? { ...focus, index: focus.index - 1 }
        : { zone: 'nav', index: activeNav }
      else if (action === 'right') next = { ...focus, index: Math.min(row.items.length - 1, focus.index + 1) }
      else if (action === 'up') {
        const upperRow = focus.row - 1
        next = upperRow < 0
          ? { zone: 'hero', index: 0 }
          : { zone: 'row', row: upperRow, index: Math.min(focus.index, snapshot.rows[upperRow].items.length - 1) }
      } else if (action === 'down' && focus.row < snapshot.rows.length - 1) {
        const lowerRow = focus.row + 1
        next = { zone: 'row', row: lowerRow, index: Math.min(focus.index, snapshot.rows[lowerRow].items.length - 1) }
      }
    }
    changeFocus(next)
  }

  const playMedia = async (media: CompanionMedia) => {
    const generation = ++playRequestGenerationRef.current
    if (simulationTimerRef.current) window.clearTimeout(simulationTimerRef.current)
    setSelected(media)
    setSourceChoices([])
    setActiveSourceId(undefined)
    setLoadingProgress(18)
    updatePlayer({ title: media.title, state: 'buffering', position: media.progress ? 523 : 0, duration: 1_422, isLive: false })
    setScreen('loading')
    if (showPreviewTools) {
      if (simulationTimerRef.current) window.clearTimeout(simulationTimerRef.current)
      simulationTimerRef.current = window.setTimeout(() => {
        setLoadingProgress(100)
        updatePlayer({ state: 'playing' })
        setScreen('player')
      }, 900)
      return
    }
    const result = await receiverRef.current?.requestPlay(media) ?? 'open-client'
    if (generation !== playRequestGenerationRef.current) return
    if (typeof result !== 'string') {
      setSourceChoices(result.sources)
      setActiveSourceId(result.selectedId)
      await startAvPlay(result.request)
    } else if (result === 'open-client') {
      setErrorMessage('Open Izumi on your linked device, then try again.')
      setScreen('error')
    } else if (result === 'queued') {
      setErrorMessage('The request is waiting in your private Worker, but phone notifications are not enrolled. Open Izumi to continue.')
      setScreen('error')
    } else if (result === 'worker-error') {
      setErrorMessage('Your private Izumi Worker could not be reached. Check its deployment and try again.')
      setScreen('error')
    } else if (result === 'no-source') {
      setErrorMessage('Your private Worker found no TV-playable source. In Izumi, enable “Cloudflare + connected Izumi device” to allow debrid, P2P, or device-only sources.')
      setScreen('error')
    } else if (result === 'notified') {
      simulationTimerRef.current = window.setTimeout(() => {
        if (generation !== playRequestGenerationRef.current || activeLoadRef.current) return
        setErrorMessage('The phone did not finish this request before it expired. Try again from the TV.')
        setScreen('error')
      }, 5 * 60_000)
    }
  }

  const openSeries = (media: CompanionMedia) => {
    setTrailerOpen(false)
    setSelected(media)
    setSeriesSeason(0)
    setActiveNav(3)
    setCatalogMenuOpen(false)
    setScreen('series')
    changeFocus({ zone: 'series-season', index: 0 })
  }

  const selectCatalogMedia = (media: CompanionMedia) => {
    if (media.ref.type === 'movie') playMedia(media)
    else openSeries(media)
  }

  const selectRelatedMedia = (media: CompanionMedia) => {
    if (media.ref.type === 'movie') openDetails(media)
    else openSeries(media)
  }

  const beginNavigationTransition = () => {
    if (navigationTimerRef.current) window.clearTimeout(navigationTimerRef.current)
    if (navigationExitTimerRef.current) window.clearTimeout(navigationExitTimerRef.current)
    setNavigationPhase('loading')
    navigationTimerRef.current = window.setTimeout(() => {
      setNavigationPhase('leaving')
      navigationExitTimerRef.current = window.setTimeout(() => setNavigationPhase('idle'), 220)
    }, 520)
  }

  const selectNav = (index: number) => {
    if (index === -1) return openCatalogMenu()
    setTrailerOpen(false)
    setCatalogMenuOpen(false)
    setActiveNav(index)
    setSettingsConfirmation(null)
    const destinations: ScreenName[] = ['home', 'search', 'trending', 'series', 'movies', 'my-list', 'settings']
    const destination = destinations[index] ?? 'home'
    if (destination !== screen) beginNavigationTransition()
    setScreen(destination)
    if (destination === 'home') {
      setSelected(snapshot.hero ?? snapshot.rows[0]?.items[0] ?? fallbackMedia)
      lastHomeContentFocusRef.current = { zone: 'hero', index: 0 }
      changeFocus({ zone: 'hero', index: 0 })
    } else if (destination === 'search') changeFocus({ zone: 'keyboard', index: 0 })
    else if (destination === 'series') {
      setSeriesSeason(0)
      setSelected(seriesItems[0] ?? fallbackMedia)
      changeFocus({ zone: 'series-season', index: 0 })
    }
    else if (destination === 'settings') changeFocus({ zone: 'setting', index: 0 })
    else {
      const items = destination === 'trending' ? trendingItems : destination === 'movies' ? movieItems : myListItems
      setSelected(items[0] ?? fallbackMedia)
      changeFocus({ zone: 'grid', index: 0 })
    }
  }

  const activateCurrentFocus = () => {
    if (focus.zone === 'nav') selectNav(focus.index)
    else if (focus.zone === 'hero') focus.index === 0 ? playMedia(selected) : openDetails(selected)
    else if (focus.zone === 'row') {
      const row = snapshot.rows[focus.row]
      const media = row?.items[focus.index]
      if (media) row.kind === 'continue' ? playMedia(media) : selectCatalogMedia(media)
    }
  }

  const seekFromRemote = (delta: number) => {
    const view = playerRef.current
    const position = Math.max(0, Math.min(view.duration || Number.MAX_SAFE_INTEGER, view.position + delta))
    updatePlayer({ position })
    if (avplayRef.current.available) void avplayRef.current.seek(position).then(() => publishStatus(true))
  }

  const activatePlayerControl = (index: number) => {
    setPlayerControlFocus(index)
    if (index === 0 && sourceChoices.length + Number(deviceSourceChangeAvailable) === 0) {
      showNotice('No alternate sources are available for this playback.')
      return
    }
    setPlayerMenu(index === 0 ? 'source' : index === 1 ? 'audio' : index === 2 ? 'subtitles' : 'appearance')
    setPlayerMenuFocus(0)
  }

  const selectPlaybackSource = (choice: PlaybackSourceChoice) => {
    setPlayerMenu(null)
    if (choice.id === activeSourceId) {
      showNotice('That source is already playing.')
      return
    }
    const positionSeconds = playerRef.current.position
    setActiveSourceId(choice.id)
    void startAvPlay({ ...choice.request, positionSeconds })
  }

  const requestLinkedDeviceSources = async () => {
    setPlayerMenu(null)
    const result = await receiverRef.current?.requestDeviceSourceChange(selected, playerRef.current.position) ?? 'open-client'
    if (typeof result !== 'string') {
      setSourceChoices(result.sources)
      setActiveSourceId(result.selectedId)
      await startAvPlay({ ...result.request, positionSeconds: playerRef.current.position })
    } else if (result === 'local') showNotice('Choose the replacement source on your linked device.')
    else if (result === 'notified') showNotice('A source-picker notification was sent to your linked phone.')
    else if (result === 'queued') showNotice('Open Izumi on your linked phone to choose a source.')
    else if (result === 'worker-error') showNotice('Your private Izumi Worker could not send the source request.')
    else if (result === 'no-source') showNotice('Linked-device sources are disabled in Cloudflare-only mode.')
    else showNotice('Open Izumi on your linked device to choose a source.')
  }

  const togglePlayback = () => {
    if (playerRef.current.state === 'playing') {
      avplayRef.current.pause()
      updatePlayer({ state: 'paused' })
    } else {
      avplayRef.current.play()
      updatePlayer({ state: 'playing' })
    }
    publishStatus(true)
  }

  const playerMenuLength = playerMenu === 'source'
    ? sourceChoices.length + Number(deviceSourceChangeAvailable)
    : playerMenu === 'audio'
    ? audioTracks.length
    : playerMenu === 'subtitles' ? subtitleChoices.length : 3

  const activatePlayerMenuItem = () => {
    if (playerMenu === 'source') {
      const source = sourceChoices[playerMenuFocus]
      if (source) selectPlaybackSource(source)
      else if (deviceSourceChangeAvailable && playerMenuFocus === sourceChoices.length) void requestLinkedDeviceSources()
    } else if (playerMenu === 'audio') {
      const track = audioTracks[playerMenuFocus]
      if (track) selectAudioTrack(track)
    } else if (playerMenu === 'subtitles') {
      const choice = subtitleChoices[playerMenuFocus]
      if (choice) selectSubtitleChoice(choice)
    } else if (playerMenu === 'appearance') {
      changeSubtitleAppearance((['size', 'background', 'delay'] as const)[playerMenuFocus] ?? 'size')
    }
  }

  const browseItemsFor = (name: ScreenName): CompanionMedia[] => name === 'trending'
    ? trendingItems
    : name === 'series' ? seriesItems : name === 'movies' ? movieItems : myListItems

  const playSeriesEpisode = (index: number) => {
    const counts = episodeCountsFor(selected)
    if (!counts.length) {
      showNotice('Episode information is not available yet. Refresh this title from izumi.')
      return
    }
    const activeSeason = Math.min(seriesSeason, counts.length - 1)
    const season = counts.length === 1 && selected.season ? selected.season : activeSeason + 1
    const episode = index + 1
    const isResumeEpisode = season === (selected.season ?? 1) && episode === selected.episode
    playMedia({ ...selected, season, episode, progress: isResumeEpisode ? selected.progress : undefined })
  }

  const moveSeriesFocus = (action: RemoteAction) => {
    const counts = episodeCountsFor(selected)
    if (!counts.length) {
      const relations = selected.relations ?? []
      const hasTrailer = Boolean(selected.trailer?.id && (!selected.trailer.site || selected.trailer.site.toLowerCase() === 'youtube'))
      if (focus.zone === 'nav' && action === 'right') changeFocus(hasTrailer ? { zone: 'series-action', index: 0 } : relations.length ? { zone: 'relation', index: 0 } : { zone: 'nav', index: activeNav })
      else if (focus.zone === 'series-action' && action === 'down' && relations.length) changeFocus({ zone: 'relation', index: 0 })
      else if (focus.zone === 'relation') {
        if (action === 'left' && focus.index > 0) changeFocus({ zone: 'relation', index: focus.index - 1 })
        else if (action === 'left') changeFocus({ zone: 'nav', index: activeNav })
        else if (action === 'right') changeFocus({ zone: 'relation', index: Math.min(relations.length - 1, focus.index + 1) })
        else if (action === 'up' && hasTrailer) changeFocus({ zone: 'series-action', index: 0 })
      }
      return
    }
    const activeSeason = Math.min(seriesSeason, counts.length - 1)
    const episodeCount = counts[activeSeason] ?? 1
    const seasonNumber = counts.length === 1 && selected.season ? selected.season : activeSeason + 1
    const resumeIndex = seasonNumber === (selected.season ?? 1)
      ? Math.max(0, Math.min(episodeCount - 1, (selected.episode ?? 1) - 1))
      : 0
    const relations = selected.relations ?? []
    const hasTrailer = Boolean(
      selected.trailer?.id
      && (!selected.trailer.site || selected.trailer.site.toLowerCase() === 'youtube'),
    )
    if (focus.zone === 'nav') {
      if (action === 'up') changeFocus({ zone: 'nav', index: Math.max(-1, focus.index - 1) })
      else if (action === 'down') changeFocus({ zone: 'nav', index: Math.min(6, focus.index + 1) })
      else if (action === 'right') changeFocus(hasTrailer ? { zone: 'series-action', index: 0 } : { zone: 'series-season', index: activeSeason })
      return
    }
    if (focus.zone === 'series-action') {
      if (action === 'left') changeFocus({ zone: 'nav', index: activeNav })
      else if (action === 'right') changeFocus({ zone: 'series-season', index: activeSeason })
      else if (action === 'down') changeFocus(relations.length ? { zone: 'relation', index: 0 } : { zone: 'episode', index: resumeIndex })
      return
    }
    if (focus.zone === 'series-season') {
      if (action === 'left') {
        if (focus.index === 0) return changeFocus(hasTrailer ? { zone: 'series-action', index: 0 } : { zone: 'nav', index: activeNav })
        setSeriesSeason(focus.index - 1)
        return changeFocus({ zone: 'series-season', index: focus.index - 1 })
      }
      if (action === 'right') {
        const index = Math.min(counts.length - 1, focus.index + 1)
        setSeriesSeason(index)
        return changeFocus({ zone: 'series-season', index })
      }
      if (action === 'down') return changeFocus({ zone: 'episode', index: resumeIndex })
      return
    }
    if (focus.zone === 'episode') {
      if (action === 'left') {
        return changeFocus(relations.length ? { zone: 'relation', index: 0 } : { zone: 'nav', index: activeNav })
      }
      if (action === 'up') return changeFocus(focus.index > 0 ? { zone: 'episode', index: focus.index - 1 } : { zone: 'series-season', index: activeSeason })
      if (action === 'down') return changeFocus({ zone: 'episode', index: Math.min(episodeCount - 1, focus.index + 1) })
      return
    }
    if (focus.zone === 'relation') {
      if (action === 'left') {
        if (focus.index === 0) return changeFocus({ zone: 'nav', index: activeNav })
        return changeFocus({ zone: 'relation', index: focus.index - 1 })
      }
      if (action === 'right') {
        if (focus.index < relations.length - 1) return changeFocus({ zone: 'relation', index: focus.index + 1 })
        return changeFocus({ zone: 'episode', index: resumeIndex })
      }
      if (action === 'up') return changeFocus({ zone: 'series-season', index: activeSeason })
      if (action === 'down') return changeFocus({ zone: 'episode', index: resumeIndex })
    }
  }

  const moveBrowseFocus = (action: RemoteAction) => {
    const items = browseItemsFor(screen)
    if (focus.zone === 'nav') {
      if (action === 'up') changeFocus({ zone: 'nav', index: Math.max(-1, focus.index - 1) })
      else if (action === 'down') changeFocus({ zone: 'nav', index: Math.min(6, focus.index + 1) })
      else if (action === 'right' && items.length) {
        changeFocus({ zone: 'grid', index: 0 })
        setSelected(items[0])
      }
      return
    }
    if (focus.zone !== 'grid') return
    const columns = 7
    let index = focus.index
    if (action === 'left') {
      if (index % columns === 0) return changeFocus({ zone: 'nav', index: activeNav })
      index -= 1
    } else if (action === 'right') index = Math.min(items.length - 1, index + 1)
    else if (action === 'up') index = Math.max(0, index - columns)
    else if (action === 'down') index = Math.min(items.length - 1, index + columns)
    changeFocus({ zone: 'grid', index })
    if (items[index]) setSelected(items[index])
  }

  const applySearchKey = (index: number) => {
    const key = SEARCH_KEYS[index]
    if (!key) return
    if (key === 'DELETE') setSearchQuery((value) => value.slice(0, -1))
    else if (key === 'CLEAR') setSearchQuery('')
    else if (key === 'SPACE') setSearchQuery((value) => `${value} `)
    else setSearchQuery((value) => `${value}${key}`.slice(0, 32))
  }

  const applySearchSuggestion = (index: number) => {
    const suggestion = searchSuggestions[index]
    if (!suggestion) return
    setSearchQuery(suggestion)
    changeFocus({ zone: 'grid', index: 0 })
  }

  const moveSearchFocus = (action: RemoteAction) => {
    if (focus.zone === 'nav') {
      if (action === 'up') changeFocus({ zone: 'nav', index: Math.max(-1, focus.index - 1) })
      else if (action === 'down') changeFocus({ zone: 'nav', index: Math.min(6, focus.index + 1) })
      else if (action === 'right') changeFocus({ zone: 'keyboard', index: 0 })
      return
    }
    if (focus.zone === 'keyboard') {
      const columns = 6
      let index = focus.index
      if (action === 'left') {
        if (index % columns === 0) return changeFocus({ zone: 'nav', index: activeNav })
        index -= 1
      } else if (action === 'right') index = Math.min(SEARCH_KEYS.length - 1, index + 1)
      else if (action === 'up') index = Math.max(0, index - columns)
      else if (action === 'down') {
        if (index + columns >= SEARCH_KEYS.length && searchSuggestions.length) return changeFocus({ zone: 'suggestion', index: 0 })
        if (index + columns >= SEARCH_KEYS.length && searchResults.length) return changeFocus({ zone: 'grid', index: 0 })
        index = Math.min(SEARCH_KEYS.length - 1, index + columns)
      }
      return changeFocus({ zone: 'keyboard', index })
    }
    if (focus.zone === 'suggestion') {
      if (action === 'left') return changeFocus({ zone: 'nav', index: activeNav })
      if (action === 'right' && searchResults.length) return changeFocus({ zone: 'grid', index: 0 })
      if (action === 'up') {
        if (focus.index === 0) return changeFocus({ zone: 'keyboard', index: SEARCH_KEYS.length - 1 })
        return changeFocus({ zone: 'suggestion', index: focus.index - 1 })
      }
      if (action === 'down') {
        if (focus.index < searchSuggestions.length - 1) return changeFocus({ zone: 'suggestion', index: focus.index + 1 })
        if (searchResults.length) return changeFocus({ zone: 'grid', index: 0 })
      }
      return
    }
    if (focus.zone === 'grid') {
      const columns = 5
      let index = focus.index
      if (action === 'left') {
        if (index % columns === 0) return changeFocus({ zone: 'keyboard', index: Math.min(SEARCH_KEYS.length - 1, 5) })
        index -= 1
      } else if (action === 'right') index = Math.min(searchResults.length - 1, index + 1)
      else if (action === 'up') {
        if (index < columns && searchSuggestions.length) return changeFocus({ zone: 'suggestion', index: Math.min(searchSuggestions.length - 1, index) })
        if (index < columns) return changeFocus({ zone: 'keyboard', index: Math.min(SEARCH_KEYS.length - 1, 24 + index) })
        index -= columns
      } else if (action === 'down') index = Math.min(searchResults.length - 1, index + columns)
      changeFocus({ zone: 'grid', index })
      if (searchResults[index]) setSelected(searchResults[index])
    }
  }

  const runSettingsAction = (index: number) => {
    if (!settingsConfirmation) {
      setSettingsConfirmation(index === 0 ? 'unpair' : 'reset')
      changeFocus({ zone: 'setting', index: 0 })
      return
    }
    if (index === 0) {
      setSettingsConfirmation(null)
      changeFocus({ zone: 'setting', index: settingsConfirmation === 'unpair' ? 0 : 1 })
      return
    }
    if (settingsConfirmation === 'unpair') receiverRef.current?.unpair()
    else {
      receiverRef.current?.resetClient()
      setSearchQuery('')
      const defaults = sourceSubtitlePreferences()
      subtitlePreferencesRef.current = defaults
      setSubtitlePreferences(defaults)
    }
    setSnapshot(emptySnapshot)
    setSelected(fallbackMedia)
    setSettingsConfirmation(null)
    setScreen('ready')
  }

  const moveSettingsFocus = (action: RemoteAction) => {
    if (settingsConfirmation) {
      if (action === 'left') changeFocus({ zone: 'setting', index: 0 })
      else if (action === 'right') changeFocus({ zone: 'setting', index: 1 })
      else if (action === 'back') runSettingsAction(0)
      return
    }
    if (focus.zone === 'nav') {
      if (action === 'up') changeFocus({ zone: 'nav', index: Math.max(-1, focus.index - 1) })
      else if (action === 'down') changeFocus({ zone: 'nav', index: Math.min(6, focus.index + 1) })
      else if (action === 'right') changeFocus({ zone: 'setting', index: 0 })
    } else if (focus.zone === 'setting') {
      if (action === 'left') changeFocus({ zone: 'nav', index: activeNav })
      else if (action === 'up') changeFocus({ zone: 'setting', index: Math.max(0, focus.index - 1) })
      else if (action === 'down') changeFocus({ zone: 'setting', index: Math.min(1, focus.index + 1) })
    }
  }

  const handleRemote = (action: RemoteAction) => {
    if (exitConfirmation) {
      if (action === 'left' || action === 'up') setExitFocus(0)
      else if (action === 'right' || action === 'down') setExitFocus(1)
      else if (action === 'select') exitFocus === 0 ? setExitConfirmation(false) : exitApplication()
      else if (action === 'back') setExitConfirmation(false)
      return
    }
    if (trailerOpen) {
      if (action === 'back' || action === 'stop') setTrailerOpen(false)
      else {
        const trailerAction: TrailerControlAction | undefined = action === 'select' || action === 'playPause'
          ? 'toggle'
          : action === 'play'
            ? 'play'
            : action === 'pause'
              ? 'pause'
              : action === 'left' || action === 'rewind'
                ? 'seek-back'
                : action === 'right' || action === 'fastForward'
                  ? 'seek-forward'
                  : undefined
        if (trailerAction) window.dispatchEvent(new CustomEvent<TrailerControlAction>(TRAILER_CONTROL_EVENT, { detail: trailerAction }))
      }
      return
    }
    if (screen === 'home') {
      if (catalogMenuOpen) {
        if (action === 'up' || action === 'down') {
          const offset = action === 'up' ? -1 : 1
          const index = Math.max(0, Math.min(catalogOptions.length - 1, catalogMenuFocus + offset))
          setCatalogMenuFocus(index)
          changeFocus({ zone: 'catalog', index })
        } else if (action === 'select') selectCatalogOption(catalogMenuFocus)
        else if (action === 'left' || action === 'back') closeCatalogMenu()
        else if (action === 'right') {
          setCatalogMenuOpen(false)
          changeFocus(lastHomeContentFocusRef.current)
        }
        return
      }
      if (['up', 'down', 'left', 'right'].includes(action)) moveHomeFocus(action)
      else if (action === 'select') activateCurrentFocus()
      else if (action === 'back') requestExit()
      return
    }
    if (screen === 'search') {
      if (['up', 'down', 'left', 'right'].includes(action)) moveSearchFocus(action)
      else if (action === 'select') {
        if (focus.zone === 'nav') selectNav(focus.index)
        else if (focus.zone === 'keyboard') applySearchKey(focus.index)
        else if (focus.zone === 'suggestion') applySearchSuggestion(focus.index)
        else if (focus.zone === 'grid' && searchResults[focus.index]) selectCatalogMedia(searchResults[focus.index])
      } else if (action === 'back') selectNav(0)
      return
    }
    if (screen === 'series') {
      if (['up', 'down', 'left', 'right'].includes(action)) moveSeriesFocus(action)
      else if (action === 'select') {
        if (focus.zone === 'nav') selectNav(focus.index)
        else if (focus.zone === 'series-action') {
          setTrailerOpen(true)
        }
        else if (focus.zone === 'series-season') changeFocus({ zone: 'episode', index: 0 })
        else if (focus.zone === 'episode') playSeriesEpisode(focus.index)
        else if (focus.zone === 'relation') {
          const relation = selected.relations?.[focus.index]
          if (relation) selectRelatedMedia(relation.media)
        }
      } else if (action === 'back') selectNav(0)
      return
    }
    if (['trending', 'movies', 'my-list'].includes(screen)) {
      if (['up', 'down', 'left', 'right'].includes(action)) moveBrowseFocus(action)
      else if (action === 'select') {
        if (focus.zone === 'nav') selectNav(focus.index)
        else if (focus.zone === 'grid') {
          const media = browseItemsFor(screen)[focus.index]
          if (media) selectCatalogMedia(media)
        }
      } else if (action === 'back') selectNav(0)
      return
    }
    if (screen === 'settings') {
      if (['up', 'down', 'left', 'right'].includes(action)) moveSettingsFocus(action)
      else if (action === 'select') {
        if (!settingsConfirmation && focus.zone === 'nav') selectNav(focus.index)
        else if (focus.zone === 'setting') runSettingsAction(focus.index)
      } else if (action === 'back') settingsConfirmation ? runSettingsAction(0) : selectNav(0)
      return
    }
    if (screen === 'details') {
      if (action === 'left') changeFocus({ zone: 'detail', index: 0 })
      else if (action === 'right') changeFocus({ zone: 'detail', index: 1 })
      else if (action === 'select' && focus.zone === 'detail') focus.index === 0 ? playMedia(selected) : closeDetails()
      else if (action === 'back') closeDetails()
      return
    }
    if (screen === 'player') {
      revealPlayerControls(playerRef.current.state !== 'playing' || playerToolsActive || Boolean(playerMenu))
      if (playerMenu) {
        if (action === 'up') setPlayerMenuFocus((index) => Math.max(0, index - 1))
        else if (action === 'down') setPlayerMenuFocus((index) => Math.min(Math.max(0, playerMenuLength - 1), index + 1))
        else if (action === 'select') activatePlayerMenuItem()
        else if (action === 'left' || action === 'back') setPlayerMenu(null)
        return
      }
      if (action === 'down') setPlayerToolsActive(true)
      else if (action === 'up') setPlayerToolsActive(false)
      else if (action === 'left') playerToolsActive
        ? setPlayerControlFocus((index) => Math.max(0, index - 1))
        : seekFromRemote(-10)
      else if (action === 'right') playerToolsActive
        ? setPlayerControlFocus((index) => Math.min(3, index + 1))
        : seekFromRemote(10)
      else if (action === 'rewind') seekFromRemote(-10)
      else if (action === 'fastForward') seekFromRemote(10)
      else if (action === 'select') playerToolsActive ? activatePlayerControl(playerControlFocus) : togglePlayback()
      else if (action === 'pause' || action === 'playPause' && playerRef.current.state === 'playing') {
        avplayRef.current.pause()
        updatePlayer({ state: 'paused' })
        publishStatus(true)
      } else if (action === 'play' || action === 'playPause') {
        avplayRef.current.play()
        updatePlayer({ state: 'playing' })
        publishStatus(true)
      } else if (action === 'back' || action === 'stop') stopPlayback('home')
      return
    }
    if (screen === 'loading') {
      if (action === 'back' || action === 'stop') stopPlayback('home')
      return
    }
    if (screen === 'error') {
      if (action === 'back') setScreen(paired ? 'home' : 'ready')
      else if (action === 'select') activeLoadRef.current ? void startAvPlay(activeLoadRef.current) : setScreen(paired ? 'home' : 'ready')
      return
    }
    if (screen === 'ready') {
      if (action === 'back') requestExit()
      return
    }
    if (action === 'back') requestExit()
  }

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const action = remoteAction(event)
      if (!action) return
      event.preventDefault()
      handleRemote(action)
    }
    window.addEventListener('keydown', onKeyDown, false)
    return () => window.removeEventListener('keydown', onKeyDown, false)
  })

  const previewScreen = (next: ScreenName) => {
    if (simulationTimerRef.current) window.clearTimeout(simulationTimerRef.current)
    setCatalogMenuOpen(false)
    setTrailerOpen(false)
    if (next === 'home') {
      setActiveNav(0)
      setSelected(snapshot.hero ?? snapshot.rows[0]?.items[0] ?? fallbackMedia)
      lastHomeContentFocusRef.current = { zone: 'hero', index: 0 }
      changeFocus({ zone: 'hero', index: 0 })
    }
    if (next === 'search') {
      setActiveNav(1)
      changeFocus({ zone: 'keyboard', index: 0 })
    }
    if (['trending', 'series', 'movies', 'my-list'].includes(next)) {
      const navIndex = next === 'trending' ? 2 : next === 'series' ? 3 : next === 'movies' ? 4 : 5
      const items = browseItemsFor(next)
      setActiveNav(navIndex)
      setSelected(items[0] ?? fallbackMedia)
      if (next === 'series') {
        setSeriesSeason(0)
        changeFocus({ zone: 'series-season', index: 0 })
      } else changeFocus({ zone: 'grid', index: 0 })
    }
    if (next === 'settings') {
      setActiveNav(6)
      setSettingsConfirmation(null)
      changeFocus({ zone: 'setting', index: 0 })
    }
    if (next === 'loading') setLoadingProgress(34)
    if (next === 'player') {
      setPlayerControlFocus(0)
      setPlayerToolsActive(false)
      setPlayerMenu(null)
      setPlayerControlsVisible(true)
      if (activeSubtitleRef.current !== 'off') setSubtitleText('Even the smallest journey can change the world.')
      updatePlayer({ title: selected.title, state: 'playing', duration: player.duration || 1_422 })
    }
    setScreen(next)
  }

  return (
    <div class={`app-shell screen-${screen}${safeArea ? ' show-safe-area' : ''}`}>
      {screen === 'home' && (
        <HomeScreen
          snapshot={snapshot}
          hero={selected}
          focus={focus}
          activeNav={activeNav}
          catalogOpen={catalogMenuOpen}
          catalogFocus={catalogMenuFocus}
          notice={notice}
          onFocus={changeFocus}
          onNav={selectNav}
          onPlay={playMedia}
          onOpenSeries={selectCatalogMedia}
          onDetails={openDetails}
          onCatalogFocus={(index) => {
            setCatalogMenuFocus(index)
            changeFocus({ zone: 'catalog', index })
          }}
          onCatalogSelect={selectCatalogOption}
          onCatalogClose={closeCatalogMenu}
        />
      )}
      {screen === 'details' && (
        <DetailScreen
          media={selected}
          focus={focus}
          onFocus={(index) => changeFocus({ zone: 'detail', index })}
          onPlay={playMedia}
          onClose={closeDetails}
        />
      )}
      {screen === 'search' && (
        <SearchScreen
          query={searchQuery}
          suggestions={searchSuggestions}
          results={searchResults}
          loading={searchPending}
          error={searchError}
          focus={focus}
          activeNav={activeNav}
          onNav={selectNav}
          onNavFocus={(index) => changeFocus({ zone: 'nav', index })}
          onKey={applySearchKey}
          onKeyFocus={(index) => changeFocus({ zone: 'keyboard', index })}
          onSuggestion={applySearchSuggestion}
          onSuggestionFocus={(index) => changeFocus({ zone: 'suggestion', index })}
          onResultFocus={(index) => {
            changeFocus({ zone: 'grid', index })
            if (searchResults[index]) setSelected(searchResults[index])
          }}
          onResultSelect={selectCatalogMedia}
        />
      )}
      {screen === 'series' && (
        <SeriesScreen
          selected={selected}
          season={seriesSeason}
          focus={focus}
          activeNav={activeNav}
          onNav={selectNav}
          onNavFocus={(index) => changeFocus({ zone: 'nav', index })}
          onSeasonFocus={(index) => changeFocus({ zone: 'series-season', index })}
          onSeasonSelect={(index) => {
            setSeriesSeason(index)
            changeFocus({ zone: 'episode', index: 0 })
          }}
          onEpisodeFocus={(index) => changeFocus({ zone: 'episode', index })}
          onEpisodePlay={playSeriesEpisode}
          onRelationFocus={(index) => changeFocus({ zone: 'relation', index })}
          onRelationSelect={selectRelatedMedia}
          trailerOpen={trailerOpen}
          onTrailerFocus={() => changeFocus({ zone: 'series-action', index: 0 })}
          onTrailerOpen={() => setTrailerOpen(true)}
          onTrailerClose={() => setTrailerOpen(false)}
        />
      )}
      {(['trending', 'movies', 'my-list'] as const).map((name) => screen === name && (
        <CatalogScreen
          mode={name}
          title={name === 'trending' ? 'Trending Now' : name === 'movies' ? 'Movies' : 'My List'}
          description={name === 'trending' ? 'The titles viewers are discovering right now.' : name === 'movies' ? 'Feature-length stories for tonight.' : 'Saved and in-progress titles from your Izumi library.'}
          items={browseItemsFor(name)}
          selected={selected}
          focus={focus}
          activeNav={activeNav}
          onNav={selectNav}
          onNavFocus={(index) => changeFocus({ zone: 'nav', index })}
          onFocus={(index) => {
            changeFocus({ zone: 'grid', index })
            const media = browseItemsFor(name)[index]
            if (media) setSelected(media)
          }}
          onSelect={selectCatalogMedia}
          key={name}
        />
      ))}
      {screen === 'settings' && (
        <SettingsScreen
          focus={focus}
          activeNav={activeNav}
          paired={paired}
          connected={connected}
          deviceId={pairing?.deviceId}
          confirmation={settingsConfirmation}
          onNav={selectNav}
          onNavFocus={(index) => changeFocus({ zone: 'nav', index })}
          onFocus={(index) => changeFocus({ zone: 'setting', index })}
          onAction={runSettingsAction}
        />
      )}
      {screen === 'ready' && (
        <ReadyScreen
          connected={connected}
          qrCode={qrCode}
          address={pairing?.address ?? location.hostname}
          pairingCode={pairing ? `${pairing.challenge.slice(0, 3)} ${pairing.challenge.slice(3, 6)}`.toUpperCase() : ''}
          expiresAt={pairing?.expiresAt}
          posters={Array.from(new Set(snapshot.rows.flatMap((row) => row.items.map((item) => item.poster).filter(Boolean) as string[]))).slice(0, 12)}
        />
      )}
      {screen === 'loading' && (
        <LoadingScreen
          title={player.title}
          progress={loadingProgress}
          contentRating={activeLoadRef.current?.contentRating ?? (selected.title === player.title ? selected.contentRating : undefined)}
        />
      )}
      {screen === 'player' && (
        <PlayerScreen
          {...player}
          controlFocus={playerControlFocus}
          controlsFocused={playerToolsActive}
          menu={playerMenu}
          menuFocus={playerMenuFocus}
          sourceChoices={sourceChoices}
          activeSourceId={activeSourceId}
          deviceSourceChangeAvailable={deviceSourceChangeAvailable}
          audioTracks={audioTracks}
          subtitleChoices={subtitleChoices}
          activeAudio={activeAudio}
          activeSubtitle={activeSubtitle}
          subtitleText={subtitleText}
          subtitlePreferences={subtitlePreferences}
          previewBackdrop={showPreviewTools ? selected.backdrop || selected.poster : undefined}
          controlsVisible={playerControlsVisible}
          onControlFocus={(index) => {
            setPlayerControlFocus(index)
            setPlayerToolsActive(true)
            revealPlayerControls(true)
          }}
          onControl={activatePlayerControl}
          onMenuFocus={setPlayerMenuFocus}
          onSource={selectPlaybackSource}
          onDeviceSources={() => void requestLinkedDeviceSources()}
          onAudio={selectAudioTrack}
          onSubtitle={selectSubtitleChoice}
          onAppearance={changeSubtitleAppearance}
        />
      )}
      {screen === 'error' && <ErrorScreen message={errorMessage} onRetry={() => activeLoadRef.current ? void startAvPlay(activeLoadRef.current) : setScreen('home')} />}
      {navigationPhase !== 'idle' && ['home', 'search', 'trending', 'series', 'movies', 'my-list', 'settings'].includes(screen) && (
        <NavigationSkeleton screen={screen} leaving={navigationPhase === 'leaving'} />
      )}
      {exitConfirmation && (
        <ExitConfirmation
          focus={exitFocus}
          onFocus={setExitFocus}
          onCancel={() => setExitConfirmation(false)}
          onExit={exitApplication}
        />
      )}
      {showPreviewTools && (
        <PreviewToolbar
          screen={screen}
          safeArea={safeArea}
          onScreen={previewScreen}
          onRemote={handleRemote}
          onSafeArea={() => setSafeArea((value) => !value)}
        />
      )}
      {safeArea && <div class="safe-area-guide" aria-hidden="true" />}
    </div>
  )
}
