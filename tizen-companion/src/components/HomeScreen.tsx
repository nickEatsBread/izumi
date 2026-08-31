import { History, Info, Play, TrendingUp } from 'lucide-preact'
import wordmark from '../../../brand/svg/izumi-wordmark-white.svg'
import type { CompanionCatalogOption, CompanionHomeSnapshot, CompanionMedia, FocusLocation } from '../types'
import { NavRail } from './NavRail'

interface HomeScreenProps {
  snapshot: CompanionHomeSnapshot
  hero: CompanionMedia
  focus: FocusLocation
  activeNav: number
  catalogOpen: boolean
  catalogFocus: number
  notice?: string
  onFocus(focus: FocusLocation): void
  onNav(index: number): void
  onPlay(media: CompanionMedia): void
  onOpenSeries(media: CompanionMedia): void
  onDetails(media: CompanionMedia): void
  onCatalogFocus(index: number): void
  onCatalogSelect(index: number): void
  onCatalogClose(): void
}

function focusClass(focused: boolean): string {
  return focused ? ' is-focused' : ''
}

function episodeLabel(media: CompanionMedia): string {
  if (!media.episode) return ''
  return media.season ? `S${media.season} E${media.episode}` : `Episode ${media.episode}`
}

function minutesRemaining(media: CompanionMedia): number | undefined {
  if (!media.episodeRuntimeMinutes || !media.episodeProgress) return undefined
  return Math.max(1, Math.ceil(media.episodeRuntimeMinutes * (1 - media.episodeProgress)))
}

