import {
  Bookmark,
  Captions,
  ChevronRight,
  Delete,
  Film,
  History,
  Link2Off,
  Pause,
  Play,
  RotateCcw,
  Search,
  ShieldCheck,
  Space,
  TrendingUp,
  Tv,
  X,
} from 'lucide-preact'
import { useEffect, useRef, useState } from 'preact/hooks'
import type { CompanionMedia, FocusLocation } from '../types'
import { episodeCountsFor, episodeDetailsFor, seasonNumberFor } from '../lib/catalog'
import { NavRail } from './NavRail'

export type TrailerControlAction = 'toggle' | 'play' | 'pause' | 'seek-back' | 'seek-forward'
export const TRAILER_CONTROL_EVENT = 'izumi:trailer-control'

type TrailerPlaybackState = 'buffering' | 'playing' | 'paused' | 'ended'

function trailerTime(value: number): string {
  const seconds = Math.max(0, Math.floor(value))
  const minutes = Math.floor(seconds / 60)
  return `${minutes}:${String(seconds % 60).padStart(2, '0')}`
}

function TrailerPlayer({
  videoId,
  title,
  backdrop,
  onClose,
}: {
  videoId: string
  title: string
  backdrop?: string
  onClose(): void
}) {
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const hitAreaRef = useRef<HTMLButtonElement>(null)
  const hideTimerRef = useRef<number>()
  const positionRef = useRef(0)
  const durationRef = useRef(0)
  const playbackRef = useRef<TrailerPlaybackState>('buffering')
  const [playback, setPlayback] = useState<TrailerPlaybackState>('buffering')
  const [position, setPosition] = useState(0)
  const [duration, setDuration] = useState(0)
  const [controlsVisible, setControlsVisible] = useState(true)
  const [nativeCoverVisible, setNativeCoverVisible] = useState(true)

  const post = (payload: Record<string, unknown>) => {
    iframeRef.current?.contentWindow?.postMessage(JSON.stringify(payload), '*')
  }
  const send = (func: string, args: unknown[] = []) => post({ event: 'command', func, args })

  const applyPlayback = (next: TrailerPlaybackState) => {
    playbackRef.current = next
    setPlayback(next)
    if (next === 'playing') setNativeCoverVisible(false)
    else if (next === 'ended') setNativeCoverVisible(true)
  }

  const revealControls = (keepVisible = false) => {
    if (hideTimerRef.current) window.clearTimeout(hideTimerRef.current)
    setControlsVisible(true)
    if (!keepVisible) hideTimerRef.current = window.setTimeout(() => setControlsVisible(false), 3000)
  }

  const requestEnglishCaptions = () => {
    send('setOption', ['captions', 'track', { languageCode: 'en' }])
    send('setOption', ['captions', 'reload', true])
  }

  const toggle = () => {
    if (playbackRef.current === 'playing') {
      send('pauseVideo')
      applyPlayback('paused')
      revealControls(true)
    } else {
      if (playbackRef.current === 'ended') send('seekTo', [0, true])
      send('playVideo')
      applyPlayback('buffering')
      revealControls(true)
    }
  }

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.source !== iframeRef.current?.contentWindow) return
      let payload: { event?: string; info?: Record<string, unknown>; data?: unknown }
      try { payload = typeof event.data === 'string' ? JSON.parse(event.data) : event.data }
      catch { return }
      if (!payload || typeof payload !== 'object') return
      if (payload.event === 'onReady') {
        requestEnglishCaptions()
        send('playVideo')
      }
      if (payload.event === 'onStateChange') {
        const state = Number(payload.info ?? payload.data)
        if (state === 1) applyPlayback('playing')
        else if (state === 2) applyPlayback('paused')
        else if (state === 0) applyPlayback('ended')
        else if (state === -1 || state === 3 || state === 5) applyPlayback('buffering')
      }
      if (payload.event === 'infoDelivery' && payload.info) {
        const nextPosition = Number(payload.info.currentTime)
        const nextDuration = Number(payload.info.duration)
        const nextState = Number(payload.info.playerState)
        if (Number.isFinite(nextPosition)) {
          positionRef.current = nextPosition
          setPosition(nextPosition)
        }
        if (Number.isFinite(nextDuration) && nextDuration > 0) {
          durationRef.current = nextDuration
          setDuration(nextDuration)
        }
        if (nextState === 1) applyPlayback('playing')
        else if (nextState === 2) applyPlayback('paused')
        else if (nextState === 0) applyPlayback('ended')
        else if (nextState === -1 || nextState === 3 || nextState === 5) applyPlayback('buffering')
      }
    }
    window.addEventListener('message', onMessage)
    const connect = window.setInterval(() => {
      post({ event: 'listening', id: 'izumi-trailer' })
      send('getCurrentTime')
      send('getDuration')
      send('getPlayerState')
    }, 500)
    const captions = window.setTimeout(requestEnglishCaptions, 1200)
    return () => {
      window.removeEventListener('message', onMessage)
      window.clearInterval(connect)
      window.clearTimeout(captions)
      if (hideTimerRef.current) window.clearTimeout(hideTimerRef.current)
    }
  }, [videoId])

  useEffect(() => {
    const onControl = (event: Event) => {
      const action = (event as CustomEvent<TrailerControlAction>).detail
      revealControls(action === 'pause')
      if (action === 'toggle') toggle()
      else if (action === 'play') {
        send('playVideo')
        applyPlayback('buffering')
      } else if (action === 'pause') {
        send('pauseVideo')
        applyPlayback('paused')
      } else {
        const offset = action === 'seek-back' ? -10 : 10
        const target = Math.max(0, Math.min(durationRef.current || Number.POSITIVE_INFINITY, positionRef.current + offset))
        positionRef.current = target
        setPosition(target)
        send('seekTo', [target, true])
      }
    }
    window.addEventListener(TRAILER_CONTROL_EVENT, onControl)
    hitAreaRef.current?.focus()
    return () => window.removeEventListener(TRAILER_CONTROL_EVENT, onControl)
  }, [])

  useEffect(() => {
    if (playback === 'playing') revealControls()
    else revealControls(true)
  }, [playback])

  const progress = duration ? Math.min(100, position / duration * 100) : 0
  const status = playback === 'paused' ? 'Paused' : playback === 'ended' ? 'Trailer ended' : playback === 'buffering' ? 'Loading trailer' : 'Trailer'
  const query = new URLSearchParams({
    autoplay: '1',
    controls: '0',
    autohide: '1',
    disablekb: '1',
    enablejsapi: '1',
    fs: '0',
    modestbranding: '1',
    showinfo: '0',
    playsinline: '1',
    rel: '0',
    iv_load_policy: '3',
    cc_load_policy: '1',
    cc_lang_pref: 'en',
    hl: 'en',
  })

  return (
    <section class="series-trailer-overlay" role="dialog" aria-modal="true" aria-label={`${title} trailer`}>
      <iframe
        ref={iframeRef}
        src={`https://www.youtube-nocookie.com/embed/${videoId}?${query}`}
        title={`${title} trailer`}
        allow="autoplay; encrypted-media"
        referrerPolicy="strict-origin-when-cross-origin"
        tabIndex={-1}
        onLoad={() => {
          post({ event: 'listening', id: 'izumi-trailer' })
          window.setTimeout(() => {
            requestEnglishCaptions()
            send('playVideo')
          }, 350)
        }}
      />
      <button ref={hitAreaRef} class="series-trailer-hit-area" type="button" tabIndex={-1} aria-label={playback === 'playing' ? 'Pause trailer' : 'Play trailer'} onClick={toggle} />
      <div class={`series-trailer-youtube-mask${playback === 'playing' ? '' : ' is-active'}`} />
      <div class={`series-trailer-native-cover${nativeCoverVisible ? ' is-visible' : ''}`} style={backdrop ? { backgroundImage: `url("${backdrop.replace(/"/g, '%22')}")` } : undefined}>
        <span><Play size={32} fill="currentColor" /></span>
      </div>
      <div class={`series-trailer-center-control${playback === 'paused' || playback === 'ended' ? ' is-visible' : ''}`}>
        <Play size={32} fill="currentColor" />
      </div>
      <div class={`series-trailer-hud${controlsVisible ? ' is-visible' : ''}`}>
        <header>
          <span class="series-trailer-state">
            {playback === 'playing' ? <Play size={20} fill="currentColor" /> : <Pause size={20} fill="currentColor" />}
          </span>
          <div><p>{status}</p><h2>{title}</h2></div>
        </header>
        <div class="series-trailer-caption"><Captions size={21} /><span><strong>English subtitles</strong><small>On</small></span></div>
        <div class="series-trailer-progress"><i style={{ width: `${progress}%` }} /></div>
        <div class="series-trailer-times"><span>{trailerTime(position)}</span><span>{duration ? trailerTime(duration) : '--:--'}</span></div>
      </div>
      <button class="series-trailer-close" type="button" onClick={onClose} aria-label="Back to series">
        <X size={22} /> Back to series
      </button>
    </section>
  )
}

