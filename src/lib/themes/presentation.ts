/** Data-only presentation API. No HTML, executable expressions, selectors, or remote assets. */
export type DisplayField =
  | 'title' | 'description' | 'rank' | 'rankPosition' | 'score' | 'format' | 'year'
  | 'studio' | 'season' | 'status' | 'genres' | 'members' | 'reviews'
  | 'episodeCount' | 'episodeTitle' | 'airDate' | 'duration' | 'episodeNumber' | 'progress'
  | 'source' | 'country'
  | 'nextEpisode' | 'airingIn' | 'airingCountdown' | 'slide' | 'slides' | 'episodesAired'
/** Host numbers. `when.atMost` compares these; text nodes render them through `displayText`. */
export type NumericDisplayField = 'rankPosition' | 'score' | 'duration' | 'episodeNumber' | 'progress' | 'nextEpisode' | 'slide' | 'slides' | 'episodesAired'
export type ArtworkKind = 'poster' | 'backdrop' | 'logo' | 'still'
export type ThemeAction = 'play' | 'details' | 'favorite' | 'previous' | 'next' | 'list' | 'trailer' | 'share'
export type CardFamily = 'poster' | 'continue' | 'search'
export type ThemeDensity = 'compact' | 'comfortable' | 'large'
export type ThemeNavPlacement = 'sidebar' | 'top' | 'bottom'
export type DetailLayout = 'stack' | 'split' | 'overlay'
export type EpisodePlacement = 'tab' | 'right' | 'below'
export type EpisodeArrangement = 'list' | 'grid' | 'carousel'
export type EpisodeHover = 'scale' | 'none'
export type EpisodeOrderControl = 'tabs' | 'flip'
export type ThemeIcon =
  | 'score' | 'format' | 'episodes' | 'reviews' | 'studio' | 'season' | 'status' | 'source' | 'country' | 'duration'