export function HomeScreen({
  snapshot,
  hero,
  focus,
  activeNav,
  catalogOpen,
  catalogFocus,
  notice,
  onFocus,
  onNav,
  onPlay,
  onOpenSeries,
  onDetails,
  onCatalogFocus,
  onCatalogSelect,
  onCatalogClose,
}: HomeScreenProps) {
  const catalogOptions: CompanionCatalogOption[] = snapshot.catalog.options?.length
    ? snapshot.catalog.options
    : [{ screen: snapshot.catalog.screen, label: snapshot.catalog.label }]
  const meta = [hero.subtitle, hero.contentRating].filter(Boolean).join('  ·  ')
  const isContinueHero = hero.placement?.kind === 'continue'
  const ReasonIcon = isContinueHero ? History : TrendingUp
  const heroEpisodeProgress = Math.min(1, Math.max(0, hero.episodeProgress ?? 0))
  const heroMinutesRemaining = minutesRemaining(hero)
  const reason = hero.placement
    ? `${hero.placement.position ? `#${hero.placement.position} in ` : ''}${hero.placement.label}`
    : snapshot.catalog.label
  const heroKey = `${hero.ref.provider}-${hero.ref.id}`

  return (
    <main class="home-screen">
      <NavRail
        activeIndex={activeNav}
        focus={focus}
        catalogLabel={snapshot.catalog.label}
        expanded={catalogOpen}
        onFocus={(index) => onFocus({ zone: 'nav', index })}
        onSelect={onNav}
      />

      {catalogOpen && (
        <>
          <button type="button" class="catalog-picker-scrim" aria-label="Close catalogue picker" onClick={onCatalogClose} />
          <section class="catalog-picker" aria-label="Choose catalogue">
            <p>Catalogue</p>
            <h2>Choose what izumi shows</h2>
            <div class="catalog-picker-options">
              {catalogOptions.map((option, index) => {
                const selectedOption = option.screen === snapshot.catalog.screen
                const focusedOption = focus.zone === 'catalog' && catalogFocus === index
                return (
                  <button
                    type="button"
                    class={`${selectedOption ? 'is-selected' : ''}${focusedOption ? ' is-focused' : ''}`}
                    data-focus-id={`catalog-${index}`}
                    tabIndex={focusedOption ? 0 : -1}
                    aria-pressed={selectedOption}
                    onFocus={() => onCatalogFocus(index)}
                    onMouseEnter={() => onCatalogFocus(index)}
                    onClick={() => onCatalogSelect(index)}
                    key={option.screen}
                  >
                    <span>{option.label}</span>
                    {selectedOption && <small>Current</small>}
                  </button>
                )
              })}
            </div>
            <small>The paired izumi client supplies these catalogues.</small>
          </section>
        </>
      )}

      <section class="hero" aria-label={`Featured: ${hero.title}`}>
        <img class="hero-brand" src={wordmark} alt="Izumi" />
        <div class="hero-art-stage" key={heroKey}>
          {(hero.episodeImage || hero.backdrop || hero.poster) && <img class="hero-backdrop" src={hero.episodeImage || hero.backdrop || hero.poster} alt="" />}
        </div>
        <div class="hero-shade" />
        <div class="hero-copy" key={`copy-${heroKey}`}>
          <p class="hero-eyebrow"><ReasonIcon size={17} aria-hidden="true" />{reason}</p>
          <h1>{hero.title}</h1>
          {isContinueHero && hero.episode && (
            <div class="hero-resume">
              <p><strong>{episodeLabel(hero)}</strong>{hero.episodeTitle && <span>{hero.episodeTitle}</span>}</p>
              <div class="hero-resume-status">
                <span class="hero-resume-track"><span style={{ width: `${Math.round(heroEpisodeProgress * 100)}%` }} /></span>
                <small>{heroMinutesRemaining ? `${heroMinutesRemaining} min left` : `${Math.round(heroEpisodeProgress * 100)}% watched`}</small>
              </div>
            </div>
          )}
          {meta && <p class="hero-meta">{meta}</p>}
          <p class="hero-description">{hero.description || 'Pick up where you left off, or find something new to watch.'}</p>
          {focus.zone === 'hero' && <div class="hero-actions">
            <button
              type="button"
              class={`hero-button primary${focusClass(focus.zone === 'hero' && focus.index === 0)}`}
              data-focus-id="hero-0"
              tabIndex={focus.zone === 'hero' && focus.index === 0 ? 0 : -1}
              onFocus={() => onFocus({ zone: 'hero', index: 0 })}
              onMouseEnter={() => onFocus({ zone: 'hero', index: 0 })}
              onClick={() => onPlay(hero)}
            >
              <Play size={25} fill="currentColor" aria-hidden="true" />
              {hero.progress ? 'Resume' : 'Play'}
            </button>
            <button
              type="button"
              class={`hero-button secondary${focusClass(focus.zone === 'hero' && focus.index === 1)}`}
              data-focus-id="hero-1"
              tabIndex={focus.zone === 'hero' && focus.index === 1 ? 0 : -1}
              onFocus={() => onFocus({ zone: 'hero', index: 1 })}
              onMouseEnter={() => onFocus({ zone: 'hero', index: 1 })}
              onClick={() => onDetails(hero)}
            >
              <Info size={25} aria-hidden="true" />
              More Info
            </button>
          </div>}
        </div>
      </section>

      <div class="catalog-rows">
        {snapshot.rows.map((row, rowIndex) => {
          const activeRow = focus.zone === 'row' ? focus.row : 0
          const topTenRow = row.presentation === 'top-10'
          return (
          <section class={`media-row${row.kind === 'continue' ? ' continue-row' : ''}${topTenRow ? ' top-ten-row' : ''}${rowIndex > activeRow ? ' is-upcoming' : ''}`} key={row.id} aria-labelledby={`row-title-${row.id}`}>
            <h2 id={`row-title-${row.id}`}>{row.title}</h2>
            <div class="media-strip">
              {row.items.map((item, index) => {
                const focused = focus.zone === 'row' && focus.row === rowIndex && focus.index === index
                const episodeCard = row.kind === 'continue'
                const cardProgress = episodeCard ? item.episodeProgress : item.progress
                const inProgress = typeof cardProgress === 'number' && cardProgress > 0 && cardProgress < 1
                const itemMinutesRemaining = minutesRemaining(item)
                const image = episodeCard ? item.episodeImage || item.backdrop || item.poster : item.poster
                const rank = topTenRow ? item.placement?.position ?? index + 1 : undefined
                return (
                  <button
                    type="button"
                    class={`media-card${episodeCard ? ' continue-card' : ''}${topTenRow ? ' top-ten-card' : ''}${inProgress ? ' has-progress' : ''}${focusClass(focused)}`}
                    key={`${item.ref.provider}-${item.ref.id}`}
                    data-focus-id={`row-${rowIndex}-${index}`}
                    tabIndex={focused ? 0 : -1}
                    aria-label={`${rank ? `Number ${rank}, ` : ''}${item.title}${item.episode ? `, episode ${item.episode}` : ''}`}
                    onFocus={() => onFocus({ zone: 'row', row: rowIndex, index })}
                    onMouseEnter={() => onFocus({ zone: 'row', row: rowIndex, index })}
                    onClick={() => episodeCard ? onPlay(item) : onOpenSeries(item)}
                  >
                    {rank && <span class="top-ten-rank" aria-hidden="true">{rank}</span>}
                    {image
                      ? <img src={image} alt="" loading={rowIndex > 0 ? 'lazy' : 'eager'} />
                      : <span class="media-card-placeholder">{item.title}</span>}
                    <span class="media-card-fade" />
                    {episodeCard
                      ? (
                        <span class="episode-card-copy">
                          <small>{item.title}</small>
                          <strong>{item.episodeTitle || (item.episode ? `Episode ${item.episode}` : 'Continue watching')}</strong>
                          <span class="episode-card-meta">
                            {episodeLabel(item) && <b>{episodeLabel(item)}</b>}
                            {itemMinutesRemaining && <small>{itemMinutesRemaining} min left</small>}
                          </span>
                        </span>
                      )
                      : <span class="media-card-title">{item.title}</span>}
                    {inProgress && (
                      <span class="media-progress"><span style={{ width: `${Math.round(cardProgress! * 100)}%` }} /></span>
                    )}
                  </button>
                )
              })}
            </div>
          </section>
          )
        })}
      </div>
      {notice && <div class="toast" role="status">{notice}</div>}
    </main>
  )
}