export const SEARCH_KEYS = [...'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'SPACE', 'DELETE', 'CLEAR']

function MediaTile({
  item,
  index,
  focused,
  onFocus,
  onSelect,
}: {
  item: CompanionMedia
  index: number
  focused: boolean
  onFocus(index: number): void
  onSelect(media: CompanionMedia): void
}) {
  return (
    <button
      type="button"
      class={`browse-card${focused ? ' is-focused' : ''}`}
      data-focus-id={`grid-${index}`}
      tabIndex={focused ? 0 : -1}
      aria-label={item.title}
      onFocus={() => onFocus(index)}
      onMouseEnter={() => onFocus(index)}
      onClick={() => onSelect(item)}
    >
      {item.poster ? <img src={item.poster} alt="" /> : <span>{item.title}</span>}
      <span class="browse-card-shade" />
      <strong>{item.title}</strong>
      {item.placement?.position && <small>#{item.placement.position}</small>}
    </button>
  )
}

const catalogIcons = {
  trending: TrendingUp,
  series: Tv,
  movies: Film,
  'my-list': Bookmark,
}

export function CatalogScreen({
  mode,
  title,
  description,
  items,
  selected,
  focus,
  activeNav,
  onNav,
  onNavFocus,
  onFocus,
  onSelect,
}: {
  mode: keyof typeof catalogIcons
  title: string
  description: string
  items: CompanionMedia[]
  selected: CompanionMedia
  focus: FocusLocation
  activeNav: number
  onNav(index: number): void
  onNavFocus(index: number): void
  onFocus(index: number): void
  onSelect(media: CompanionMedia): void
}) {
  const Icon = catalogIcons[mode]
  const isEmpty = items.length === 0
  const contextualPlacement = mode === 'trending' || mode === 'my-list' ? selected.placement : undefined
  const reason = contextualPlacement
    ? `${contextualPlacement.position ? `#${contextualPlacement.position} in ` : ''}${contextualPlacement.label}`
    : mode === 'series' ? 'Series selected for your catalog' : mode === 'movies' ? 'Feature films' : title
  return (
    <main class="browse-screen">
      <NavRail
        activeIndex={activeNav}
        focus={focus}
        onFocus={onNavFocus}
        onSelect={onNav}
      />
      <div class={`browse-hero-art${isEmpty ? ' is-empty' : ''}`} key={`${selected.ref.provider}-${selected.ref.id}`}>
        {(selected.backdrop || selected.poster) && <img src={selected.backdrop || selected.poster} alt="" />}
        <span />
      </div>
      <header class="browse-heading">
        <p><Icon size={19} /> {isEmpty ? title : reason}</p>
        <h1>{isEmpty ? title : selected.title}</h1>
        <span>{isEmpty
          ? mode === 'movies'
            ? 'No films were supplied by this catalogue.'
            : mode === 'my-list'
              ? 'Titles you save in izumi will appear here.'
              : 'This catalogue has no titles for this section yet.'
          : selected.subtitle || description}</span>
      </header>
      <section class="browse-catalog" aria-label={title}>
        <div class="browse-title-row">
          <div><p>{mode === 'my-list' ? 'Your library' : 'Browse'}</p><h2>{title}</h2></div>
          <span>{items.length} titles</span>
        </div>
        {items.length ? <div class="browse-grid">
          {items.map((item, index) => (
            <MediaTile
              item={item}
              index={index}
              focused={focus.zone === 'grid' && focus.index === index}
              onFocus={onFocus}
              onSelect={onSelect}
              key={`${item.ref.provider}-${item.ref.id}`}
            />
          ))}
        </div> : (
          <div class="catalog-empty" role="status">
            <Icon size={34} strokeWidth={1.6} />
            <strong>{mode === 'my-list' ? 'Your list is empty' : `No ${title.toLowerCase()} available`}</strong>
            <span>Open izumi on your paired device to update this catalogue.</span>
          </div>
        )}
      </section>
    </main>
  )
}

function relationLabel(value: string): string {
  const labels: Record<string, string> = {
    SEQUEL: 'Next season',
    PREQUEL: 'Earlier story',
    PARENT: 'Main series',
    SIDE_STORY: 'Side story',
    SPIN_OFF: 'Spin-off',
    ALTERNATIVE: 'Alternate version',
    SUMMARY: 'Recap',
  }
  return labels[value] ?? value.replace(/_/g, ' ').toLowerCase().replace(/^./, (letter: string) => letter.toUpperCase())
}

export function SeriesScreen({
  selected,
  season,
  focus,
  activeNav,
  onNav,
  onNavFocus,
  onSeasonFocus,
  onSeasonSelect,
  onEpisodeFocus,
  onEpisodePlay,
  onRelationFocus,
  onRelationSelect,
  trailerOpen,
  onTrailerFocus,
  onTrailerOpen,
  onTrailerClose,
}: {
  selected: CompanionMedia
  season: number
  focus: FocusLocation
  activeNav: number
  onNav(index: number): void
  onNavFocus(index: number): void
  onSeasonFocus(index: number): void
  onSeasonSelect(index: number): void
  onEpisodeFocus(index: number): void
  onEpisodePlay(index: number): void
  onRelationFocus(index: number): void
  onRelationSelect(media: CompanionMedia): void
  trailerOpen: boolean
  onTrailerFocus(): void
  onTrailerOpen(): void
  onTrailerClose(): void
}) {
  const seasonCounts = episodeCountsFor(selected)
  const hasEpisodeMetadata = seasonCounts.length > 0
  const activeSeason = hasEpisodeMetadata ? Math.min(season, seasonCounts.length - 1) : 0
  const episodeCount = seasonCounts[activeSeason] ?? 0
  const seasonNumber = hasEpisodeMetadata ? seasonNumberFor(selected, activeSeason, seasonCounts) : selected.season ?? 1
  const episodes = hasEpisodeMetadata ? episodeDetailsFor(selected, activeSeason, seasonCounts) : []
  const resumeSeason = selected.season ?? 1
  const resumeEpisode = resumeSeason === seasonNumber && selected.episode ? selected.episode : -1
  const relations = selected.relations ?? []
  const reason = selected.placement
    ? `${selected.placement.position ? `#${selected.placement.position} in ` : ''}${selected.placement.label}`
    : 'Series in your catalog'
  const ReasonIcon = selected.placement?.kind === 'continue'
    ? History
    : selected.placement?.kind === 'ranking'
      ? TrendingUp
      : Tv
  const trailerId = (() => {
    const raw = selected.trailer?.id?.trim()
    if (!raw || (selected.trailer?.site && selected.trailer.site.toLowerCase() !== 'youtube')) return undefined
    if (/^[A-Za-z0-9_-]{6,32}$/.test(raw)) return raw
    try {
      const url = new URL(raw)
      const id = url.hostname.includes('youtu.be') ? url.pathname.slice(1) : url.searchParams.get('v') || url.pathname.split('/').filter(Boolean).pop()
      return id && /^[A-Za-z0-9_-]{6,32}$/.test(id) ? id : undefined
    } catch { return undefined }
  })()

  return (
    <main class="browse-screen series-screen">
      <NavRail activeIndex={activeNav} focus={focus} onFocus={onNavFocus} onSelect={onNav} />
      <div class="browse-hero-art series-hero-art" key={`${selected.ref.provider}-${selected.ref.id}`}>
        {(selected.backdrop || selected.poster) && <img src={selected.backdrop || selected.poster} alt="" />}
        <span />
      </div>

      <section class="series-overview">
        <p class="series-eyebrow"><ReasonIcon size={19} /> {reason}</p>
        <h1>{selected.title}</h1>
        <div class="series-meta">
            <span>{selected.subtitle || (episodeCount ? `${episodeCount} episodes` : 'Episode information pending')}</span>
          {selected.contentRating && <strong>{selected.contentRating}</strong>}
        </div>
        <p class="series-summary">{selected.description || 'Choose a season and episode to start watching.'}</p>
        {trailerId && (
          <button
            type="button"
            class={`series-trailer-action${focus.zone === 'series-action' ? ' is-focused' : ''}`}
            data-focus-id="series-action-0"
            tabIndex={focus.zone === 'series-action' ? 0 : -1}
            aria-label={`Watch ${selected.title} trailer`}
            onFocus={onTrailerFocus}
            onMouseEnter={onTrailerFocus}
            onClick={onTrailerOpen}
          >
            <Play size={21} fill="currentColor" />
            <span><strong>Play trailer</strong><small>Preview this series</small></span>
          </button>
        )}
        {resumeEpisode > 0 && (
          <div class="series-current">
            <span>Continue watching</span>
            <strong>S{resumeSeason}:E{resumeEpisode} · {selected.episodeTitle || episodes.find((episode) => episode.episode === resumeEpisode)?.title || `Episode ${resumeEpisode}`}</strong>
            {typeof selected.episodeProgress === 'number' && <div><i style={{ width: `${Math.round(selected.episodeProgress * 100)}%` }} /></div>}
          </div>
        )}

        {relations.length > 0 && (
          <section class="series-related" aria-label="More in this franchise">
            <div class="series-relation-heading">
              <h2>More in this franchise</h2>
              <span>Seasons, films and side stories</span>
            </div>
            <div class="relation-strip">
              {relations.map((relation, index) => {
                const focused = focus.zone === 'relation' && focus.index === index
                const relationMedia = relation.media
                return (
                  <button
                    type="button"
                    class={`relation-card${focused ? ' is-focused' : ''}`}
                    data-focus-id={`relation-${index}`}
                    tabIndex={focused ? 0 : -1}
                    aria-label={`${relationLabel(relation.relationType)}: ${relationMedia.title}`}
                    onFocus={() => onRelationFocus(index)}
                    onClick={() => onRelationSelect(relationMedia)}
                    key={`${relation.relationType}-${relationMedia.ref.provider}-${relationMedia.ref.id}`}
                  >
                    {(relationMedia.backdrop || relationMedia.poster) && <img src={relationMedia.backdrop || relationMedia.poster} alt="" />}
                    <span class="relation-card-shade" />
                    <span class="relation-card-copy">
                      <small>{relationLabel(relation.relationType)}</small>
                      <strong>{relationMedia.title}</strong>
                    </span>
                  </button>
                )
              })}
            </div>
          </section>
        )}
      </section>

      <aside class="series-library" aria-label={`${selected.title} episodes`}>
        <header class="series-library-header">
          <div>
            <p>{hasEpisodeMetadata ? selected.seasonLabels?.[activeSeason] ?? `Season ${seasonNumber}` : 'From your catalogue'}</p>
            <h2>Episodes</h2>
          </div>
          {hasEpisodeMetadata && <div class="season-options" aria-label="Choose season">
            {seasonCounts.map((count, index) => (
              <button
                type="button"
                class={`${index === activeSeason ? 'is-selected' : ''}${focus.zone === 'series-season' && focus.index === index ? ' is-focused' : ''}`}
                data-focus-id={`series-season-${index}`}
                tabIndex={focus.zone === 'series-season' && focus.index === index ? 0 : -1}
                aria-label={`Season ${index + 1}, ${count} episodes`}
                onFocus={() => onSeasonFocus(index)}
                onMouseEnter={() => onSeasonFocus(index)}
                onClick={() => onSeasonSelect(index)}
                key={`${selected.ref.id}-season-${index}`}
              >{selected.seasonLabels?.[index] ?? `Season ${index + 1}`}</button>
            ))}
          </div>}
        </header>

        <div class="series-library-scroll">
          {episodes.length ? <div class="series-episode-list">
          {episodes.map((episode, index) => {
            const focused = focus.zone === 'episode' && focus.index === index
            const current = seasonNumber === resumeSeason && episode.episode === resumeEpisode
            const watched = episode.watched ?? (seasonNumber === resumeSeason && episode.episode < resumeEpisode)
            const progress = episode.progress ?? (current ? selected.episodeProgress : watched ? 1 : 0)
            const title = current && selected.episodeTitle ? selected.episodeTitle : episode.title || `Episode ${episode.episode}`
            const status = current ? 'Continue watching' : watched ? 'Watched' : episode.runtimeMinutes ? `${episode.runtimeMinutes} min` : 'Not started'
            return (
              <button
                type="button"
                class={`series-episode${focused ? ' is-focused' : ''}${current ? ' is-current' : ''}`}
                data-focus-id={`episode-${index}`}
                tabIndex={focused ? 0 : -1}
                aria-label={`Play ${selected.title}, season ${seasonNumber}, episode ${episode.episode}, ${title}`}
                onFocus={() => onEpisodeFocus(index)}
                onMouseEnter={() => onEpisodeFocus(index)}
                onClick={() => onEpisodePlay(index)}
                key={`${selected.ref.id}-${seasonNumber}-${episode.episode}`}
              >
                <span class="series-episode-art">
                  {(episode.image || selected.backdrop || selected.poster) && <img src={episode.image || selected.backdrop || selected.poster} alt="" />}
                  <i>{episode.episode}</i>
                  {current && <Play size={22} fill="currentColor" />}
                </span>
                <span class="series-episode-copy">
                  <span><strong>{episode.episode}. {title}</strong>{episode.runtimeMinutes && <small>{episode.runtimeMinutes} min</small>}</span>
                  {episode.description && <p>{episode.description}</p>}
                  <em>{status}</em>
                  {typeof progress === 'number' && progress > 0 && progress < 1 && <i><b style={{ width: `${Math.round(progress * 100)}%` }} /></i>}
                </span>
              </button>
            )
          })}
          </div> : (
            <div class="series-episodes-empty" role="status">
              <Tv size={30} strokeWidth={1.6} />
              <strong>Episode information isn’t available</strong>
              <span>Refresh this title from izumi to send its seasons and episodes to the TV.</span>
            </div>
          )}
        </div>
      </aside>
      {trailerOpen && trailerId && (
        <TrailerPlayer videoId={trailerId} title={selected.title} backdrop={selected.backdrop || selected.poster} onClose={onTrailerClose} />
      )}
    </main>
  )
}

export function SearchScreen({
  query,
  suggestions,
  results,
  loading,
  error,
  focus,
  activeNav,
  onNav,
  onNavFocus,
  onKey,
  onKeyFocus,
  onSuggestion,
  onSuggestionFocus,
  onResultFocus,
  onResultSelect,
}: {
  query: string
  suggestions: string[]
  results: CompanionMedia[]
  loading: boolean
  error: string
  focus: FocusLocation
  activeNav: number
  onNav(index: number): void
  onNavFocus(index: number): void
  onKey(index: number): void
  onKeyFocus(index: number): void
  onSuggestion(index: number): void
  onSuggestionFocus(index: number): void
  onResultFocus(index: number): void
  onResultSelect(media: CompanionMedia): void
}) {
  return (
    <main class="utility-screen search-screen">
      <NavRail activeIndex={activeNav} focus={focus} onFocus={onNavFocus} onSelect={onNav} />
      <header class="utility-heading">
        <p><Search size={20} /> Find something to watch</p>
        <h1>Search</h1>
      </header>
      <div class="search-layout">
        <section class="search-entry" aria-label="On-screen keyboard">
          <div class={`search-query${query ? '' : ' is-empty'}`}>{query || 'Search anime, films and series'}</div>
          <div class="search-keyboard">
            {SEARCH_KEYS.map((key, index) => (
              <button
                type="button"
                class={`${focus.zone === 'keyboard' && focus.index === index ? 'is-focused' : ''}${key.length > 1 ? ' is-wide' : ''}`}
                data-focus-id={`keyboard-${index}`}
                tabIndex={focus.zone === 'keyboard' && focus.index === index ? 0 : -1}
                aria-label={key === 'DELETE' ? 'Delete character' : key === 'SPACE' ? 'Space' : key === 'CLEAR' ? 'Clear search' : key}
                onFocus={() => onKeyFocus(index)}
                onMouseEnter={() => onKeyFocus(index)}
                onClick={() => onKey(index)}
                key={key}
              >
                {key === 'DELETE' ? <Delete size={21} /> : key === 'SPACE' ? <Space size={21} /> : key === 'CLEAR' ? 'Clear' : key}
              </button>
            ))}
          </div>
          {suggestions.length > 0 && (
            <div class="search-suggestions" aria-label="Search suggestions" key={`suggestions-${query}`}>
              <p>{query ? 'Suggestions' : 'Try searching for'}</p>
              {suggestions.map((suggestion, index) => (
                <button
                  type="button"
                  class={focus.zone === 'suggestion' && focus.index === index ? 'is-focused' : ''}
                  data-focus-id={`suggestion-${index}`}
                  tabIndex={focus.zone === 'suggestion' && focus.index === index ? 0 : -1}
                  onFocus={() => onSuggestionFocus(index)}
                  onMouseEnter={() => onSuggestionFocus(index)}
                  onClick={() => onSuggestion(index)}
                  key={suggestion}
                >{suggestion}</button>
              ))}
            </div>
          )}
        </section>
        <section class="search-results" aria-live="polite" aria-busy={loading}>
          <div class="search-result-heading"><h2>{query ? `Titles related to “${query}”` : 'Popular searches'}</h2><span>{results.length}</span></div>
          {loading ? (
            <div class="search-result-grid search-result-loading" aria-label="Searching catalogue">
              {Array.from({ length: 10 }, (_, index) => <span class="search-result-skeleton" key={index} />)}
            </div>
          ) : error ? <p class="search-empty search-error">{error}</p> : results.length ? (
            <div class="search-result-grid" key={`results-${query}`}>
              {results.map((item, index) => (
                <MediaTile
                  item={item}
                  index={index}
                  focused={focus.zone === 'grid' && focus.index === index}
                  onFocus={onResultFocus}
                  onSelect={onResultSelect}
                  key={`${item.ref.provider}-${item.ref.id}`}
                />
              ))}
            </div>
          ) : <p class="search-empty">No matches yet. Try another title.</p>}
        </section>
      </div>
    </main>
  )
}

export type SettingsConfirmation = 'unpair' | 'reset' | null

export function DetailScreen({
  media,
  focus,
  onFocus,
  onPlay,
  onClose,
}: {
  media: CompanionMedia
  focus: FocusLocation
  onFocus(index: number): void
  onPlay(media: CompanionMedia): void
  onClose(): void
}) {
  const reason = media.placement
    ? `${media.placement.position ? `#${media.placement.position} in ` : ''}${media.placement.label}`
    : 'Selected for you'
  const ReasonIcon = media.placement?.kind === 'continue' ? History : TrendingUp
  return (
    <main class="detail-screen">
      <div class="detail-art" key={`${media.ref.provider}-${media.ref.id}`}>
        {(media.backdrop || media.poster) && <img src={media.backdrop || media.poster} alt="" />}
        <span />
      </div>
      <section class="detail-copy">
        <p class="detail-reason"><ReasonIcon size={19} /> {reason}</p>
        <h1>{media.title}</h1>
        <p class="detail-meta">{[media.subtitle, media.contentRating].filter(Boolean).join(' · ')}</p>
        <p class="detail-description">{media.description || 'Open this title to continue watching or start from the beginning.'}</p>
        <div class="detail-actions">
          <button
            type="button"
            class={focus.zone === 'detail' && focus.index === 0 ? 'is-focused' : ''}
            data-focus-id="detail-0"
            tabIndex={focus.zone === 'detail' && focus.index === 0 ? 0 : -1}
            onFocus={() => onFocus(0)}
            onMouseEnter={() => onFocus(0)}
            onClick={() => onPlay(media)}
          >
            <Play size={25} fill="currentColor" /> {media.progress ? 'Resume' : 'Play'}
          </button>
          <button
            type="button"
            class={focus.zone === 'detail' && focus.index === 1 ? 'is-focused' : ''}
            data-focus-id="detail-1"
            tabIndex={focus.zone === 'detail' && focus.index === 1 ? 0 : -1}
            onFocus={() => onFocus(1)}
            onMouseEnter={() => onFocus(1)}
            onClick={onClose}
          >
            <X size={25} /> Back to browse
          </button>
        </div>
      </section>
      {media.poster && <img class="detail-poster" src={media.poster} alt="" />}
    </main>
  )
}

const settingsOptions = [
  { title: 'Unpair this TV', detail: 'Disconnect this TV from your Izumi sync group.', icon: Link2Off },
  { title: 'Reset companion', detail: 'Remove pairing, preferences and this TV identity.', icon: RotateCcw },
]

export function SettingsScreen({
  focus,
  activeNav,
  paired,
  connected,
  deviceId,
  confirmation,
  onNav,
  onNavFocus,
  onFocus,
  onAction,
}: {
  focus: FocusLocation
  activeNav: number
  paired: boolean
  connected: boolean
  deviceId?: string
  confirmation: SettingsConfirmation
  onNav(index: number): void
  onNavFocus(index: number): void
  onFocus(index: number): void
  onAction(index: number): void
}) {
  const confirmTitle = confirmation === 'unpair' ? 'Unpair this TV?' : 'Reset the companion?'
  return (
    <main class="utility-screen settings-screen">
      <NavRail activeIndex={activeNav} focus={focus} onFocus={onNavFocus} onSelect={onNav} />
      <header class="utility-heading">
        <p><ShieldCheck size={20} /> TV companion</p>
        <h1>Settings</h1>
      </header>
      <section class="settings-panel">
        <div class="device-summary">
          <div class={`device-status-dot${connected ? ' online' : ''}`} />
          <div><p>{paired ? 'Paired with Izumi' : 'Not paired'}</p><span>{connected ? 'Receiver online' : 'Waiting for a nearby device'} · TV {deviceId?.slice(-6).toUpperCase() || 'PREVIEW'}</span></div>
        </div>
        <div class="settings-options">
          {settingsOptions.map(({ title, detail, icon: Icon }, index) => (
            <button
              type="button"
              class={focus.zone === 'setting' && focus.index === index && !confirmation ? 'is-focused' : ''}
              data-focus-id={!confirmation ? `setting-${index}` : undefined}
              tabIndex={!confirmation && focus.zone === 'setting' && focus.index === index ? 0 : -1}
              onFocus={() => onFocus(index)}
              onMouseEnter={() => onFocus(index)}
              onClick={() => onAction(index)}
              key={title}
            >
              <Icon size={28} /><span><strong>{title}</strong><small>{detail}</small></span><ChevronRight size={24} />
            </button>
          ))}
        </div>
      </section>
      {confirmation && (
        <div class="settings-confirm-backdrop">
          <section class="settings-confirm" role="dialog" aria-modal="true" aria-label={confirmTitle}>
            <h2>{confirmTitle}</h2>
            <p>{confirmation === 'unpair'
              ? 'You will need to scan a new pairing code before this TV can access your Izumi home again.'
              : 'This removes all companion data stored on the TV and creates a new TV identity.'}</p>
            <div>
              {['Cancel', confirmation === 'unpair' ? 'Unpair' : 'Reset'].map((label, index) => (
                <button
                  type="button"
                  class={focus.zone === 'setting' && focus.index === index ? 'is-focused' : ''}
                  data-focus-id={`setting-${index}`}
                  onFocus={() => onFocus(index)}
                  onClick={() => onAction(index)}
                  key={label}
                >{label}</button>
              ))}
            </div>
          </section>
        </div>
      )}
    </main>
  )
}
