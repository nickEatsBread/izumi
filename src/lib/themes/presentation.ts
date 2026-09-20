/** Data-only presentation API. No HTML, executable expressions, selectors, or remote assets. */
export type DisplayField =
  | 'title' | 'description' | 'rank' | 'rankPosition' | 'score' | 'format' | 'year'
  | 'studio' | 'season' | 'status' | 'genres' | 'members' | 'reviews'
  | 'episodeCount' | 'episodeTitle' | 'airDate' | 'duration' | 'episodeNumber' | 'progress'
  | 'source' | 'country'
/** Host numbers. `when.atMost` compares these; text nodes render them through `displayText`. */
export type NumericDisplayField = 'rankPosition' | 'score' | 'duration' | 'episodeNumber' | 'progress'
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
}
export interface RowPresentation {
  layout?: 'carousel' | 'grid'
  width?: number
  gap?: number
  spacing?: number
  radius?: number
  aspect?: 'poster' | 'landscape' | 'square'
  titleSize?: number
  card?: ThemeNode
}
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
  episodes?: { placement?: EpisodePlacement; arrangement?: EpisodeArrangement; hover?: EpisodeHover; order?: EpisodeOrderControl; search?: boolean; card?: ThemeNode }
}
export interface ShellPresentation {
  nav?: ThemeNavPlacement
  compact?: boolean
  /** `fade` paints a scrim from the rail into the page so full-bleed banners meet the menu. */
  overlay?: 'none' | 'fade'
  /** `sink` darkens and nudges a control down while it is held. */
  press?: 'none' | 'sink'
}
export interface PlayerPresentation {
  seekbarHeight?: number
  seekbarColor?: string
}
export interface ThemePresentation {
  density?: ThemeDensity
  hideCardLabels?: boolean
  trueBlack?: boolean
  hero?: { hidden?: boolean; height?: number; mobileHeight?: number; rotate?: boolean; interval?: number; rankHidden?: boolean; rank?: ThemeNode; template?: ThemeNode; scale?: 'viewport' | 'banner' }
  rows?: { defaults?: RowPresentation; byId?: Record<string, RowPresentation> }
  detail?: DetailPresentation
  shell?: ShellPresentation
  player?: PlayerPresentation
  cards?: Partial<Record<CardFamily, ThemeNode>>
}
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
] as const satisfies readonly DisplayField[]
const numericFields: string[] = ['rankPosition', 'score', 'duration', 'episodeNumber', 'progress'] satisfies NumericDisplayField[]
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
export function parseNode(value: unknown, budget = { count: 0 }, depth = 0, interactive = true): ThemeNode {
  if (++budget.count > 96 || depth > 8) throw new Error('This theme template is too complex.')
  const raw = record(value)
  only(raw, ['type', 'text', 'field', 'artwork', 'action', 'icon', 'when', 'style', 'children'])
  const node: ThemeNode = { type: choice(raw.type, ['stack', 'row', 'grid', 'overlay', 'text', 'artwork', 'action', 'icon', 'meter']) }
  if (node.type === 'action' && !interactive) throw new Error('Card and badge templates cannot contain nested actions.')
  if (raw.text !== undefined) {
    if (typeof raw.text !== 'string' || raw.text.length > 300) throw new Error('Theme text is too long.')
    node.text = raw.text
  }
  if (raw.field !== undefined) node.field = choice(raw.field, fields)
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
    node.when = { field: choice(condition.field, fields) }
    if (condition.atMost !== undefined) {
      if (!numericFields.includes(node.when.field)) throw new Error('atMost only applies to the numeric fields rankPosition, score, duration, episodeNumber and progress.')
      node.when.atMost = number(condition.atMost, 0, 10000)
    }
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
    node.children = raw.children.map(child => parseNode(child, budget, depth + 1, interactive))
  }
  return node
}
function parseRow(value: unknown): RowPresentation {
  const raw = record(value); only(raw, ['layout', 'width', 'gap', 'spacing', 'radius', 'aspect', 'titleSize', 'card'])
  const result: RowPresentation = {}
  if (raw.layout !== undefined) result.layout = choice(raw.layout, ['carousel', 'grid'])
  if (raw.aspect !== undefined) result.aspect = choice(raw.aspect, ['poster', 'landscape', 'square'])
  for (const [key, min, max] of [['width', 96, 400], ['gap', 0, 48], ['spacing', 0, 100], ['radius', 0, 48], ['titleSize', 12, 32]] as const) {
    if (raw[key] !== undefined) result[key] = number(raw[key], min, max)
  }
  if (raw.card !== undefined) result.card = parseNode(raw.card, undefined, 0, false)
  return result
}
function parseDetail(value: unknown): DetailPresentation {
  const raw = record(value); only(raw, ['layout', 'bannerHidden', 'posterWidth', 'facts', 'actionsFirst', 'coverAlign', 'cta', 'bannerHeight', 'bannerScale', 'episodes'])
  const result: DetailPresentation = {}
  if (raw.layout !== undefined) result.layout = choice(raw.layout, ['stack', 'split', 'overlay'])
  if (raw.bannerHidden !== undefined) result.bannerHidden = flag(raw.bannerHidden)
  if (raw.posterWidth !== undefined) result.posterWidth = number(raw.posterWidth, 96, 360)
  if (raw.facts !== undefined) result.facts = parseNode(raw.facts)
  if (raw.actionsFirst !== undefined) result.actionsFirst = flag(raw.actionsFirst)
  if (raw.coverAlign !== undefined) result.coverAlign = choice(raw.coverAlign, ['start', 'end'])
  if (raw.cta !== undefined) result.cta = choice(raw.cta, ['default', 'large'])
  if (raw.bannerHeight !== undefined) result.bannerHeight = number(raw.bannerHeight, 18, 60)
  if (raw.bannerScale !== undefined) result.bannerScale = choice(raw.bannerScale, ['viewport', 'banner'])
  if (raw.episodes !== undefined) {
    const episodes = record(raw.episodes); only(episodes, ['placement', 'arrangement', 'hover', 'order', 'search', 'card'])
    result.episodes = {}
    if (episodes.placement !== undefined) result.episodes.placement = choice(episodes.placement, ['tab', 'right', 'below'])
    if (episodes.arrangement !== undefined) result.episodes.arrangement = choice(episodes.arrangement, ['list', 'grid', 'carousel'])
    if (episodes.hover !== undefined) result.episodes.hover = choice(episodes.hover, ['scale', 'none'])
    if (episodes.order !== undefined) result.episodes.order = choice(episodes.order, ['tabs', 'flip'])
    if (episodes.search !== undefined) result.episodes.search = flag(episodes.search)
    if (episodes.card !== undefined) result.episodes.card = parseNode(episodes.card, undefined, 0, false)
  }
  return result
}
function parseShell(value: unknown): ShellPresentation {
  const raw = record(value); only(raw, ['nav', 'compact', 'overlay', 'press'])
  const result: ShellPresentation = {}
  if (raw.nav !== undefined) result.nav = choice(raw.nav, ['sidebar', 'top', 'bottom'])
  if (raw.compact !== undefined) result.compact = flag(raw.compact)
  if (raw.overlay !== undefined) result.overlay = choice(raw.overlay, ['none', 'fade'])
  if (raw.press !== undefined) result.press = choice(raw.press, ['none', 'sink'])
  return result
}
function parsePlayer(value: unknown): PlayerPresentation {
  const raw = record(value); only(raw, ['seekbarHeight', 'seekbarColor'])
  const result: PlayerPresentation = {}
  if (raw.seekbarHeight !== undefined) result.seekbarHeight = number(raw.seekbarHeight, 2, 16)
  if (raw.seekbarColor !== undefined) result.seekbarColor = themeColor(raw.seekbarColor)
  return result
}
function parseCards(value: unknown): NonNullable<ThemePresentation['cards']> {
  const raw = record(value); only(raw, ['poster', 'continue', 'search'])
  const result: NonNullable<ThemePresentation['cards']> = {}
  for (const family of ['poster', 'continue', 'search'] as const) {
    if (raw[family] !== undefined) result[family] = parseNode(raw[family], undefined, 0, false)
  }
  return result
}
export function parsePresentation(value: unknown): ThemePresentation {
  const raw = record(value)
  only(raw, ['density', 'hideCardLabels', 'trueBlack', 'hero', 'rows', 'detail', 'shell', 'player', 'cards'])
  const result: ThemePresentation = {}
  if (raw.density !== undefined) result.density = choice(raw.density, ['compact', 'comfortable', 'large'])
  if (raw.hideCardLabels !== undefined) result.hideCardLabels = flag(raw.hideCardLabels)
  if (raw.trueBlack !== undefined) result.trueBlack = flag(raw.trueBlack)
  if (raw.hero !== undefined) {
    const hero = record(raw.hero); only(hero, ['hidden', 'height', 'mobileHeight', 'rotate', 'interval', 'rankHidden', 'rank', 'template', 'scale'])
    result.hero = {}
    for (const key of ['hidden', 'rotate', 'rankHidden'] as const) if (hero[key] !== undefined) result.hero[key] = flag(hero[key])
    for (const key of ['height', 'mobileHeight'] as const) if (hero[key] !== undefined) result.hero[key] = number(hero[key], 24, 75)
    if (hero.scale !== undefined) result.hero.scale = choice(hero.scale, ['viewport', 'banner'])
    if (hero.interval !== undefined) result.hero.interval = number(hero.interval, 5, 60)
    if (hero.rank !== undefined) result.hero.rank = parseNode(hero.rank, undefined, 0, false)
    if (hero.template !== undefined) result.hero.template = parseNode(hero.template)
  }
  if (raw.rows !== undefined) {
    const rows = record(raw.rows); only(rows, ['defaults', 'byId']); result.rows = {}
    if (rows.defaults !== undefined) result.rows.defaults = parseRow(rows.defaults)
    if (rows.byId !== undefined) {
      const byId = record(rows.byId)
      if (Object.keys(byId).length > 100) throw new Error('Too many row overrides.')
      result.rows.byId = Object.fromEntries(Object.entries(byId).map(([id, row]) => {
        if (!/^[a-z0-9][a-z0-9:._/-]{0,199}$/i.test(id) || ['__proto__', 'constructor', 'prototype'].includes(id)) throw new Error('Invalid theme row identity.')
        return [id, parseRow(row)]
      }))
    }
  }
  if (raw.detail !== undefined) result.detail = parseDetail(raw.detail)
  if (raw.shell !== undefined) result.shell = parseShell(raw.shell)
  if (raw.player !== undefined) result.player = parsePlayer(raw.player)
  if (raw.cards !== undefined) result.cards = parseCards(raw.cards)
  return result
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
    episodes: { placement, arrangement: detail.episodes?.arrangement, hover: detail.episodes?.hover, order: detail.episodes?.order, search: detail.episodes?.search, card: detail.episodes?.card },
  }
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
  if (layout.hero || layout.rows || layout.cards) surfaces.push('Home')
  if (layout.shell || layout.density || layout.hideCardLabels || layout.trueBlack) surfaces.push('Shell')
  if (layout.detail) surfaces.push('Details')
  if (layout.player) surfaces.push('Player')
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
