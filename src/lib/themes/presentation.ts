import { NAV_DESTINATIONS, parseThemeBlock, type HomeBlock, type HomeBlockType, type NavDestination } from './block-schema'
/** Data-only presentation API. No HTML, executable expressions, selectors, or remote assets. */
export type DisplayField =
  | 'title' | 'description' | 'rank' | 'rankPosition' | 'score' | 'format' | 'year'
  | 'studio' | 'season' | 'status' | 'genres' | 'members' | 'reviews'
  | 'episodeCount' | 'episodeTitle' | 'airDate' | 'duration' | 'episodeNumber' | 'progress'
  | 'source' | 'country'
  | 'nextEpisode' | 'airingIn' | 'airingCountdown' | 'slide' | 'slides' | 'episodesAired' | 'genre'
  | 'ageRating' | 'audio' | 'timeLeft'
  | 'episodeNo' | 'episodeCode' | 'watched' | 'filler' | 'rating' | 'episodeName'
  | 'startYear' | 'genre2' | 'genre3' | 'episodesWatched'
  | 'durationLong' | 'scoreValue' | 'completed' | 'airingSoon'
  | 'starring' | 'creators'
/** Host numbers. `when.atMost` compares these; text nodes render them through `displayText`. */
export type NumericDisplayField = 'rankPosition' | 'score' | 'duration' | 'episodeNumber' | 'progress' | 'nextEpisode' | 'slide' | 'slides' | 'episodesAired' | 'episodesWatched'
/** `keyart` (API 3) is 16:9 title artwork: a TVDB background for AniList titles, a TMDB or add-on backdrop otherwise.
 *  `posterHd` (API 4) is portrait artwork at full resolution: the TVDB poster where the hero or the
 *  series header has looked it up, otherwise the catalog cover at its largest size. */
export type ArtworkKind = 'poster' | 'backdrop' | 'logo' | 'still' | 'keyart' | 'posterHd'
export type ThemeAction = 'play' | 'details' | 'favorite' | 'previous' | 'next' | 'list' | 'trailer' | 'share'
export type CardFamily = 'poster' | 'continue' | 'search'
export type ThemeDensity = 'compact' | 'comfortable' | 'large'
export type ThemeNavPlacement = 'sidebar' | 'top' | 'bottom'
export type DetailLayout = 'stack' | 'split' | 'overlay'
export type EpisodePlacement = 'tab' | 'right' | 'below'
export type EpisodeArrangement = 'list' | 'grid' | 'carousel'
export type EpisodeHover = 'scale' | 'none'
/** `tabs`: Oldest | Newest; `flip`: one toggle naming the current order (in the toolbar, or in the
 *  gutter beside a desktop right-hand rail); `none` (API 3): no sort control, oldest first. */
export type EpisodeOrderControl = 'tabs' | 'flip' | 'none'
/** API 3: the episode toolbar's controls (`detail.episodes.controls`). */
export type EpisodeControl = 'sort' | 'layout' | 'search' | 'download' | 'queue'
/** API 3: the series page sections (`detail.sections`). API 4 adds `information`, the phone
 *  Overview's Information block, which becomes a section of its own only when `tabs` lists it. */
export type DetailSection = 'overview' | 'episodes' | 'relations' | 'characters' | 'recommended' | 'information'
/** API 3: the fixed tab names a theme picks from — never free text. API 4 adds `information` and
 *  `show-details` (for the `information` section). */
export type TabLabel =
  | 'overview' | 'info' | 'details' | 'about' | 'home' | 'episodes' | 'watch' | 'relations' | 'related'
  | 'characters' | 'cast' | 'recommended' | 'more-like-this' | 'recommendations'
  | 'information' | 'show-details'
/** API 3: which sections get a tab, their names, the tab open on arrival, and where the phone facts sit. */
export interface DetailSections {
  /** `tabs` (default) draws a tab strip; `stack` renders every section in turn under its own title. */
  mode?: 'tabs' | 'stack'
  /** Sections with a tab, in order (1–5, each once; 1–6 from API 4). The rest render inside Overview
   *  after its own content; Overview always keeps a tab, unless `unlisted` hides what `tabs` leaves
   *  out. `information` is the exception: left out, it stays where it always sits inside Overview
   *  (never folded to the end), and `unlisted: "hidden"` removes it. */
  tabs?: DetailSection[]
  /** `hidden`: the sections `tabs` leaves out (Overview included) are not on the page at all, for
   *  a site whose info column already carries the facts and synopsis. */
  unlisted?: 'overview' | 'hidden'
  /** A fixed replacement name per section. */
  labels?: Partial<Record<DetailSection, TabLabel>>
  /** The tab open on arrival. */
  default?: DetailSection
  /** Phones: `overview` moves the facts, countdown, release timing, genres and synopsis into Overview. */
  info?: 'above' | 'overview'
}
/** The series page's episode list. */
export interface DetailEpisodes {
  placement?: EpisodePlacement
  arrangement?: EpisodeArrangement
  hover?: EpisodeHover
  order?: EpisodeOrderControl
  /** `false` hides search; API 3 `field` is an always-visible filter field. */
  search?: boolean | 'field'
  card?: ThemeNode
  /** API 3: `bar` (default) or a heading row ("Episodes" and the count) with compact controls. */
  toolbar?: 'bar' | 'header'
  /** API 3: the controls shown inline, in order; every other control that applies moves into the
   *  toolbar's overflow menu, so none is lost. `[]` puts them all there. */
  controls?: EpisodeControl[]
  /** API 3: Prev/Next pages (default), range chips above the list, or a range picker in the toolbar. */
  paging?: 'pages' | 'ranges' | 'dropdown'
  /** API 3: episodes per page or range (12–200, default 48); `auto` is 25, 50 or 100 by length. */
  pageSize?: number | 'auto'
  /** API 3: with fewer episodes than this (0–100) the toolbar shrinks to its overflow button. */
  toolbarMin?: number
  /** API 3: a season picker above the episodes of a multi-season franchise. */
  seasons?: 'chips' | 'posters' | 'dropdown' | 'none'
  /** API 4: `button` puts a download button (`episode.download`) beside every episode; `none`
   *  (default) leaves downloads to the toolbar's selection. */
  download?: 'none' | 'button'
  /** API 4: where a `chips` or `posters` season row opens: scrolled to the current season (`active`,
   *  default) or at its start, the first season (`start`). */
  seasonsScroll?: 'active' | 'start'
}
/** API 4: a button of the phone series header (`detail.buttons`): Play, the full-width list button,
 *  or Download, which opens the episode list's download selection with the Play episode picked. */
export type DetailButton = 'play' | 'list' | 'download'
/** API 4: the standard series facts (`detail.factsKeys`, `detail.infoKeys`, `data-key` on `fact`). */
export type FactKey =
  | 'format' | 'episodes' | 'status' | 'aired' | 'season' | 'duration' | 'studio' | 'source' | 'country'
  | 'score' | 'members' | 'genres' | 'progress' | 'year' | 'ended' | 'favourites' | 'author'
  | 'romaji' | 'english' | 'native'
/** API 4: the fixed names a fact may take (`detail.factsLabels`), per key in `FACT_LABELS`. */
export type FactLabel =
  | 'type' | 'format' | 'episodes' | 'total-episodes' | 'status' | 'aired' | 'premiered' | 'start-date' | 'release-date'
  | 'season' | 'duration' | 'runtime' | 'average-duration' | 'studio' | 'studios' | 'source' | 'source-material'
  | 'country' | 'origin-country' | 'score' | 'mean-score' | 'rating' | 'members' | 'popularity' | 'genres'
  | 'watched' | 'progress' | 'year' | 'release-year' | 'ended' | 'end-date' | 'favourites' | 'favorites'
  | 'author' | 'creator' | 'romaji' | 'name-romaji' | 'romaji-title' | 'english' | 'name' | 'english-title'
  | 'native' | 'native-title'
/** API 4: how fact values read (`detail.factsFormat`). */
export interface FactsFormat {
  /** `percent` (default) "86%"; `ten` "8.6"; `ten-of` "8.6" followed by a " / 10" suffix part. */
  score?: 'percent' | 'ten' | 'ten-of'
  /** `numeric` (default) "2026-1-1"; `short` and `long` are the viewer's locale ("1/1/2026", "1 January 2026"). */
  dates?: 'numeric' | 'short' | 'long'
  /** `compact` (default) "184K"; `full` "184,000"; `raw` "184000". */
  counts?: 'compact' | 'full' | 'raw'
  /** Absent: izumi's own, "24 min" ("24 minutes" in the phone Information block). `min` "24 min"
   *  everywhere; `long` "24 mins", "1 hr 45 mins"; `short` "24m", "1h 45m". */
  duration?: 'min' | 'long' | 'short'
}
/** API 4: a "more" control under a clamped phone synopsis (`detail.synopsis`). */
export interface DetailSynopsis {
  /** `none` (default) keeps tap-to-expand without a link; `expand` toggles the full text in place
   *  ("Show less" once open); `tab` opens the section holding the whole synopsis. The control only
   *  renders while the text is actually clamped; the line count stays in theme CSS. */
  more?: 'none' | 'expand' | 'tab'
  /** The control's wording: "More", "Read more" or "Show more". */
  label?: 'more' | 'read-more' | 'show-more'
}
/** API 4: the phone series bar (`detail.bar`). */
export interface DetailBar {
  /** A Home link after Back (`detail.home`). */
  home?: boolean
  /** What the bar shows once the artwork is under it: the title as text (default), or the title logo
   *  (`detail.bar.logo`) when the title has one. */
  title?: 'text' | 'logo'
  /** How far through the artwork's scroll (its height less the bar's) the bar turns solid, 0.2–1;
   *  1 (izumi's own) is once the artwork has scrolled fully under it. */
  solidAt?: number
}
/** The airing countdown (`detail.countdown`): API 3 `compact` ("2d 21h") and `long` ("4 days 19 hrs");
 *  API 4 `words` (the two largest units in words, "Episode 13 airs in 2 days 3 hours"), `full` (days,
 *  hours, minutes and seconds, ticking each second) and `date` ("Next episode 13" over the local airing
 *  time). */
