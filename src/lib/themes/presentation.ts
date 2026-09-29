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
/** Host numbers. `when.atMost` compares these; text nodes render them through `displayText`. */
export type NumericDisplayField = 'rankPosition' | 'score' | 'duration' | 'episodeNumber' | 'progress' | 'nextEpisode' | 'slide' | 'slides' | 'episodesAired'
/** `keyart` (API 3) is 16:9 title artwork: a TVDB background for AniList titles, a TMDB or add-on backdrop otherwise. */
export type ArtworkKind = 'poster' | 'backdrop' | 'logo' | 'still' | 'keyart'
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
/** API 3: the series page sections (`detail.sections`). */
export type DetailSection = 'overview' | 'episodes' | 'relations' | 'characters' | 'recommended'
/** API 3: the fixed tab names a theme picks from — never free text. */
export type TabLabel =
  | 'overview' | 'info' | 'details' | 'about' | 'home' | 'episodes' | 'watch' | 'relations' | 'related'
  | 'characters' | 'cast' | 'recommended' | 'more-like-this'
/** API 3: which sections get a tab, their names, the tab open on arrival, and where the phone facts sit. */
export interface DetailSections {
  /** `tabs` (default) draws a tab strip; `stack` renders every section in turn under its own title. */
  mode?: 'tabs' | 'stack'
  /** Sections with a tab, in order (1–5, each once). The rest render inside Overview after its own
   *  content; Overview always keeps a tab. */
  tabs?: DetailSection[]
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
}
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
}
/** Theme API 1 is the original contract; API 2 adds the phone block, bottom-bar and slide-marker
 *  chrome, row headings, series tabs and the docked player. A package declares which it uses, so
 *  a client that only knows API 1 refuses an API 2 package cleanly instead of failing mid-parse. */
export type ThemeApi = 1 | 2 | 3
/** The newest theme API this client renders. API 3 adds stylesheets, fonts, template parts,
 *  airing and slide fields, and the text wordmark. */
export const LATEST_THEME_API: ThemeApi = 3
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
  /** API 3: an airing countdown under the facts, compact ("2d 21h") or long ("4 days 19 hrs"). */
  countdown?: 'none' | 'compact' | 'long'
  /** API 3: the tracker list button — inline (default), a full-width outlined button, or hidden. */
  listButton?: 'inline' | 'full' | 'hidden'
  /** API 3: a template under the series title on phones and desktop (a studio chip, a score, a meta
   *  line), whatever `factsStyle` shows. Non-interactive, like card templates. */
  header?: ThemeNode
  /** API 3: the overlay artwork — the catalog banner (default) or 16:9 key art when the title has it. */
  art?: 'banner' | 'keyart'
  /** API 3: the series title as text (default) or the title logo when there is one, on every layout. */
  title?: 'text' | 'logo'
  /** API 3: which sections get tabs, their names, the default tab, and where the phone facts sit. */
  sections?: DetailSections
  /** API 3: `hidden` covers the phone's bottom navigation while the series page is open. */
  nav?: 'shown' | 'hidden'
  /** API 3: `card` puts a Continue card at the top of the episodes; on phones it replaces the
   *  header's Play button once an episode has aired. */
  continue?: 'button' | 'card'
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
  /** `scroll` slides the bar away while scrolling down (the default); `never` keeps it put. */
  hide?: 'scroll' | 'never'
}
/** API 3: the desktop top bar (`shell.nav: "top"`). */
export interface TopBarPresentation {
  /** `icons` (default) shows icons only, `text` destination names as links, `both` icon and name. */
  labels?: 'icons' | 'text' | 'both'
  /** `field-center` / `field-end` put a search field in the bar in place of the Search destination. */
  search?: 'icon' | 'field-center' | 'field-end'
  /** `drawer` adds a menu button that opens every destination in a side drawer. */
  menu?: 'none' | 'drawer'
  /** Where the brand sits in the bar. */
  brand?: 'start' | 'center'
  /** A "Categories" menu after the destinations: browse links and the catalog's genres. */
  categories?: boolean
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
}
/** Where the video sits while playing windowed on desktop. `full` fills the window inside the
 *  shell chrome; `docked` confines it to a 16:9 stage with the episode rail beside or below it. */