export type ThemeSurface = 'Home' | 'Shell' | 'Details' | 'Player' | 'Full'
export interface ThemeNode {
  type: 'stack' | 'row' | 'grid' | 'overlay' | 'text' | 'artwork' | 'action' | 'icon' | 'meter'
  text?: string
  field?: DisplayField
  artwork?: ArtworkKind
  action?: ThemeAction
  icon?: ThemeIcon
  when?: { field: DisplayField; atMost?: number }
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
 *  equal tabs with a tinted pill behind the active one (the two-tab Info/Watch bar of some apps). */
export type DetailTabs = 'underline' | 'pills' | 'segmented' | 'bar'
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
  episodes?: { placement?: EpisodePlacement; arrangement?: EpisodeArrangement; hover?: EpisodeHover; order?: EpisodeOrderControl; search?: boolean; card?: ThemeNode }
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
export interface ShellPresentation {
  nav?: ThemeNavPlacement
  compact?: boolean
  /** `fade` paints a scrim from the rail into the page so full-bleed banners meet the menu. */
  overlay?: 'none' | 'fade'
  /** `sink` darkens and nudges a control down while it is held. */
  press?: 'none' | 'sink'
  bottomNav?: BottomNavPresentation
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
}
/** Row heading chrome. `titleSize` on the row stays the size control. */
export interface RowHeading {
  weight?: number
  transform?: 'none' | 'uppercase'
  accent?: 'none' | 'bar' | 'dot' | 'underline'
  viewMore?: 'text' | 'arrow' | 'hidden'
}
export interface ThemePresentation {
  density?: ThemeDensity
  hideCardLabels?: boolean
  trueBlack?: boolean
  hero?: { hidden?: boolean; height?: number; mobileHeight?: number; rotate?: boolean; interval?: number; rankHidden?: boolean; rank?: ThemeNode; template?: ThemeNode; scale?: 'viewport' | 'banner'; indicator?: HeroIndicator }
  rows?: { defaults?: RowPresentation; byId?: Record<string, RowPresentation> }
  detail?: DetailPresentation
  shell?: ShellPresentation
  player?: PlayerPresentation
  cards?: Partial<Record<CardFamily, ThemeNode>>
  /** API 3: `text` swaps the SVG wordmark for letter spans a stylesheet can style. */
  brand?: 'mark' | 'text'
  /** Phone overrides (the Android app and any viewport up to 640px), resolved on top of the rest. */
  mobile?: MobilePresentation
}
/** What a phone variant can change. Navigation is always the bottom bar there, so `shell` stays shared. */
export type MobilePresentation = Pick<ThemePresentation, 'density' | 'hideCardLabels' | 'trueBlack' | 'hero' | 'rows' | 'detail' | 'player' | 'cards'>
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
  'nextEpisode', 'airingIn', 'airingCountdown', 'slide', 'slides', 'episodesAired',
] as const satisfies readonly DisplayField[]
const API3_FIELDS: readonly DisplayField[] = ['nextEpisode', 'airingIn', 'airingCountdown', 'slide', 'slides', 'episodesAired']
/** An API 1/2 package is held to the fields its clients know, so it renders identically everywhere. */
const fieldsFor = (api: ThemeApi) => (api >= 3 ? fields : fields.filter(field => !API3_FIELDS.includes(field)))
const numericFields: string[] = ['rankPosition', 'score', 'duration', 'episodeNumber', 'progress', 'nextEpisode', 'slide', 'slides', 'episodesAired'] satisfies NumericDisplayField[]
const actions = ['play', 'details', 'favorite', 'previous', 'next', 'list', 'trailer', 'share']
const artworkKinds = ['poster', 'backdrop', 'logo', 'still'] as const
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
const icons = ['score', 'format', 'episodes', 'reviews', 'studio', 'season', 'status', 'source', 'country', 'duration'] as const
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
  if (raw.artwork !== undefined) node.artwork = choice(raw.artwork, artworkKinds)
  if (node.type === 'artwork' && !node.artwork) throw new Error('Choose artwork for this template.')
  if (node.type === 'action') node.action = choice(raw.action, actions) as ThemeAction
  if (raw.icon !== undefined || node.type === 'icon') node.icon = choice(raw.icon, icons)
  if (node.type === 'icon' && !node.icon) throw new Error('Choose an icon for this template.')
  if (node.type === 'meter') {
    if (!node.field || !numericFields.includes(node.field)) throw new Error('A meter needs a numeric field.')
  }
  if (raw.when !== undefined) {
    const condition = record(raw.when); only(condition, ['field', 'atMost'])
    node.when = { field: choice(condition.field, fieldsFor(api)) }
    if (condition.atMost !== undefined) {
      if (!numericFields.includes(node.when.field)) throw new Error('atMost only applies to numeric fields: rankPosition, score, duration, episodeNumber, progress, nextEpisode, slide, slides and episodesAired.')
      node.when.atMost = number(condition.atMost, 0, 10000)
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
function parseIndicator(value: unknown): HeroIndicator {
  const raw = record(value); only(raw, ['style', 'position', 'color'])
  const result: HeroIndicator = {}
  if (raw.style !== undefined) result.style = choice(raw.style, ['bars', 'dots', 'pills', 'counter', 'none'])
  if (raw.position !== undefined) result.position = choice(raw.position, ['start', 'center', 'end'])
  if (raw.color !== undefined) result.color = themeColor(raw.color)
  return result
}
function parseDetail(value: unknown, api: ThemeApi): DetailPresentation {
  const raw = record(value); only(raw, ['layout', 'bannerHidden', 'posterWidth', 'facts', 'actionsFirst', 'coverAlign', 'cta', 'bannerHeight', 'bannerScale', 'episodes', ...api2(api, ['tabs'])])
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
  if (raw.tabs !== undefined) result.tabs = choice(raw.tabs, ['underline', 'pills', 'segmented', 'bar'])
  if (raw.episodes !== undefined) {
    const episodes = record(raw.episodes); only(episodes, ['placement', 'arrangement', 'hover', 'order', 'search', 'card'])
    result.episodes = {}
    if (episodes.placement !== undefined) result.episodes.placement = choice(episodes.placement, ['tab', 'right', 'below'])
    if (episodes.arrangement !== undefined) result.episodes.arrangement = choice(episodes.arrangement, ['list', 'grid', 'carousel'])
    if (episodes.hover !== undefined) result.episodes.hover = choice(episodes.hover, ['scale', 'none'])
    if (episodes.order !== undefined) result.episodes.order = choice(episodes.order, ['tabs', 'flip'])
    if (episodes.search !== undefined) result.episodes.search = flag(episodes.search)
    if (episodes.card !== undefined) result.episodes.card = parseNode(episodes.card, undefined, 0, false, api)
  }
  return result
}
function parseShell(value: unknown, api: ThemeApi): ShellPresentation {
  const raw = record(value); only(raw, ['nav', 'compact', 'overlay', 'press', ...api2(api, ['bottomNav'])])
  const result: ShellPresentation = {}
  if (raw.nav !== undefined) result.nav = choice(raw.nav, ['sidebar', 'top', 'bottom'])
  if (raw.compact !== undefined) result.compact = flag(raw.compact)
  if (raw.overlay !== undefined) result.overlay = choice(raw.overlay, ['none', 'fade'])
  if (raw.press !== undefined) result.press = choice(raw.press, ['none', 'sink'])
  if (raw.bottomNav !== undefined) result.bottomNav = parseBottomNav(raw.bottomNav)
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
const MOBILE_KEYS = ['density', 'hideCardLabels', 'trueBlack', 'hero', 'rows', 'detail', 'player', 'cards']
function parseMobile(value: unknown, api: ThemeApi): MobilePresentation {
  const raw = record(value); only(raw, MOBILE_KEYS)
  return parsePresentation(raw, api)
}
/** Validate a presentation. `api` is the package's declared theme API: API 1 packages get the
 *  original key set (so they behave identically on every client), API 2 the additions. Personal
 *  Theme Studio designs and previews use the newest API. */
export function parsePresentation(value: unknown, api: ThemeApi = LATEST_THEME_API): ThemePresentation {
  const raw = record(value)
  only(raw, ['density', 'hideCardLabels', 'trueBlack', 'hero', 'rows', 'detail', 'shell', 'player', 'cards', ...api2(api, ['mobile']), ...api3(api, ['brand'])])
  const result: ThemePresentation = {}
  if (raw.mobile !== undefined) result.mobile = parseMobile(raw.mobile, api)
  if (raw.density !== undefined) result.density = choice(raw.density, ['compact', 'comfortable', 'large'])
  if (raw.hideCardLabels !== undefined) result.hideCardLabels = flag(raw.hideCardLabels)
  if (raw.trueBlack !== undefined) result.trueBlack = flag(raw.trueBlack)
  if (raw.hero !== undefined) {
    const hero = record(raw.hero); only(hero, ['hidden', 'height', 'mobileHeight', 'rotate', 'interval', 'rankHidden', 'rank', 'template', 'scale', ...api2(api, ['indicator'])])
    result.hero = {}
    for (const key of ['hidden', 'rotate', 'rankHidden'] as const) if (hero[key] !== undefined) result.hero[key] = flag(hero[key])
    for (const key of ['height', 'mobileHeight'] as const) if (hero[key] !== undefined) result.hero[key] = number(hero[key], 24, 75)
    if (hero.scale !== undefined) result.hero.scale = choice(hero.scale, ['viewport', 'banner'])
    if (hero.interval !== undefined) result.hero.interval = number(hero.interval, 5, 60)
    if (hero.rank !== undefined) result.hero.rank = parseNode(hero.rank, undefined, 0, false, api)
    if (hero.template !== undefined) result.hero.template = parseNode(hero.template, undefined, 0, true, api)
    if (hero.indicator !== undefined) result.hero.indicator = parseIndicator(hero.indicator)
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
  if (raw.brand !== undefined) result.brand = choice(raw.brand, ['mark', 'text'])
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
  }
  if (phone.player) resolved.player = { ...shared.player, ...phone.player }
  if (phone.cards) resolved.cards = { ...shared.cards, ...phone.cards }
  return resolved
}
export function visibleNode(node: ThemeNode, model: DisplayModel): boolean {
  if (!node.when) return true
  const value = model[node.when.field]
  return value !== undefined && value !== '' && (node.when.atMost === undefined || (typeof value === 'number' && value > 0 && value <= node.when.atMost))
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
    episodes: { placement, arrangement: detail.episodes?.arrangement, hover: detail.episodes?.hover, order: detail.episodes?.order, search: detail.episodes?.search, card: detail.episodes?.card },
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
  if (layout.hero || layout.rows || layout.cards || phone.hero || phone.rows || phone.cards) surfaces.push('Home')
  if (layout.shell || layout.brand || layout.density || layout.hideCardLabels || layout.trueBlack || phone.density || phone.hideCardLabels || phone.trueBlack) surfaces.push('Shell')
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