export type DetailCountdown = 'none' | 'compact' | 'long' | 'words' | 'full' | 'date'
export type ThemeIcon =
  | 'score' | 'format' | 'episodes' | 'reviews' | 'studio' | 'season' | 'status' | 'source' | 'country' | 'duration'
  | 'bookmark' | 'plus' | 'info' | 'share'
export type ThemeSurface = 'Home' | 'Shell' | 'Details' | 'Player' | 'Full'
export interface ThemeNode {
  type: 'stack' | 'row' | 'grid' | 'overlay' | 'text' | 'artwork' | 'action' | 'icon' | 'meter'
  text?: string
  field?: DisplayField
  artwork?: ArtworkKind
  action?: ThemeAction
  icon?: ThemeIcon
  /** API 3: `field` may also name artwork (render when it exists); `absent` inverts the test. */
  when?: { field: DisplayField | ArtworkKind; atMost?: number; absent?: boolean }
  style?: Record<string, string | number>
  children?: ThemeNode[]
  /** API 3: rendered as `data-part` so a theme stylesheet can style this node. */
  part?: string
}
export interface RowPresentation {
  layout?: 'carousel' | 'grid'
  width?: number
  gap?: number
  spacing?: number
  radius?: number
  aspect?: 'poster' | 'landscape' | 'square'
  titleSize?: number
  heading?: RowHeading
  card?: ThemeNode
  /** API 3: `focus` keeps one line under the row's cards for the focused card's full title and detail
   *  line while a pad is in use (Game or controller mode). */
  caption?: 'none' | 'focus'
}
/** Theme API 1 is the original contract; API 2 adds the phone block, bottom-bar and slide-marker
 *  chrome, row headings, series tabs and the docked player. A package declares which it uses, so
 *  a client that only knows API 1 refuses an API 2 package cleanly instead of failing mid-parse. */
export type ThemeApi = 1 | 2 | 3 | 4
/** The newest theme API this client renders. API 3 adds stylesheets, fonts, template parts,
 *  airing and slide fields, and the text wordmark. API 4 adds the phone root size, scroll chrome,
 *  the series header buttons, fact keys, names and formats, the Information section, the synopsis
 *  control, countdown formats and placement, the actions-row lead template, more display fields, the
 *  full-resolution poster, the hero's slide count, source and transition, header shortcuts that
 *  repeat a bottom-bar tab, artwork on profile-header buttons, the tabbed grid's opening tab, the
 *  portrait header art and its cover fallback, the phone series bar options and per-episode
 *  download buttons. */
export const LATEST_THEME_API: ThemeApi = 4
/** Series-page tab strip: an underlined row, pills, an iOS-style segmented control, or a bar of
 *  equal tabs with a tinted pill behind the active one (the two-tab Info/Watch bar of some apps).
 *  API 3 `bottom`: on phones the tabs become a bar fixed to the bottom of the screen in place of the
 *  app's bottom navigation; wider windows show them underlined. */
export type DetailTabs = 'underline' | 'pills' | 'segmented' | 'bar' | 'bottom'
export interface DetailPresentation {
  layout?: DetailLayout
  bannerHidden?: boolean
  posterWidth?: number
  facts?: ThemeNode
  actionsFirst?: boolean
  coverAlign?: 'start' | 'end'
  cta?: 'default' | 'large'
  bannerHeight?: number
  /** `banner` sizes the series artwork to the window width (5:1, min 20rem), not viewport height. */
  bannerScale?: 'viewport' | 'banner'
  tabs?: DetailTabs
  episodes?: DetailEpisodes
  /** API 3: how the standard facts render — the `facts` template (default), a label/value table,
   *  a scrolling row of value-over-label cards, or chips. */
  factsStyle?: 'template' | 'table' | 'cards' | 'chips'
  /** API 3: an airing countdown under the facts, compact ("2d 21h") or long ("4 days 19 hrs");
   *  API 4 adds `words`, `full` and `date` (see `DetailCountdown`). */
  countdown?: DetailCountdown
  /** API 4: where the countdown sits — with the facts (`info`, default), at the top of the episode
   *  list under its toolbar (`episodes`), or both. */
  countdownAt?: 'info' | 'episodes' | 'both'
  /** API 4: hide the countdown while the next episode is more than this many days away (1–365, whole). */
  countdownWithin?: number
  /** API 3: the tracker list button — inline (default), a full-width outlined button, or hidden. */
  listButton?: 'inline' | 'full' | 'hidden'
  /** API 4: the phone header's buttons, in order (0–3, each once): `play` (hidden as before once a
   *  `continue: "card"` takes its place), `list` (the full-width list button) and `download`. `[]`
   *  shows none. Absent keeps izumi's own: Play, then the list button with `listButton: "full"`. The
   *  stacked page and the overlay body on phones; desktop ignores it. */
  buttons?: DetailButton[]
  /** API 3: a template under the series title on phones and desktop (a studio chip, a score, a meta
   *  line), whatever `factsStyle` shows. Non-interactive, like card templates. */
  header?: ThemeNode
  /** API 4: a template at the start of the phone actions row (`detail.lead`, taking the free width),
   *  bound to the series facts plus `episodesWatched`, `episodesAired` and `episodeCount`.
   *  Non-interactive, like card templates. */
  actionsLead?: ThemeNode
  /** API 4: the standard facts shown and their order (1–17 keys, each once), in the table, cards and
   *  chips styles on phones and desktop. */
  factsKeys?: FactKey[]
  /** API 4: the same for the phone Information block (Overview, or its own `information` section). */
  infoKeys?: FactKey[]
  /** API 4: a fixed replacement name per fact, from that key's list in `FACT_LABELS`. */
  factsLabels?: Partial<Record<FactKey, FactLabel>>
  /** API 4: how scores, dates and counts read in the facts. */
  factsFormat?: FactsFormat
  /** API 4: the phone synopsis' "more" control. */
  synopsis?: DetailSynopsis
  /** API 3: the series-page header artwork on every layout (the phone band, the overlay backdrops,
   *  the desktop banner): the catalog banner first (default), or 16:9 key art first when the title
   *  has it. Either stands in for the other when it is missing or fails to load. API 4 `portrait`:
   *  key art, else the full-resolution portrait poster (`posterHd`, else the largest cover), never the
   *  wide banner, for a tall portrait header. */
  art?: 'banner' | 'keyart' | 'portrait'
  /** API 4: what a title without header art shows: a wash of its cover's colour (default), or the
   *  cover itself, sharp. */
  artFallback?: 'wash' | 'cover'
  /** API 4: the phone series bar: a Home link, the title logo, when it turns solid. */
  bar?: DetailBar
  /** API 3: the series title as text (default) or the title logo when there is one, on every layout. */
  title?: 'text' | 'logo'
  /** API 3: which sections get tabs, their names, the default tab, and where the phone facts sit. */
  sections?: DetailSections
  /** API 3: `hidden` covers the phone's bottom navigation while the series page is open. */
  nav?: 'shown' | 'hidden'
  /** API 3: `card` puts a Continue card at the top of the episodes; on phones it replaces the
   *  header's Play button once an episode has aired. */
  continue?: 'button' | 'card'
  /** API 3, desktop stacked and split pages: `poster` makes the poster the head of a left column
   *  that runs down the page — the trailer button, the countdown and the facts under it — with the
   *  title, actions, synopsis and sections beside it. */
  column?: 'none' | 'poster'
}
/** The phone tab bar (and the desktop bottom bar when `nav` is `bottom`). */
export interface BottomNavPresentation {
  /** `bar` is flush and full width; `floating` is an inset rounded card; `pill` is a centred capsule. */
  style?: 'bar' | 'floating' | 'pill'
  labels?: 'always' | 'active' | 'none'
  /** `pill` tints a capsule behind the active icon; `line` marks the top edge; `dot` sits under the label. */
  indicator?: 'none' | 'pill' | 'line' | 'dot'
  height?: number
  iconSize?: number
  radius?: number
  background?: string
  activeColor?: string
  inactiveColor?: string
  blur?: boolean
  border?: boolean
  /** `scroll` slides the bar away while scrolling down (the default); `never` keeps it put. API 4
   *  `collapse` keeps the bar in place (labels in the DOM, the same reserved height) and only reports
   *  the state, for a stylesheet to fold it. The state is `data-chrome` on `<html>` and `data-state`
   *  on `nav.bottom`. */
  hide?: 'scroll' | 'never' | 'collapse'
  /** API 4: how far the page scrolls in one direction (8–160 px, whole) before the bar hides or
   *  returns; a change of direction starts the count again. Absent keeps izumi's own rule. */
  threshold?: number
  /** API 4: return the bar after this long without scrolling (0–5000 ms, whole; 0 never). */
  idle?: number
}
/** API 3: the desktop top bar (`shell.nav: "top"`). */
export interface TopBarPresentation {
  /** `icons` (default) shows icons only, `text` destination names as links, `both` icon and name. */
  labels?: 'icons' | 'text' | 'both'
  /** `field-center` / `field-end` put a search field in the bar in place of the Search destination. */
  search?: 'icon' | 'field-center' | 'field-end'
  /** `drawer` adds a menu button that opens every destination in a side drawer. `side` pins that
   *  menu as a labelled panel down the left under the bar (the page moves over for it) on windows
   *  from 1100 px; the menu button folds it away, and narrower windows get the drawer. */
  menu?: 'none' | 'drawer' | 'side'
  /** The pinned panel's width in px (`menu: "side"`, 200–320, default 260). */
  sideWidth?: number
  /** Where the brand sits in the bar. */
  brand?: 'start' | 'center'
  /** A "Categories" menu after the destinations: browse links and the catalog's genres. */
  categories?: boolean
  /** API 3: the destinations become tabs that L1/R1 switch, with the bumper glyphs at either end;
   *  L2/R2 step the page's own tabs, Start opens the menu drawer and View opens search. With a pad in
   *  use the bar's controls leave the d-pad order (the drawer reaches every destination). */
  bumpers?: boolean
}
export interface ShellPresentation {
  nav?: ThemeNavPlacement
  compact?: boolean
  /** `fade` paints a scrim from the rail into the page so full-bleed banners meet the menu. */
  overlay?: 'none' | 'fade'
  /** `sink` darkens and nudges a control down while it is held. */
  press?: 'none' | 'sink'
  bottomNav?: BottomNavPresentation
  top?: TopBarPresentation
  /** API 3: the controller button-hint bar along the bottom (Game or controller mode, after pad input). */
  hints?: boolean
}
/** Where the video sits while playing windowed on desktop. `full` fills the window inside the
 *  shell chrome; `docked` confines it to a 16:9 stage with the episode rail beside or below it. */