export interface PlayerDock {
  episodes?: 'right' | 'below'
  width?: number
  align?: 'start' | 'center'
  /** The episode discussion under the stage (side rail) or after the episode grid (below). */
  comments?: 'below' | 'hidden'
}
export interface PlayerPresentation {
  seekbarHeight?: number
  seekbarColor?: string
  layout?: 'full' | 'docked'
  dock?: PlayerDock
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
  top?: NavDestination[]
}
/** API 3: the theme's Home and navigation, applied while the theme is active and its layout switch is on. */
export interface ThemeLayout {
  home?: ThemeLayoutEntry[]
  asideWidth?: number
  /** The gutter between Home's main column and its side column, in px (default 32). */
  asideGap?: number
  nav?: ThemeNav
}
export interface ThemePresentation {
  density?: ThemeDensity
  hideCardLabels?: boolean
  trueBlack?: boolean
  hero?: { hidden?: boolean; height?: number; mobileHeight?: number; rotate?: boolean; interval?: number; rankHidden?: boolean; rank?: ThemeNode; template?: ThemeNode; scale?: 'viewport' | 'banner' | 'wide'; indicator?: HeroIndicator; bleed?: number }
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
}
/** What a phone variant can change. Navigation is always the bottom bar there, so `shell` stays shared. */
export type MobilePresentation = Pick<ThemePresentation, 'density' | 'hideCardLabels' | 'trueBlack' | 'hero' | 'rows' | 'detail' | 'player' | 'cards' | 'layout'>
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
] as const satisfies readonly DisplayField[]
const API3_FIELDS: readonly DisplayField[] = ['nextEpisode', 'airingIn', 'airingCountdown', 'slide', 'slides', 'episodesAired', 'genre', 'ageRating', 'audio', 'timeLeft', 'episodeNo', 'episodeCode', 'watched', 'filler', 'rating', 'episodeName']
/** An API 1/2 package is held to the fields its clients know, so it renders identically everywhere. */
const fieldsFor = (api: ThemeApi) => (api >= 3 ? fields : fields.filter(field => !API3_FIELDS.includes(field)))
const numericFields: string[] = ['rankPosition', 'score', 'duration', 'episodeNumber', 'progress', 'nextEpisode', 'slide', 'slides', 'episodesAired'] satisfies NumericDisplayField[]
const actions = ['play', 'details', 'favorite', 'previous', 'next', 'list', 'trailer', 'share']
const artworkKinds = ['poster', 'backdrop', 'logo', 'still', 'keyart'] as const
/** Key art is API 3; older packages keep the artwork their clients know. */
const artworkFor = (api: ThemeApi): readonly ArtworkKind[] => (api >= 3 ? artworkKinds : artworkKinds.filter((kind) => kind !== 'keyart'))
const DETAIL_SECTIONS = ['overview', 'episodes', 'relations', 'characters', 'recommended'] as const satisfies readonly DetailSection[]
/** The fixed names each section may take (`detail.sections.labels`). */
const SECTION_LABELS: Record<DetailSection, readonly TabLabel[]> = {
  overview: ['overview', 'info', 'details', 'about', 'home'],
  episodes: ['episodes', 'watch'],
  relations: ['relations', 'related'],
  characters: ['characters', 'cast'],
  recommended: ['recommended', 'more-like-this'],
}
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
      if (!numericFields.includes(node.when.field)) throw new Error('atMost only applies to numeric fields: rankPosition, score, duration, episodeNumber, progress, nextEpisode, slide, slides and episodesAired.')
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
  const raw = record(value); only(raw, ['layout', 'width', 'gap', 'spacing', 'radius', 'aspect', 'titleSize', 'card', ...api2(api, ['heading'])])
  const result: RowPresentation = {}
  if (raw.layout !== undefined) result.layout = choice(raw.layout, ['carousel', 'grid'])
  if (raw.aspect !== undefined) result.aspect = choice(raw.aspect, ['poster', 'landscape', 'square'])
  for (const [key, min, max] of [['width', 96, 400], ['gap', 0, 48], ['spacing', 0, 100], ['radius', 0, 48], ['titleSize', 12, 32]] as const) {
    if (raw[key] !== undefined) result[key] = number(raw[key], min, max)
  }
  if (raw.heading !== undefined) result.heading = parseHeading(raw.heading)
  if (raw.card !== undefined) result.card = parseNode(raw.card, undefined, 0, false, api)
  return result
}
function parseBottomNav(value: unknown): BottomNavPresentation {
  const raw = record(value); only(raw, ['style', 'labels', 'indicator', 'height', 'iconSize', 'radius', 'background', 'activeColor', 'inactiveColor', 'blur', 'border', 'hide'])
  const result: BottomNavPresentation = {}
  if (raw.style !== undefined) result.style = choice(raw.style, ['bar', 'floating', 'pill'])
  if (raw.labels !== undefined) result.labels = choice(raw.labels, ['always', 'active', 'none'])
  if (raw.indicator !== undefined) result.indicator = choice(raw.indicator, ['none', 'pill', 'line', 'dot'])
  if (raw.height !== undefined) result.height = number(raw.height, 44, 88)
  if (raw.iconSize !== undefined) result.iconSize = number(raw.iconSize, 16, 30)
  if (raw.radius !== undefined) result.radius = number(raw.radius, 0, 40)
  for (const key of ['background', 'activeColor', 'inactiveColor'] as const) if (raw[key] !== undefined) result[key] = themeColor(raw[key])
  for (const key of ['blur', 'border'] as const) if (raw[key] !== undefined) result[key] = flag(raw[key])
  if (raw.hide !== undefined) result.hide = choice(raw.hide, ['scroll', 'never'])
  return result
}
function parseTopBar(value: unknown): TopBarPresentation {
  const raw = record(value); only(raw, ['labels', 'search', 'menu', 'brand', 'categories'])
  const result: TopBarPresentation = {}
  if (raw.labels !== undefined) result.labels = choice(raw.labels, ['icons', 'text', 'both'])
  if (raw.search !== undefined) result.search = choice(raw.search, ['icon', 'field-center', 'field-end'])
  if (raw.menu !== undefined) result.menu = choice(raw.menu, ['none', 'drawer'])
  if (raw.brand !== undefined) result.brand = choice(raw.brand, ['start', 'center'])
  if (raw.categories !== undefined) result.categories = flag(raw.categories)
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
function parseSections(value: unknown): DetailSections {
  const raw = record(value); only(raw, ['mode', 'tabs', 'labels', 'default', 'info'])
  const result: DetailSections = {}
  if (raw.mode !== undefined) result.mode = choice(raw.mode, ['tabs', 'stack'])
  if (raw.tabs !== undefined) {
    if (!Array.isArray(raw.tabs) || raw.tabs.length < 1 || raw.tabs.length > 5) throw new Error('A theme series page needs 1–5 tabs.')
    const seen = new Set<DetailSection>()
    result.tabs = raw.tabs.map((id) => {
      const section = choice(id, DETAIL_SECTIONS)
      if (seen.has(section)) throw new Error('A theme lists a series section twice.')
      seen.add(section)
      return section
    })
  }
  if (raw.labels !== undefined) {
    const labels = record(raw.labels); only(labels, [...DETAIL_SECTIONS])
    result.labels = {}
    for (const section of DETAIL_SECTIONS) {
      if (labels[section] !== undefined) result.labels[section] = choice(labels[section], SECTION_LABELS[section])
    }
  }
  if (raw.default !== undefined) {
    result.default = choice(raw.default, DETAIL_SECTIONS)
    // Overview always has a tab, so it is a valid default whatever `tabs` lists.
    if (result.tabs && result.default !== 'overview' && !result.tabs.includes(result.default)) throw new Error('The default series tab must be one of its tabs.')
  }
  if (raw.info !== undefined) result.info = choice(raw.info, ['above', 'overview'])
  return result
}
function parseDetail(value: unknown, api: ThemeApi): DetailPresentation {
  const raw = record(value); only(raw, ['layout', 'bannerHidden', 'posterWidth', 'facts', 'actionsFirst', 'coverAlign', 'cta', 'bannerHeight', 'bannerScale', 'episodes', ...api2(api, ['tabs']), ...api3(api, ['factsStyle', 'countdown', 'listButton', 'header', 'art', 'title', 'sections', 'nav', 'continue'])])
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
  if (raw.countdown !== undefined) result.countdown = choice(raw.countdown, ['none', 'compact', 'long'])
  if (raw.listButton !== undefined) result.listButton = choice(raw.listButton, ['inline', 'full', 'hidden'])
  if (raw.header !== undefined) result.header = parseNode(raw.header, undefined, 0, false, api)
  if (raw.art !== undefined) result.art = choice(raw.art, ['banner', 'keyart'])
  if (raw.title !== undefined) result.title = choice(raw.title, ['text', 'logo'])
  if (raw.sections !== undefined) result.sections = parseSections(raw.sections)
  if (raw.nav !== undefined) result.nav = choice(raw.nav, ['shown', 'hidden'])
  if (raw.continue !== undefined) result.continue = choice(raw.continue, ['button', 'card'])
  if (raw.episodes !== undefined) {
    const episodes = record(raw.episodes); only(episodes, ['placement', 'arrangement', 'hover', 'order', 'search', 'card', ...api3(api, ['toolbar', 'controls', 'paging', 'pageSize', 'toolbarMin', 'seasons'])])
    result.episodes = {}
    if (episodes.placement !== undefined) result.episodes.placement = choice(episodes.placement, ['tab', 'right', 'below'])
    if (episodes.arrangement !== undefined) result.episodes.arrangement = choice(episodes.arrangement, ['list', 'grid', 'carousel'])
    if (episodes.hover !== undefined) result.episodes.hover = choice(episodes.hover, ['scale', 'none'])
    if (episodes.order !== undefined) result.episodes.order = choice(episodes.order, api >= 3 ? ['tabs', 'flip', 'none'] : ['tabs', 'flip'])
    if (episodes.search !== undefined) result.episodes.search = api >= 3 && episodes.search === 'field' ? 'field' : flag(episodes.search)
    if (episodes.card !== undefined) result.episodes.card = parseNode(episodes.card, undefined, 0, false, api)
    if (episodes.toolbar !== undefined) result.episodes.toolbar = choice(episodes.toolbar, ['bar', 'header'])
    if (episodes.controls !== undefined) result.episodes.controls = controlList(episodes.controls)
    if (episodes.paging !== undefined) result.episodes.paging = choice(episodes.paging, ['pages', 'ranges', 'dropdown'])
    if (episodes.pageSize !== undefined) result.episodes.pageSize = episodes.pageSize === 'auto' ? 'auto' : whole(episodes.pageSize, 12, 200)
    if (episodes.toolbarMin !== undefined) result.episodes.toolbarMin = whole(episodes.toolbarMin, 0, 100)
    if (episodes.seasons !== undefined) result.episodes.seasons = choice(episodes.seasons, ['chips', 'posters', 'dropdown', 'none'])
  }
  return result
}
function parseShell(value: unknown, api: ThemeApi): ShellPresentation {
  const raw = record(value); only(raw, ['nav', 'compact', 'overlay', 'press', ...api2(api, ['bottomNav']), ...api3(api, ['top'])])
  const result: ShellPresentation = {}
  if (raw.nav !== undefined) result.nav = choice(raw.nav, ['sidebar', 'top', 'bottom'])
  if (raw.compact !== undefined) result.compact = flag(raw.compact)
  if (raw.overlay !== undefined) result.overlay = choice(raw.overlay, ['none', 'fade'])
  if (raw.press !== undefined) result.press = choice(raw.press, ['none', 'sink'])
  if (raw.bottomNav !== undefined) result.bottomNav = parseBottomNav(raw.bottomNav)
  if (raw.top !== undefined) result.top = parseTopBar(raw.top)
  return result
}
function parsePlayer(value: unknown, api: ThemeApi): PlayerPresentation {
  const raw = record(value); only(raw, ['seekbarHeight', 'seekbarColor', ...api2(api, ['layout', 'dock'])])
  const result: PlayerPresentation = {}
  if (raw.seekbarHeight !== undefined) result.seekbarHeight = number(raw.seekbarHeight, 2, 16)
  if (raw.seekbarColor !== undefined) result.seekbarColor = themeColor(raw.seekbarColor)
  if (raw.layout !== undefined) result.layout = choice(raw.layout, ['full', 'docked'])
  if (raw.dock !== undefined) {
    const dock = record(raw.dock); only(dock, ['episodes', 'width', 'align', 'comments'])
    result.dock = {}
    if (dock.episodes !== undefined) result.dock.episodes = choice(dock.episodes, ['right', 'below'])
    if (dock.width !== undefined) result.dock.width = number(dock.width, 50, 100)
    if (dock.align !== undefined) result.dock.align = choice(dock.align, ['start', 'center'])
    if (dock.comments !== undefined) result.dock.comments = choice(dock.comments, ['below', 'hidden'])
  }
  return result
}
function parseCards(value: unknown, api: ThemeApi): NonNullable<ThemePresentation['cards']> {
  const raw = record(value); only(raw, ['poster', 'continue', 'search'])
  const result: NonNullable<ThemePresentation['cards']> = {}
  for (const family of ['poster', 'continue', 'search'] as const) {
    if (raw[family] !== undefined) result[family] = parseNode(raw[family], undefined, 0, false, api)
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
function parseLayout(value: unknown, phone: boolean): ThemeLayout {
  const raw = record(value); only(raw, ['home', 'asideWidth', 'asideGap', ...(phone ? [] : ['nav'])])
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
      const { type, ...settings } = parseThemeBlock(item)
      return { block: type, ...settings } as ThemeLayoutEntry
    })
  }
  if (raw.asideWidth !== undefined) result.asideWidth = number(raw.asideWidth, 240, 420)
  if (raw.asideGap !== undefined) result.asideGap = number(raw.asideGap, 0, 96)
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
    if (result.nav.bottom?.some((id) => result.nav?.top?.includes(id))) throw new Error('A destination can sit on the bottom bar or the top, not both.')
  }
  return result
}
const MOBILE_KEYS = ['density', 'hideCardLabels', 'trueBlack', 'hero', 'rows', 'detail', 'player', 'cards', 'layout']
function parseMobile(value: unknown, api: ThemeApi): MobilePresentation {
  const raw = record(value); only(raw, MOBILE_KEYS)
  return parsePresentation(raw, api, true)
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
    const hero = record(raw.hero); only(hero, ['hidden', 'height', 'mobileHeight', 'rotate', 'interval', 'rankHidden', 'rank', 'template', 'scale', ...api2(api, ['indicator']), ...api3(api, ['bleed'])])
    result.hero = {}
    for (const key of ['hidden', 'rotate', 'rankHidden'] as const) if (hero[key] !== undefined) result.hero[key] = flag(hero[key])
    for (const key of ['height', 'mobileHeight'] as const) if (hero[key] !== undefined) result.hero[key] = number(hero[key], 24, 75)
    if (hero.scale !== undefined) result.hero.scale = choice(hero.scale, api >= 3 ? ['viewport', 'banner', 'wide'] : ['viewport', 'banner'])
    if (hero.bleed !== undefined) result.hero.bleed = number(hero.bleed, 0, 480)
    if (hero.interval !== undefined) result.hero.interval = number(hero.interval, 5, 60)
    if (hero.rank !== undefined) result.hero.rank = parseNode(hero.rank, undefined, 0, false, api)
    if (hero.template !== undefined) result.hero.template = parseNode(hero.template, undefined, 0, true, api)
    if (hero.indicator !== undefined) result.hero.indicator = parseIndicator(hero.indicator, api)
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
  if (raw.layout !== undefined) result.layout = parseLayout(raw.layout, phone)
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
  }
  if (phone.player) resolved.player = { ...shared.player, ...phone.player }
  if (phone.cards) resolved.cards = { ...shared.cards, ...phone.cards }
  // The phone block can only carry `home`, `asideWidth` and `asideGap` (`parseLayout` rejects `nav` there), so
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
  if (node.type === 'row' && node.style?.wrap === 'nowrap') styles['overflow-x'] = 'auto'
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
    listButton: detail.listButton,
    header: detail.header,
    art: detail.art,
    title: detail.title,
    sections: detail.sections,
    nav: detail.nav,
    continue: detail.continue,
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
    },
  }
}
/** The windowed desktop player layout with its defaults filled in. */
export function resolvePlayerDock(layout?: ThemePresentation): { docked: boolean; episodes: 'right' | 'below'; width: number; align: 'start' | 'center'; comments: 'below' | 'hidden' } {
  const player = layout?.player
  return {
    docked: player?.layout === 'docked',
    episodes: player?.dock?.episodes ?? 'right',
    width: player?.dock?.width ?? (player?.dock?.episodes === 'below' ? 100 : 68),
    align: player?.dock?.align ?? 'start',
    comments: player?.dock?.comments ?? 'below',
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
  if (layout.shell || layout.density || layout.hideCardLabels || layout.trueBlack || layout.layout?.nav || phone.density || phone.hideCardLabels || phone.trueBlack) surfaces.push('Shell')
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