export interface PlayerDock {
  episodes?: 'right' | 'below'
  width?: number
  align?: 'start' | 'center'
  /** The episode discussion under the stage (side rail) or after the episode grid (below). */
  comments?: 'below' | 'hidden'
  /** API 3: `page` scrolls the watch view like a web page — the video moves up with it and every
   *  block under it keeps its natural height (no inner scrollers). Beside a side rail only the
   *  stage's column scrolls (the rail keeps its own list) and `page` is the default there while
   *  the discussion sits under the stage; below the stage the default is `fixed`. */
  flow?: 'fixed' | 'page'
  /** API 3: the widest the stage column gets, in CSS px, centred when `align` is `center`. */
  maxWidth?: number
  /** API 3, with `episodes: "below"`: the blocks under the stage, in order. */
  below?: PlayerDockBlock[]
  /** API 3: the dropdowns of the `toolbar` block, in order. */
  toolbar?: PlayerToolbarItem[]
  /** API 3: player chrome a docked page shows elsewhere (its own title line, its own navigation). */
  hide?: PlayerChrome[]
}
export type PlayerDockBlock = 'toolbar' | 'info' | 'episodes' | 'comments'
export type PlayerToolbarItem = 'server' | 'episode' | 'release' | 'download'
export type PlayerChrome = 'back' | 'title'
export interface PlayerPresentation {
  seekbarHeight?: number
  seekbarColor?: string
  layout?: 'full' | 'docked'
  dock?: PlayerDock
}
/** The featured banner on Home. */
export interface HeroPresentation {
  hidden?: boolean
  height?: number
  mobileHeight?: number
  rotate?: boolean
  interval?: number
  rankHidden?: boolean
  rank?: ThemeNode
  template?: ThemeNode
  scale?: 'viewport' | 'banner' | 'wide'
  indicator?: HeroIndicator
  bleed?: number
  /** API 4: how many slides (1–15, whole; izumi's own is 7). */
  limit?: number
  /** API 4: `season` (default) features this season's top-scored titles that have landscape art, in
   *  a stable shuffle; `trending` the titles trending now, in trending order, with or without it. */
  source?: 'season' | 'trending'
  /** API 4: `slide` (default) is izumi's directional entrance; `fade` cross-fades the outgoing slide
   *  into the incoming one over 650 ms (an instant swap under reduced motion). */
  transition?: 'slide' | 'fade'
}
/** The featured banner's slide marker. */
export interface HeroIndicator {
  style?: 'bars' | 'dots' | 'pills' | 'counter' | 'none'
  position?: 'start' | 'center' | 'end'
  color?: string
  /** API 3: `empty` leaves the bars of slides already shown unfilled (only the current one fills). */
  past?: 'filled' | 'empty'
}
/** Row heading chrome. `titleSize` on the row stays the size control. */
export interface RowHeading {
  weight?: number
  transform?: 'none' | 'uppercase'
  accent?: 'none' | 'bar' | 'dot' | 'underline'
  viewMore?: 'text' | 'arrow' | 'hidden'
}
/** API 3: one entry of a theme's Home — a catalog row by role (`hero` is the featured banner), or a block. */
export type ThemeLayoutEntry = { role: string } | ({ block: HomeBlockType } & Omit<HomeBlock, 'type'>)
export interface ThemeNav {
  /** Home's position on the bottom bar (0 = first). */
  home?: number
  bottom?: NavDestination[]
  /** The phone Home header's destination icons. From API 4 one may repeat a bottom-bar destination
   *  as a header shortcut (a search icon beside a Search tab); older packages keep them apart. */
  top?: NavDestination[]
}
/** API 3: the theme's Home and navigation, applied while the theme is active and its layout switch is on. */
export interface ThemeLayout {
  home?: ThemeLayoutEntry[]
  asideWidth?: number
  /** The gutter between Home's main column and its side column, in px (default 32). */
  asideGap?: number
  /** The main-column row the side column starts beside; the rows before it span the whole width. */
  asideStart?: number
  nav?: ThemeNav
}
export interface ThemePresentation {
  density?: ThemeDensity
  hideCardLabels?: boolean
  trueBlack?: boolean
  hero?: HeroPresentation
  rows?: { defaults?: RowPresentation; byId?: Record<string, RowPresentation> }
  detail?: DetailPresentation
  shell?: ShellPresentation
  player?: PlayerPresentation
  cards?: Partial<Record<CardFamily, ThemeNode>>
  /** API 3: the theme's Home and navigation layout. */
  layout?: ThemeLayout
  /** API 3: `none` switches off izumi's hover popup on poster cards, for themes that draw their own hover panel in the card template. */
  cardPreview?: 'popup' | 'none'
  /** Phone overrides (the Android app and any viewport up to 640px), resolved on top of the rest. */
  mobile?: MobilePresentation
  /** API 4, phones only: the root font size in px (14–18; izumi's own is 14.5) that every rem of the
   *  app's phone UI follows, times the design's font scale. The izumi mark keeps its own size. Only
   *  accepted inside `mobile`; the resolved phone presentation carries it here. */
  rootSize?: number
}
/** What a phone variant can change. Navigation is always the bottom bar there, so `shell` stays shared. */
export type MobilePresentation = Pick<ThemePresentation, 'density' | 'hideCardLabels' | 'trueBlack' | 'hero' | 'rows' | 'detail' | 'player' | 'cards' | 'layout' | 'rootSize'>
/** Every host binds the same shapes: numeric fields are numbers, the rest strings. */
export type DisplayModel = Partial<Record<Exclude<DisplayField, NumericDisplayField> | ArtworkKind, string> & Record<NumericDisplayField, number>>
export const ROW_CONTEXT = Symbol('theme-row')
export const CARD_FAMILY = Symbol('theme-card-family')
export interface RowScope { id: string; title: string }
const fields = [
  'title', 'description', 'rank', 'rankPosition', 'score', 'format', 'year',
  'studio', 'season', 'status', 'genres', 'members', 'reviews',
  'episodeCount', 'episodeTitle', 'airDate', 'duration', 'episodeNumber', 'progress',
  'source', 'country',
  'nextEpisode', 'airingIn', 'airingCountdown', 'slide', 'slides', 'episodesAired', 'genre',
  'ageRating', 'audio', 'timeLeft',
  'episodeNo', 'episodeCode', 'watched', 'filler', 'rating', 'episodeName',
  'startYear', 'genre2', 'genre3', 'episodesWatched',
  'durationLong', 'scoreValue', 'completed', 'airingSoon',
  'starring', 'creators',
] as const satisfies readonly DisplayField[]
const API3_FIELDS: readonly DisplayField[] = ['nextEpisode', 'airingIn', 'airingCountdown', 'slide', 'slides', 'episodesAired', 'genre', 'ageRating', 'audio', 'timeLeft', 'episodeNo', 'episodeCode', 'watched', 'filler', 'rating', 'episodeName']
/** The release year, the second and third genres, the episodes watched, the long duration, the bare
 *  score, the finished mark, the due countdown, the starring line and every studio are API 4. */
const API4_FIELDS: readonly DisplayField[] = ['startYear', 'genre2', 'genre3', 'episodesWatched', 'durationLong', 'scoreValue', 'completed', 'airingSoon', 'starring', 'creators']
/** An older package is held to the fields its clients know, so it renders identically everywhere. */
const fieldsFor = (api: ThemeApi): readonly DisplayField[] => fields.filter(field => (api >= 3 || !API3_FIELDS.includes(field)) && (api >= 4 || !API4_FIELDS.includes(field)))
const numericFields: string[] = ['rankPosition', 'score', 'duration', 'episodeNumber', 'progress', 'nextEpisode', 'slide', 'slides', 'episodesAired', 'episodesWatched'] satisfies NumericDisplayField[]
const actions = ['play', 'details', 'favorite', 'previous', 'next', 'list', 'trailer', 'share']
const artworkKinds = ['poster', 'backdrop', 'logo', 'still', 'keyart', 'posterHd'] as const
/** Key art is API 3 and the full-resolution poster API 4; older packages keep the artwork their clients know. */
const artworkFor = (api: ThemeApi): readonly ArtworkKind[] => artworkKinds.filter((kind) => (api >= 3 || kind !== 'keyart') && (api >= 4 || kind !== 'posterHd'))
const DETAIL_SECTIONS = ['overview', 'episodes', 'relations', 'characters', 'recommended', 'information'] as const satisfies readonly DetailSection[]
/** The Information section is API 4; older packages keep the sections their clients know. */
const sectionsFor = (api: ThemeApi): readonly DetailSection[] => (api >= 4 ? DETAIL_SECTIONS : DETAIL_SECTIONS.filter((section) => section !== 'information'))
/** The fixed names each section may take (`detail.sections.labels`). */
const SECTION_LABELS: Record<DetailSection, readonly TabLabel[]> = {
  overview: ['overview', 'info', 'details', 'about', 'home'],
  episodes: ['episodes', 'watch'],
  relations: ['relations', 'related'],
  characters: ['characters', 'cast'],
  recommended: ['recommended', 'more-like-this', 'recommendations'],
  information: ['information', 'details', 'show-details'],
}
/** Every standard fact: izumi's own, in the order its facts list them, then the API 4 additions. */
export const FACT_KEYS = [
  'format', 'episodes', 'status', 'aired', 'season', 'duration', 'studio', 'source', 'country',
  'score', 'members', 'genres', 'progress', 'year', 'ended', 'favourites', 'author',
  'romaji', 'english', 'native',
] as const satisfies readonly FactKey[]
/** The fixed names each fact may take (`detail.factsLabels`); the first is the one izumi's facts use. */
export const FACT_LABELS: Record<FactKey, readonly FactLabel[]> = {
  format: ['type', 'format'],
  episodes: ['episodes', 'total-episodes'],
  status: ['status'],
  aired: ['aired', 'premiered', 'start-date', 'release-date'],
  season: ['season'],
  duration: ['duration', 'runtime', 'average-duration'],
  studio: ['studio', 'studios'],
  source: ['source', 'source-material'],
  country: ['country', 'origin-country'],
  score: ['score', 'mean-score', 'rating'],
  members: ['members', 'popularity'],
  genres: ['genres'],
  progress: ['watched', 'progress'],
  year: ['year', 'release-year'],
  ended: ['ended', 'end-date'],
  favourites: ['favourites', 'favorites'],
  author: ['author', 'creator'],
  romaji: ['romaji', 'name-romaji', 'romaji-title'],
  english: ['english', 'name', 'english-title'],
  native: ['native', 'native-title'],
}
/** The text each fact name renders, in Title Case (a stylesheet may change the case). */
export const FACT_LABEL_TEXT: Record<FactLabel, string> = {
  type: 'Type', format: 'Format', episodes: 'Episodes', 'total-episodes': 'Total Episodes', status: 'Status',
  aired: 'Aired', premiered: 'Premiered', 'start-date': 'Start Date', 'release-date': 'Release Date',
  season: 'Season', duration: 'Duration', runtime: 'Runtime', 'average-duration': 'Average Duration',
  studio: 'Studio', studios: 'Studios', source: 'Source', 'source-material': 'Source Material',
  country: 'Country', 'origin-country': 'Origin Country', score: 'Score', 'mean-score': 'Mean Score',
  rating: 'Rating', members: 'Members', popularity: 'Popularity', genres: 'Genres', watched: 'Watched',
  progress: 'Progress', year: 'Year', 'release-year': 'Release Year', ended: 'Ended', 'end-date': 'End Date',
  favourites: 'Favourites', favorites: 'Favorites', author: 'Author', creator: 'Creator',
  romaji: 'Romaji', 'name-romaji': 'Name Romaji', 'romaji-title': 'Romaji Title', english: 'English', name: 'Name',
  'english-title': 'English Title', native: 'Native', 'native-title': 'Native Title',
}
const DETAIL_BUTTONS = ['play', 'list', 'download'] as const satisfies readonly DetailButton[]
const EPISODE_CONTROLS = ['sort', 'layout', 'search', 'download', 'queue'] as const satisfies readonly EpisodeControl[]
const numericStyles: Record<string, [number, number, string]> = {
  gap: [0, 96, 'px'], padding: [0, 96, 'px'], fontSize: [10, 96, 'px'], fontWeight: [400, 900, ''],
  radius: [0, 80, 'px'], opacity: [0, 1, ''], width: [5, 100, '%'], minHeight: [0, 600, 'px'],
  columns: [1, 6, ''], grow: [0, 1, ''], shrink: [0, 1, ''], maxWidth: [80, 1200, 'px'], lines: [1, 6, ''],
}
const choices: Record<string, string[]> = {
  align: ['start', 'center', 'end', 'stretch'], justify: ['start', 'center', 'end', 'space-between'],
  textAlign: ['start', 'center', 'end'], position: ['relative', 'absolute'],
  anchor: ['fill', 'bottom-start', 'bottom-end', 'top-start', 'top-end'],
  fit: ['cover', 'contain'], aspect: ['2 / 3', '16 / 9', '2 / 1', '1 / 1'], wrap: ['wrap', 'nowrap'],
}
const icons = ['score', 'format', 'episodes', 'reviews', 'studio', 'season', 'status', 'source', 'country', 'duration', 'bookmark', 'plus', 'info', 'share'] as const
const API3_ICONS: readonly ThemeIcon[] = ['bookmark', 'plus', 'info', 'share']
/** Bookmark/plus/info/share are API 3; older packages keep the icons their clients know. */
const iconsFor = (api: ThemeApi): readonly ThemeIcon[] => (api >= 3 ? icons : icons.filter((icon) => !API3_ICONS.includes(icon)))
const colors = ['foreground', 'background', 'muted', 'muted-foreground', 'theme', 'card', 'card-foreground', 'primary', 'primary-foreground', 'transparent']
export function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Expected a theme object.')
  return value as Record<string, unknown>
}
function only(value: Record<string, unknown>, keys: string[]) {
  if (Object.keys(value).some(key => !keys.includes(key))) throw new Error('This theme uses an unsupported presentation property.')
}
function number(value: unknown, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) throw new Error('A theme dimension is outside the supported range.')
  return value
}
function choice<const T extends string>(value: unknown, allowed: readonly T[]): T {
  if (typeof value !== 'string' || !allowed.includes(value as T)) throw new Error('This theme uses an unsupported presentation value.')
  return value as T
}
function flag(value: unknown): boolean {
  if (typeof value !== 'boolean') throw new Error('Expected a theme toggle.')
  return value
}
function themeColor(value: unknown): string {
  if (typeof value !== 'string' || !(colors.includes(value) || /^#[0-9a-f]{6}([0-9a-f]{2})?$/i.test(value))) throw new Error('Use a theme color or a hex color.')
  return value
}
/** Nodes of card and badge templates, which draw static tiles (see nodeStyle). The mark sits beside
 *  the tree rather than in it, so a parsed layout still serialises to exactly what the parser accepts;
 *  a copied tree loses it and its nowrap rows fall back to the plain sideways-only rule. */
const tileNodes = new WeakSet<ThemeNode>()
function tile(node: ThemeNode): ThemeNode {
  tileNodes.add(node)
  node.children?.forEach(tile)
  return node
}
export function parseNode(value: unknown, budget = { count: 0 }, depth = 0, interactive = true, api: ThemeApi = LATEST_THEME_API): ThemeNode {
  if (++budget.count > 96 || depth > 8) throw new Error('This theme template is too complex.')
  const raw = record(value)
  only(raw, ['type', 'text', 'field', 'artwork', 'action', 'icon', 'when', 'style', 'children', ...api3(api, ['part'])])
  const node: ThemeNode = { type: choice(raw.type, ['stack', 'row', 'grid', 'overlay', 'text', 'artwork', 'action', 'icon', 'meter']) }
  if (node.type === 'action' && !interactive) throw new Error('Card and badge templates cannot contain nested actions.')
  if (raw.text !== undefined) {
    if (typeof raw.text !== 'string' || raw.text.length > 300) throw new Error('Theme text is too long.')
    node.text = raw.text
  }
  if (raw.field !== undefined) node.field = choice(raw.field, fieldsFor(api))
  if (raw.artwork !== undefined) node.artwork = choice(raw.artwork, artworkFor(api))
  if (node.type === 'artwork' && !node.artwork) throw new Error('Choose artwork for this template.')
  if (node.type === 'action') node.action = choice(raw.action, actions) as ThemeAction
  if (raw.icon !== undefined || node.type === 'icon') {
    const icon = choice(raw.icon, iconsFor(api))
    // Actions draw their icon from API 3. Older packages could always carry one harmlessly, since it
    // was never drawn, so it stays checked but unrendered for them.
    if (node.type !== 'action' || api >= 3) node.icon = icon
  }
  if (node.type === 'icon' && !node.icon) throw new Error('Choose an icon for this template.')
  if (node.type === 'meter') {
    if (!node.field || !numericFields.includes(node.field)) throw new Error('A meter needs a numeric field.')
  }
  if (raw.when !== undefined) {
    const condition = record(raw.when); only(condition, ['field', 'atMost', ...api3(api, ['absent'])])
    node.when = { field: choice<DisplayField | ArtworkKind>(condition.field, api >= 3 ? [...fieldsFor(api), ...artworkFor(api)] : fieldsFor(api)) }
    if (condition.atMost !== undefined) {
      if (!numericFields.includes(node.when.field)) throw new Error('atMost only applies to numeric fields: rankPosition, score, duration, episodeNumber, progress, nextEpisode, slide, slides, episodesAired and episodesWatched.')
      node.when.atMost = number(condition.atMost, 0, 10000)
    }
    if (condition.absent !== undefined) {
      node.when.absent = flag(condition.absent)
      if (node.when.absent && node.when.atMost !== undefined) throw new Error('A condition cannot combine absent with atMost.')
    }
  }
  if (raw.part !== undefined) {
    if (typeof raw.part !== 'string' || !/^[a-z][a-z0-9.-]{0,39}$/.test(raw.part)) throw new Error('Use a lowercase part name such as hero.meta.')
    node.part = raw.part
  }
  if (raw.style !== undefined) {
    const style = record(raw.style); node.style = {}
    for (const [key, value] of Object.entries(style)) {
      if (numericStyles[key]) node.style[key] = number(value, numericStyles[key][0], numericStyles[key][1])
      else if (choices[key]) node.style[key] = choice(value, choices[key])
      else if (key === 'color' || key === 'background') node.style[key] = themeColor(value)
      else throw new Error('This theme style is not supported.')
    }
  }
  if (raw.children !== undefined) {
    if (!['stack', 'row', 'grid', 'overlay'].includes(node.type) || !Array.isArray(raw.children)) throw new Error('Only layout nodes can contain children.')
    node.children = raw.children.map(child => parseNode(child, budget, depth + 1, interactive, api))
  }
  return node
}
/** Keys each API level accepts, so an API 1 package cannot smuggle API 2 chrome past an old client. */
const api2 = (api: ThemeApi, keys: string[]) => (api >= 2 ? keys : [])
const api3 = (api: ThemeApi, keys: string[]) => (api >= 3 ? keys : [])
const api4 = (api: ThemeApi, keys: string[]) => (api >= 4 ? keys : [])
function parseHeading(value: unknown): RowHeading {
  const raw = record(value); only(raw, ['weight', 'transform', 'accent', 'viewMore'])
  const result: RowHeading = {}
  if (raw.weight !== undefined) result.weight = number(raw.weight, 400, 900)
  if (raw.transform !== undefined) result.transform = choice(raw.transform, ['none', 'uppercase'])
  if (raw.accent !== undefined) result.accent = choice(raw.accent, ['none', 'bar', 'dot', 'underline'])
  if (raw.viewMore !== undefined) result.viewMore = choice(raw.viewMore, ['text', 'arrow', 'hidden'])
  return result
}
function parseRow(value: unknown, api: ThemeApi): RowPresentation {
  const raw = record(value); only(raw, ['layout', 'width', 'gap', 'spacing', 'radius', 'aspect', 'titleSize', 'card', ...api2(api, ['heading']), ...api3(api, ['caption'])])
  const result: RowPresentation = {}
  if (raw.layout !== undefined) result.layout = choice(raw.layout, ['carousel', 'grid'])
  if (raw.aspect !== undefined) result.aspect = choice(raw.aspect, ['poster', 'landscape', 'square'])
  for (const [key, min, max] of [['width', 96, 400], ['gap', 0, 48], ['spacing', 0, 100], ['radius', 0, 48], ['titleSize', 12, 32]] as const) {
    if (raw[key] !== undefined) result[key] = number(raw[key], min, max)
  }
  if (raw.heading !== undefined) result.heading = parseHeading(raw.heading)
  if (raw.card !== undefined) result.card = tile(parseNode(raw.card, undefined, 0, false, api))
  if (raw.caption !== undefined) result.caption = choice(raw.caption, ['none', 'focus'])
  return result
}
function parseBottomNav(value: unknown, api: ThemeApi): BottomNavPresentation {
  const raw = record(value); only(raw, ['style', 'labels', 'indicator', 'height', 'iconSize', 'radius', 'background', 'activeColor', 'inactiveColor', 'blur', 'border', 'hide', ...api4(api, ['threshold', 'idle'])])
  const result: BottomNavPresentation = {}
  if (raw.style !== undefined) result.style = choice(raw.style, ['bar', 'floating', 'pill'])
  if (raw.labels !== undefined) result.labels = choice(raw.labels, ['always', 'active', 'none'])
  if (raw.indicator !== undefined) result.indicator = choice(raw.indicator, ['none', 'pill', 'line', 'dot'])
  if (raw.height !== undefined) result.height = number(raw.height, 44, 88)
  if (raw.iconSize !== undefined) result.iconSize = number(raw.iconSize, 16, 30)
  if (raw.radius !== undefined) result.radius = number(raw.radius, 0, 40)
  for (const key of ['background', 'activeColor', 'inactiveColor'] as const) if (raw[key] !== undefined) result[key] = themeColor(raw[key])
  for (const key of ['blur', 'border'] as const) if (raw[key] !== undefined) result[key] = flag(raw[key])
  if (raw.hide !== undefined) result.hide = choice(raw.hide, api >= 4 ? ['scroll', 'never', 'collapse'] : ['scroll', 'never'])
  if (raw.threshold !== undefined) result.threshold = whole(raw.threshold, 8, 160)
  if (raw.idle !== undefined) result.idle = whole(raw.idle, 0, 5000)
  return result
}
function parseTopBar(value: unknown): TopBarPresentation {
  const raw = record(value); only(raw, ['labels', 'search', 'menu', 'brand', 'categories', 'sideWidth', 'bumpers'])
  const result: TopBarPresentation = {}
  if (raw.labels !== undefined) result.labels = choice(raw.labels, ['icons', 'text', 'both'])
  if (raw.search !== undefined) result.search = choice(raw.search, ['icon', 'field-center', 'field-end'])
  if (raw.menu !== undefined) result.menu = choice(raw.menu, ['none', 'drawer', 'side'])
  if (raw.sideWidth !== undefined) result.sideWidth = number(raw.sideWidth, 200, 320)
  if (raw.brand !== undefined) result.brand = choice(raw.brand, ['start', 'center'])
  if (raw.categories !== undefined) result.categories = flag(raw.categories)
  if (raw.bumpers !== undefined) result.bumpers = flag(raw.bumpers)
  return result
}
function parseIndicator(value: unknown, api: ThemeApi): HeroIndicator {
  const raw = record(value); only(raw, ['style', 'position', 'color', ...api3(api, ['past'])])
  const result: HeroIndicator = {}
  if (raw.style !== undefined) result.style = choice(raw.style, ['bars', 'dots', 'pills', 'counter', 'none'])
  if (raw.position !== undefined) result.position = choice(raw.position, ['start', 'center', 'end'])
  if (raw.color !== undefined) result.color = themeColor(raw.color)
  if (raw.past !== undefined) result.past = choice(raw.past, ['filled', 'empty'])
  return result
}
/** A whole number in range (page sizes, thresholds). */
function whole(value: unknown, min: number, max: number): number {
  const result = number(value, min, max)
  if (!Number.isInteger(result)) throw new Error('A theme dimension is outside the supported range.')
  return result
}
function controlList(value: unknown): EpisodeControl[] {
  if (!Array.isArray(value) || value.length > 5) throw new Error('A theme can list up to 5 episode controls.')
  const seen = new Set<EpisodeControl>()
  return value.map((id) => {
    const control = choice(id, EPISODE_CONTROLS)
    if (seen.has(control)) throw new Error('A theme lists an episode control twice.')
    seen.add(control)
    return control
  })
}
function parseSections(value: unknown, api: ThemeApi): DetailSections {
  const raw = record(value); only(raw, ['mode', 'tabs', 'labels', 'default', 'info', 'unlisted'])
  const sections = sectionsFor(api)
  const result: DetailSections = {}
  if (raw.mode !== undefined) result.mode = choice(raw.mode, ['tabs', 'stack'])
  if (raw.tabs !== undefined) {
    if (!Array.isArray(raw.tabs) || raw.tabs.length < 1 || raw.tabs.length > sections.length) throw new Error(`A theme series page needs 1–${sections.length} tabs.`)
    const seen = new Set<DetailSection>()
    result.tabs = raw.tabs.map((id) => {
      const section = choice(id, sections)
      if (seen.has(section)) throw new Error('A theme lists a series section twice.')
      seen.add(section)
      return section
    })
  }
  if (raw.labels !== undefined) {
    const labels = record(raw.labels); only(labels, [...sections])
    result.labels = {}
    for (const section of sections) {
      if (labels[section] !== undefined) result.labels[section] = choice(labels[section], SECTION_LABELS[section])
    }
  }
  if (raw.unlisted !== undefined) {
    result.unlisted = choice(raw.unlisted, ['overview', 'hidden'])
    if (result.unlisted === 'hidden' && !result.tabs) throw new Error('A theme that hides the unlisted series sections must list its tabs.')
  }
  const hidesOverview = result.unlisted === 'hidden' && !result.tabs?.includes('overview')
  if (raw.default !== undefined) {
    result.default = choice(raw.default, sections)
    // Overview has a tab whatever `tabs` lists, unless the unlisted sections are hidden. Information
    // only has one when `tabs` lists it; otherwise it stays inside Overview.
    const listed = result.tabs?.includes(result.default)
    if (result.default === 'information' ? !listed : result.tabs && (result.default !== 'overview' || hidesOverview) && !listed) throw new Error('The default series tab must be one of its tabs.')
  }
  if (raw.info !== undefined) result.info = choice(raw.info, ['above', 'overview'])
  if (hidesOverview && result.info === 'overview') throw new Error('A series page cannot move its info into a hidden Overview.')
  return result
}
function parseFactsLabels(value: unknown): Partial<Record<FactKey, FactLabel>> {
  const raw = record(value); only(raw, [...FACT_KEYS])
  const result: Partial<Record<FactKey, FactLabel>> = {}
  for (const key of FACT_KEYS) if (raw[key] !== undefined) result[key] = choice(raw[key], FACT_LABELS[key])
  return result
}
function parseFactsFormat(value: unknown): FactsFormat {
  const raw = record(value); only(raw, ['score', 'dates', 'counts', 'duration'])
  const result: FactsFormat = {}
  if (raw.score !== undefined) result.score = choice(raw.score, ['percent', 'ten', 'ten-of'])
  if (raw.dates !== undefined) result.dates = choice(raw.dates, ['numeric', 'short', 'long'])
  if (raw.counts !== undefined) result.counts = choice(raw.counts, ['compact', 'full', 'raw'])
  if (raw.duration !== undefined) result.duration = choice(raw.duration, ['min', 'long', 'short'])
  return result
}
function parseBar(value: unknown): DetailBar {
  const raw = record(value); only(raw, ['home', 'title', 'solidAt'])
  const result: DetailBar = {}
  if (raw.home !== undefined) result.home = flag(raw.home)
  if (raw.title !== undefined) result.title = choice(raw.title, ['text', 'logo'])
  if (raw.solidAt !== undefined) result.solidAt = number(raw.solidAt, 0.2, 1)
  return result
}
function parseSynopsis(value: unknown): DetailSynopsis {
  const raw = record(value); only(raw, ['more', 'label'])
  const result: DetailSynopsis = {}
  if (raw.more !== undefined) result.more = choice(raw.more, ['none', 'expand', 'tab'])
  if (raw.label !== undefined) result.label = choice(raw.label, ['more', 'read-more', 'show-more'])
  return result
}
function parseDetail(value: unknown, api: ThemeApi): DetailPresentation {
  const raw = record(value); only(raw, ['layout', 'bannerHidden', 'posterWidth', 'facts', 'actionsFirst', 'coverAlign', 'cta', 'bannerHeight', 'bannerScale', 'episodes', ...api2(api, ['tabs']), ...api3(api, ['factsStyle', 'countdown', 'listButton', 'header', 'art', 'title', 'sections', 'nav', 'continue', 'column']), ...api4(api, ['buttons', 'actionsLead', 'factsKeys', 'infoKeys', 'factsLabels', 'factsFormat', 'synopsis', 'countdownAt', 'countdownWithin', 'artFallback', 'bar'])])
  const result: DetailPresentation = {}
  if (raw.layout !== undefined) result.layout = choice(raw.layout, ['stack', 'split', 'overlay'])
  if (raw.bannerHidden !== undefined) result.bannerHidden = flag(raw.bannerHidden)
  if (raw.posterWidth !== undefined) result.posterWidth = number(raw.posterWidth, 96, 360)
  if (raw.facts !== undefined) result.facts = parseNode(raw.facts, undefined, 0, true, api)
  if (raw.actionsFirst !== undefined) result.actionsFirst = flag(raw.actionsFirst)
  if (raw.coverAlign !== undefined) result.coverAlign = choice(raw.coverAlign, ['start', 'end'])
  if (raw.cta !== undefined) result.cta = choice(raw.cta, ['default', 'large'])
  if (raw.bannerHeight !== undefined) result.bannerHeight = number(raw.bannerHeight, 18, 60)
  if (raw.bannerScale !== undefined) result.bannerScale = choice(raw.bannerScale, ['viewport', 'banner'])
  if (raw.tabs !== undefined) result.tabs = choice(raw.tabs, api >= 3 ? ['underline', 'pills', 'segmented', 'bar', 'bottom'] : ['underline', 'pills', 'segmented', 'bar'])
  if (raw.factsStyle !== undefined) result.factsStyle = choice(raw.factsStyle, ['template', 'table', 'cards', 'chips'])
  if (raw.countdown !== undefined) result.countdown = choice(raw.countdown, api >= 4 ? ['none', 'compact', 'long', 'words', 'full', 'date'] : ['none', 'compact', 'long'])
  if (raw.countdownAt !== undefined) result.countdownAt = choice(raw.countdownAt, ['info', 'episodes', 'both'])
  if (raw.countdownWithin !== undefined) result.countdownWithin = whole(raw.countdownWithin, 1, 365)
  if (raw.listButton !== undefined) result.listButton = choice(raw.listButton, ['inline', 'full', 'hidden'])
  if (raw.buttons !== undefined) result.buttons = uniqueChoices(raw.buttons, DETAIL_BUTTONS, 'detail.buttons', 0)
  if (raw.header !== undefined) result.header = parseNode(raw.header, undefined, 0, false, api)
  if (raw.actionsLead !== undefined) result.actionsLead = parseNode(raw.actionsLead, undefined, 0, false, api)
  if (raw.factsKeys !== undefined) result.factsKeys = uniqueChoices(raw.factsKeys, FACT_KEYS, 'detail.factsKeys')
  if (raw.infoKeys !== undefined) result.infoKeys = uniqueChoices(raw.infoKeys, FACT_KEYS, 'detail.infoKeys')
  if (raw.factsLabels !== undefined) result.factsLabels = parseFactsLabels(raw.factsLabels)
  if (raw.factsFormat !== undefined) result.factsFormat = parseFactsFormat(raw.factsFormat)
  if (raw.synopsis !== undefined) result.synopsis = parseSynopsis(raw.synopsis)
  if (raw.art !== undefined) result.art = choice(raw.art, api >= 4 ? ['banner', 'keyart', 'portrait'] : ['banner', 'keyart'])
  if (raw.artFallback !== undefined) result.artFallback = choice(raw.artFallback, ['wash', 'cover'])
  if (raw.bar !== undefined) result.bar = parseBar(raw.bar)
  if (raw.title !== undefined) result.title = choice(raw.title, ['text', 'logo'])
  if (raw.sections !== undefined) result.sections = parseSections(raw.sections, api)
  if (raw.nav !== undefined) result.nav = choice(raw.nav, ['shown', 'hidden'])
  if (raw.continue !== undefined) result.continue = choice(raw.continue, ['button', 'card'])
  if (raw.column !== undefined) result.column = choice(raw.column, ['none', 'poster'])
  if (raw.episodes !== undefined) {
    const episodes = record(raw.episodes); only(episodes, ['placement', 'arrangement', 'hover', 'order', 'search', 'card', ...api3(api, ['toolbar', 'controls', 'paging', 'pageSize', 'toolbarMin', 'seasons']), ...api4(api, ['download', 'seasonsScroll'])])
    result.episodes = {}
    if (episodes.placement !== undefined) result.episodes.placement = choice(episodes.placement, ['tab', 'right', 'below'])
    if (episodes.arrangement !== undefined) result.episodes.arrangement = choice(episodes.arrangement, ['list', 'grid', 'carousel'])
    if (episodes.hover !== undefined) result.episodes.hover = choice(episodes.hover, ['scale', 'none'])
    if (episodes.order !== undefined) result.episodes.order = choice(episodes.order, api >= 3 ? ['tabs', 'flip', 'none'] : ['tabs', 'flip'])
    if (episodes.search !== undefined) result.episodes.search = api >= 3 && episodes.search === 'field' ? 'field' : flag(episodes.search)
    if (episodes.card !== undefined) result.episodes.card = tile(parseNode(episodes.card, undefined, 0, false, api))
    if (episodes.toolbar !== undefined) result.episodes.toolbar = choice(episodes.toolbar, ['bar', 'header'])
    if (episodes.controls !== undefined) result.episodes.controls = controlList(episodes.controls)
    if (episodes.paging !== undefined) result.episodes.paging = choice(episodes.paging, ['pages', 'ranges', 'dropdown'])
    if (episodes.pageSize !== undefined) result.episodes.pageSize = episodes.pageSize === 'auto' ? 'auto' : whole(episodes.pageSize, 12, 200)
    if (episodes.toolbarMin !== undefined) result.episodes.toolbarMin = whole(episodes.toolbarMin, 0, 100)
    if (episodes.seasons !== undefined) result.episodes.seasons = choice(episodes.seasons, ['chips', 'posters', 'dropdown', 'none'])
    if (episodes.download !== undefined) result.episodes.download = choice(episodes.download, ['none', 'button'])
    if (episodes.seasonsScroll !== undefined) result.episodes.seasonsScroll = choice(episodes.seasonsScroll, ['active', 'start'])
  }
  return result
}
function parseShell(value: unknown, api: ThemeApi): ShellPresentation {
  const raw = record(value); only(raw, ['nav', 'compact', 'overlay', 'press', ...api2(api, ['bottomNav']), ...api3(api, ['top', 'hints'])])
  const result: ShellPresentation = {}
  if (raw.nav !== undefined) result.nav = choice(raw.nav, ['sidebar', 'top', 'bottom'])
  if (raw.compact !== undefined) result.compact = flag(raw.compact)
  if (raw.overlay !== undefined) result.overlay = choice(raw.overlay, ['none', 'fade'])
  if (raw.press !== undefined) result.press = choice(raw.press, ['none', 'sink'])
  if (raw.bottomNav !== undefined) result.bottomNav = parseBottomNav(raw.bottomNav, api)
  if (raw.top !== undefined) result.top = parseTopBar(raw.top)
  if (raw.hints !== undefined) result.hints = flag(raw.hints)
  return result
}
function parsePlayer(value: unknown, api: ThemeApi): PlayerPresentation {
  const raw = record(value); only(raw, ['seekbarHeight', 'seekbarColor', ...api2(api, ['layout', 'dock'])])
  const result: PlayerPresentation = {}
  if (raw.seekbarHeight !== undefined) result.seekbarHeight = number(raw.seekbarHeight, 2, 16)
  if (raw.seekbarColor !== undefined) result.seekbarColor = themeColor(raw.seekbarColor)
  if (raw.layout !== undefined) result.layout = choice(raw.layout, ['full', 'docked'])
  if (raw.dock !== undefined) {
    const dock = record(raw.dock); only(dock, ['episodes', 'width', 'align', 'comments', ...api3(api, ['flow', 'maxWidth', 'below', 'toolbar', 'hide'])])
    result.dock = {}
    if (dock.episodes !== undefined) result.dock.episodes = choice(dock.episodes, ['right', 'below'])
    if (dock.width !== undefined) result.dock.width = number(dock.width, 50, 100)
    if (dock.align !== undefined) result.dock.align = choice(dock.align, ['start', 'center'])
    if (dock.comments !== undefined) result.dock.comments = choice(dock.comments, ['below', 'hidden'])
    if (dock.flow !== undefined) result.dock.flow = choice(dock.flow, ['fixed', 'page'])
    if (dock.maxWidth !== undefined) result.dock.maxWidth = number(dock.maxWidth, 480, 2400)
    if (dock.below !== undefined) result.dock.below = uniqueChoices(dock.below, ['toolbar', 'info', 'episodes', 'comments'], 'dock.below')
    if (dock.toolbar !== undefined) result.dock.toolbar = uniqueChoices(dock.toolbar, ['server', 'episode', 'release', 'download'], 'dock.toolbar')
    if (dock.hide !== undefined) result.dock.hide = uniqueChoices(dock.hide, ['back', 'title'], 'dock.hide')
  }
  return result
}
/** A list of distinct values from a fixed set, in the theme's order (`min`, 1 by default, to every value). */
function uniqueChoices<const T extends string>(value: unknown, values: readonly T[], name: string, min = 1): T[] {
  if (!Array.isArray(value) || value.length < min || value.length > values.length) throw new Error(`Invalid theme ${name} list.`)
  const seen = new Set<T>()
  return value.map((entry) => {
    const item = choice(entry, values)
    if (seen.has(item)) throw new Error(`A theme ${name} list names ${item} twice.`)
    seen.add(item)
    return item
  })
}
function parseCards(value: unknown, api: ThemeApi): NonNullable<ThemePresentation['cards']> {
  const raw = record(value); only(raw, ['poster', 'continue', 'search'])
  const result: NonNullable<ThemePresentation['cards']> = {}
  for (const family of ['poster', 'continue', 'search'] as const) {
    if (raw[family] !== undefined) result[family] = tile(parseNode(raw[family], undefined, 0, false, api))
  }
  return result
}
function destinationList(value: unknown, max: number): NavDestination[] {
  if (!Array.isArray(value) || value.length > max) throw new Error(`A theme can place up to ${max} destinations there.`)
  const seen = new Set<string>()
  return value.map((id) => {
    const destination = choice(id, NAV_DESTINATIONS)
    if (seen.has(destination)) throw new Error('A theme lists a destination twice.')
    seen.add(destination)
    return destination
  })
}
function parseLayout(value: unknown, phone: boolean, api: ThemeApi): ThemeLayout {
  const raw = record(value); only(raw, ['home', 'asideWidth', 'asideGap', 'asideStart', ...(phone ? [] : ['nav'])])
  const result: ThemeLayout = {}
  if (raw.home !== undefined) {
    if (!Array.isArray(raw.home) || raw.home.length < 1 || raw.home.length > 30) throw new Error('A theme home layout needs 1–30 entries.')
    let hero = false
    result.home = raw.home.map((entry): ThemeLayoutEntry => {
      const item = record(entry)
      if (item.role !== undefined) {
        only(item, ['role'])
        if (typeof item.role !== 'string' || !/^\S{1,300}$/.test(item.role)) throw new Error('Invalid theme row role.')
        if (item.role === 'hero') {
          if (hero) throw new Error('A theme home layout can place the hero once.')
          hero = true
        }
        return { role: item.role }
      }
      const { type, ...settings } = parseThemeBlock(item, api)
      return { block: type, ...settings } as ThemeLayoutEntry
    })
  }
  if (raw.asideWidth !== undefined) result.asideWidth = number(raw.asideWidth, 240, 420)
  if (raw.asideGap !== undefined) result.asideGap = number(raw.asideGap, 0, 96)
  if (raw.asideStart !== undefined) result.asideStart = number(raw.asideStart, 0, 29)
  if (raw.nav !== undefined) {
    const nav = record(raw.nav); only(nav, ['home', 'bottom', 'top'])
    result.nav = {}
    if (nav.home !== undefined) {
      const home = number(nav.home, 0, 5)
      if (!Number.isInteger(home)) throw new Error('A theme dimension is outside the supported range.')
      result.nav.home = home
    }
    if (nav.bottom !== undefined) result.nav.bottom = destinationList(nav.bottom, 5)
    if (nav.top !== undefined) result.nav.top = destinationList(nav.top, 4)
    // A header icon that repeats a bottom-bar tab is a shortcut, not a second placement: it renders
    // only in the phone Home header, and the navigation settings keep one row per destination.
    if (api < 4 && result.nav.bottom?.some((id) => result.nav?.top?.includes(id))) throw new Error('A destination can sit on the bottom bar or the top, not both.')
  }
  return result
}
const MOBILE_KEYS = ['density', 'hideCardLabels', 'trueBlack', 'hero', 'rows', 'detail', 'player', 'cards', 'layout']
function parseMobile(value: unknown, api: ThemeApi): MobilePresentation {
  const raw = record(value); only(raw, [...MOBILE_KEYS, ...api4(api, ['rootSize'])])
  // The root size is phone-only, so the shared parser (which also reads the top level) never accepts it.
  const { rootSize, ...shared } = raw
  const result: MobilePresentation = parsePresentation(shared, api, true)
  if (rootSize !== undefined) result.rootSize = number(rootSize, 14, 18)
  return result
}
/** Validate a presentation. `api` is the package's declared theme API: API 1 packages get the
 *  original key set (so they behave identically on every client), API 2 the additions. Personal
 *  Theme Studio designs and previews use the newest API. `phone` marks a `mobile` block being
 *  parsed, so its layout cannot carry navigation (phones always use the bottom bar). */
export function parsePresentation(value: unknown, api: ThemeApi = LATEST_THEME_API, phone = false): ThemePresentation {
  const raw = record(value)
  only(raw, ['density', 'hideCardLabels', 'trueBlack', 'hero', 'rows', 'detail', 'shell', 'player', 'cards', ...api2(api, ['mobile']), ...api3(api, ['layout', 'cardPreview'])])
  const result: ThemePresentation = {}
  if (raw.mobile !== undefined) result.mobile = parseMobile(raw.mobile, api)
  if (raw.density !== undefined) result.density = choice(raw.density, ['compact', 'comfortable', 'large'])
  if (raw.hideCardLabels !== undefined) result.hideCardLabels = flag(raw.hideCardLabels)
  if (raw.trueBlack !== undefined) result.trueBlack = flag(raw.trueBlack)
  if (raw.hero !== undefined) {
    const hero = record(raw.hero); only(hero, ['hidden', 'height', 'mobileHeight', 'rotate', 'interval', 'rankHidden', 'rank', 'template', 'scale', ...api2(api, ['indicator']), ...api3(api, ['bleed']), ...api4(api, ['limit', 'source', 'transition'])])
    result.hero = {}
    for (const key of ['hidden', 'rotate', 'rankHidden'] as const) if (hero[key] !== undefined) result.hero[key] = flag(hero[key])
    for (const key of ['height', 'mobileHeight'] as const) if (hero[key] !== undefined) result.hero[key] = number(hero[key], 24, 75)
    if (hero.scale !== undefined) result.hero.scale = choice(hero.scale, api >= 3 ? ['viewport', 'banner', 'wide'] : ['viewport', 'banner'])
    if (hero.bleed !== undefined) result.hero.bleed = number(hero.bleed, 0, 480)
    if (hero.interval !== undefined) result.hero.interval = number(hero.interval, 5, 60)
    if (hero.rank !== undefined) result.hero.rank = tile(parseNode(hero.rank, undefined, 0, false, api))
    if (hero.template !== undefined) result.hero.template = parseNode(hero.template, undefined, 0, true, api)
    if (hero.indicator !== undefined) result.hero.indicator = parseIndicator(hero.indicator, api)
    if (hero.limit !== undefined) result.hero.limit = whole(hero.limit, 1, 15)
    if (hero.source !== undefined) result.hero.source = choice(hero.source, ['season', 'trending'])
    if (hero.transition !== undefined) result.hero.transition = choice(hero.transition, ['slide', 'fade'])
  }
  if (raw.rows !== undefined) {
    const rows = record(raw.rows); only(rows, ['defaults', 'byId']); result.rows = {}
    if (rows.defaults !== undefined) result.rows.defaults = parseRow(rows.defaults, api)
    if (rows.byId !== undefined) {
      const byId = record(rows.byId)
      if (Object.keys(byId).length > 100) throw new Error('Too many row overrides.')
      result.rows.byId = Object.fromEntries(Object.entries(byId).map(([id, row]) => {
        if (!/^[a-z0-9][a-z0-9:._/-]{0,199}$/i.test(id) || ['__proto__', 'constructor', 'prototype'].includes(id)) throw new Error('Invalid theme row identity.')
        return [id, parseRow(row, api)]
      }))
    }
  }
  if (raw.detail !== undefined) result.detail = parseDetail(raw.detail, api)
  if (raw.shell !== undefined) result.shell = parseShell(raw.shell, api)
  if (raw.player !== undefined) result.player = parsePlayer(raw.player, api)
  if (raw.cards !== undefined) result.cards = parseCards(raw.cards, api)
  if (raw.layout !== undefined) result.layout = parseLayout(raw.layout, phone, api)
  if (raw.cardPreview !== undefined) result.cardPreview = choice(raw.cardPreview, ['popup', 'none'])
  return result
}
/** The presentation for one surface: on a phone the `mobile` block is layered over the shared one.
 *  Objects merge one level deep per section (a phone hero keeps the shared interval unless it says
 *  otherwise); a row override in `rows.byId` and a card family replace their shared entry whole. */
export function resolvePresentation(layout: ThemePresentation | undefined, mobile: boolean): ThemePresentation | undefined {
  if (!layout?.mobile) return layout
  const { mobile: phone, ...shared } = layout
  if (!mobile) return shared
  const resolved: ThemePresentation = { ...shared, ...phone }
  if (phone.hero) resolved.hero = { ...shared.hero, ...phone.hero }
  if (phone.rows) resolved.rows = {
    ...(shared.rows?.defaults || phone.rows.defaults ? { defaults: { ...shared.rows?.defaults, ...phone.rows.defaults } } : {}),
    ...(shared.rows?.byId || phone.rows.byId ? { byId: { ...shared.rows?.byId, ...phone.rows.byId } } : {}),
  }
  if (phone.detail) {
    resolved.detail = { ...shared.detail, ...phone.detail }
    if (phone.detail.episodes) resolved.detail.episodes = { ...shared.detail?.episodes, ...phone.detail.episodes }
    if (phone.detail.sections) resolved.detail.sections = { ...shared.detail?.sections, ...phone.detail.sections }
    if (phone.detail.factsLabels) resolved.detail.factsLabels = { ...shared.detail?.factsLabels, ...phone.detail.factsLabels }
    if (phone.detail.factsFormat) resolved.detail.factsFormat = { ...shared.detail?.factsFormat, ...phone.detail.factsFormat }
    if (phone.detail.synopsis) resolved.detail.synopsis = { ...shared.detail?.synopsis, ...phone.detail.synopsis }
    if (phone.detail.bar) resolved.detail.bar = { ...shared.detail?.bar, ...phone.detail.bar }
  }
  if (phone.player) resolved.player = { ...shared.player, ...phone.player }
  if (phone.cards) resolved.cards = { ...shared.cards, ...phone.cards }
  // The phone block can only carry `home` and the side-column keys (`parseLayout` rejects `nav` there), so
  // navigation always comes from the shared layout.
  if (phone.layout) resolved.layout = { ...shared.layout, ...phone.layout }
  return resolved
}
export function visibleNode(node: ThemeNode, model: DisplayModel): boolean {
  if (!node.when) return true
  const value = model[node.when.field]
  const present = value !== undefined && value !== '' && (node.when.atMost === undefined || (typeof value === 'number' && value > 0 && value <= node.when.atMost))
  return node.when.absent ? !present : present
}
/** Text for a bound field. The host owns number formatting so `score` reads the same in every template. */
export function displayText(field: DisplayField, model: DisplayModel): string {
  const value = model[field]
  if (value === undefined || value === '') return ''
  if (field === 'score' || field === 'progress') return `${value}%`
  if (field === 'duration') return `${value}m`
  if (field === 'episodeNumber') return `E${value}`
  return String(value)
}
export function nodeStyle(node: ThemeNode): string {
  const styles: Record<string, string> = { 'box-sizing': 'border-box' }
  if (['stack', 'row', 'grid', 'overlay'].includes(node.type)) {
    styles['min-width'] = '0'
    styles.display = node.type === 'grid' || node.type === 'overlay' ? 'grid' : 'flex'
    if (node.type === 'stack') styles['flex-direction'] = 'column'
    if (node.type === 'row') styles['flex-wrap'] = 'wrap'
    styles.position = 'relative'
  }
  if (node.type === 'artwork') {
    styles['object-fit'] = 'cover'
    if (node.style?.maxWidth === undefined) styles.width = '100%'
  }
  if (node.type === 'meter') { styles.width = '100%'; styles['min-height'] = '4px' }
  // `anchor` is applied after every other style entry so its absolute positioning cannot be
  // reordered away by JSON key order (an explicit `position` entry must never win over it).
  let anchor: string | undefined
  for (const [key, value] of Object.entries(node.style ?? {})) {
    const property = ({ radius: 'border-radius', fontSize: 'font-size', fontWeight: 'font-weight', minHeight: 'min-height', maxWidth: 'max-width', textAlign: 'text-align', align: 'align-items', justify: 'justify-content', fit: 'object-fit', aspect: 'aspect-ratio', grow: 'flex-grow', shrink: 'flex-shrink', wrap: 'flex-wrap' } as Record<string, string>)[key] ?? key
    if (key === 'lines') {
      const lines = Math.round(Number(value))
      styles.overflow = 'hidden'
      styles['overflow-wrap'] = 'normal'
      if (lines <= 1) {
        styles['white-space'] = 'nowrap'
        styles['text-overflow'] = 'ellipsis'
      } else {
        styles.display = '-webkit-box'
        styles['-webkit-box-orient'] = 'vertical'
        styles['-webkit-line-clamp'] = String(lines)
      }
    } else if (key === 'columns') styles['grid-template-columns'] = `repeat(${Math.round(Number(value))},minmax(0,1fr))`
    else if (key === 'anchor') anchor = String(value)
    else if (key === 'color' || key === 'background') styles[property] = String(value).startsWith('#') || value === 'transparent' ? String(value) : `hsl(var(--${value}))`
    else styles[property] = `${value}${numericStyles[key]?.[2] ?? ''}`
  }
  // A nowrap row may scroll sideways, never vertically: `overflow-x` alone computes `overflow-y: auto`,
  // and the row then took vertical swipes and wheels meant for the page. A card or badge tile is a
  // static picture, so a line inside one (a poster's meta line) clips instead of becoming a small
  // scroller that catches a wheel or swipe aimed at the row or the page.
  if (node.type === 'row' && node.style?.wrap === 'nowrap') {
    if (tileNodes.has(node)) styles.overflow = 'hidden'
    else { styles['overflow-x'] = 'auto'; styles['overflow-y'] = 'hidden' }
  }
  if (node.type === 'artwork' && node.style?.maxWidth !== undefined) styles.width = `${Number(node.style.maxWidth)}px`
  if (anchor !== undefined) {
    styles.position = 'absolute'
    if (anchor === 'fill') { styles.inset = '0'; styles.width = '100%'; styles.height = '100%' }
    else { styles[anchor.startsWith('bottom') ? 'bottom' : 'top'] = '0'; styles[`inset-inline-${anchor.endsWith('end') ? 'end' : 'start'}`] = '0' }
  }
  return Object.entries(styles).map(([key, value]) => `${key}:${value}`).join(';')
}
export function resolveRow(layout: ThemePresentation | undefined, id = ''): RowPresentation {
  const role = id.includes(':') ? id.slice(id.indexOf(':') + 1) : id
  return { ...layout?.rows?.defaults, ...layout?.rows?.byId?.[role], ...layout?.rows?.byId?.[id] }
}
export function resolveCard(layout: ThemePresentation | undefined, family: CardFamily = 'poster', rowId = ''): ThemeNode | undefined {
  const rowCard = rowId ? resolveRow(layout, rowId).card : undefined
  if (rowCard) return rowCard
  if (family === 'continue') return layout?.cards?.continue
  return layout?.cards?.[family] ?? layout?.cards?.poster
}
export function resolveDetail(layout?: ThemePresentation): Required<Pick<DetailPresentation, 'layout' | 'bannerHidden'>> & DetailPresentation {
  const detail = layout?.detail ?? {}
  const page = detail.layout ?? 'stack'
  const placement = detail.episodes?.placement ?? (page === 'split' ? 'right' : page === 'overlay' ? 'below' : 'tab')
  return {
    layout: page,
    bannerHidden: page === 'overlay' ? false : detail.bannerHidden === true,
    posterWidth: detail.posterWidth,
    facts: detail.facts,
    actionsFirst: detail.actionsFirst === true,
    coverAlign: detail.coverAlign,
    cta: detail.cta,
    bannerHeight: detail.bannerHeight,
    bannerScale: detail.bannerScale,
    tabs: detail.tabs,
    factsStyle: detail.factsStyle,
    countdown: detail.countdown,
    countdownAt: detail.countdownAt,
    countdownWithin: detail.countdownWithin,
    listButton: detail.listButton,
    buttons: detail.buttons,
    header: detail.header,
    actionsLead: detail.actionsLead,
    factsKeys: detail.factsKeys,
    infoKeys: detail.infoKeys,
    factsLabels: detail.factsLabels,
    factsFormat: detail.factsFormat,
    synopsis: detail.synopsis,
    art: detail.art,
    artFallback: detail.artFallback,
    bar: detail.bar,
    title: detail.title,
    sections: detail.sections,
    nav: detail.nav,
    continue: detail.continue,
    column: detail.column,
    episodes: {
      placement,
      arrangement: detail.episodes?.arrangement,
      hover: detail.episodes?.hover,
      order: detail.episodes?.order,
      search: detail.episodes?.search,
      card: detail.episodes?.card,
      toolbar: detail.episodes?.toolbar,
      controls: detail.episodes?.controls,
      paging: detail.episodes?.paging,
      pageSize: detail.episodes?.pageSize,
      toolbarMin: detail.episodes?.toolbarMin,
      seasons: detail.episodes?.seasons,
      download: detail.episodes?.download,
      seasonsScroll: detail.episodes?.seasonsScroll,
    },
  }
}
export interface ResolvedPlayerDock {
  docked: boolean
  episodes: 'right' | 'below'
  width: number
  align: 'start' | 'center'
  comments: 'below' | 'hidden'
  /** Beside a side rail `page` scrolls the stage's column with the discussion under it (the
   *  rail keeps its own scroller), so it is the default there; with nothing under the stage
   *  there is nothing to scroll to, and the layout stays `fixed`. */
  flow: 'fixed' | 'page'
  maxWidth?: number
  /** The blocks under the stage (below only): the theme's list, or the episode grid then the
   *  discussion unless `comments` hides it. */
  below: PlayerDockBlock[]
  toolbar: PlayerToolbarItem[]
  hide: PlayerChrome[]
}
/** The windowed desktop player layout with its defaults filled in. */
export function resolvePlayerDock(layout?: ThemePresentation): ResolvedPlayerDock {
  const player = layout?.player
  const episodes = player?.dock?.episodes ?? 'right'
  const comments = player?.dock?.comments ?? 'below'
  return {
    docked: player?.layout === 'docked',
    episodes,
    width: player?.dock?.width ?? (episodes === 'below' ? 100 : 68),
    align: player?.dock?.align ?? 'start',
    comments,
    flow: episodes === 'below' ? player?.dock?.flow ?? 'fixed' : comments === 'below' ? player?.dock?.flow ?? 'page' : 'fixed',
    maxWidth: player?.dock?.maxWidth,
    below: player?.dock?.below ?? (comments === 'below' ? ['episodes', 'comments'] : ['episodes']),
    toolbar: player?.dock?.toolbar ?? ['server', 'episode', 'release', 'download'],
    hide: player?.dock?.hide ?? [],
  }
}
/** `color` values from a template or chrome block as CSS, optionally at a reduced alpha. */
export function themeColorCss(value: string | undefined, alpha?: number): string | undefined {
  if (!value) return undefined
  if (value === 'transparent') return value
  if (value.startsWith('#')) {
    if (alpha === undefined) return value
    const hex = Math.round(Math.max(0, Math.min(1, alpha)) * 255).toString(16).padStart(2, '0')
    return `${value.slice(0, 7)}${hex}`
  }
  return alpha === undefined ? `hsl(var(--${value}))` : `hsl(var(--${value}) / ${alpha})`
}
/** Right-hand episode rail is desktop-only. Narrow viewports fall back to a rail below the info column. */
export function episodesOnSide(layout?: ThemePresentation, desktop = true): boolean {
  const detail = resolveDetail(layout)
  return desktop && detail.layout !== 'overlay' && detail.episodes?.placement === 'right'
}
export function episodesBelow(layout?: ThemePresentation, desktop = true): boolean {
  const detail = resolveDetail(layout)
  if (detail.layout === 'overlay') return true
  const placement = detail.episodes?.placement
  return placement === 'below' || (placement === 'right' && !desktop)
}
export function densityScale(layout?: ThemePresentation): number {
  return layout?.density === 'compact' ? 0.86 : layout?.density === 'large' ? 1.16 : 1
}
export function themeCoverage(layout?: ThemePresentation): ThemeSurface[] {
  if (!layout) return []
  const surfaces: ThemeSurface[] = []
  const phone = layout.mobile ?? {}
  if (layout.hero || layout.rows || layout.cards || layout.cardPreview || layout.layout?.home || phone.hero || phone.rows || phone.cards || phone.layout?.home) surfaces.push('Home')
  if (layout.shell || layout.density || layout.hideCardLabels || layout.trueBlack || layout.layout?.nav || phone.density || phone.hideCardLabels || phone.trueBlack || phone.rootSize !== undefined) surfaces.push('Shell')
  if (layout.detail || phone.detail) surfaces.push('Details')
  if (layout.player || phone.player) surfaces.push('Player')
  return surfaces.length === 4 ? ['Full'] : surfaces
}
export interface TemplateOutline { type: ThemeNode['type']; label?: string; children?: TemplateOutline[] }
export function templateOutline(node: ThemeNode): TemplateOutline {
  return {
    type: node.type,
    label: node.field || node.action || node.artwork || node.icon || (node.text ? node.text.slice(0, 40) : undefined),
    children: node.children?.map(templateOutline),
  }
}
export function cssThemeColor(value: string): string {
  return value.startsWith('#') || value === 'transparent' ? value : `hsl(var(--${value}))`
}
