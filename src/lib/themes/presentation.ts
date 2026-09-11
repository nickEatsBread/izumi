/** Data-only presentation API. No HTML, executable expressions, selectors, or remote assets. */
export type DisplayField = 'title' | 'description' | 'rank' | 'rankPosition' | 'score' | 'format' | 'year'
/** Host numbers. `when.atMost` compares these; text nodes render them through `displayText`. */
export type NumericDisplayField = 'rankPosition' | 'score'
export type ThemeAction = 'play' | 'details' | 'favorite' | 'previous' | 'next'
export interface ThemeNode {
  type: 'stack' | 'row' | 'grid' | 'overlay' | 'text' | 'artwork' | 'action'
  text?: string
  field?: DisplayField
  artwork?: 'poster' | 'backdrop' | 'logo'
  action?: ThemeAction
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
export interface ThemePresentation {
  hero?: { hidden?: boolean; height?: number; mobileHeight?: number; rotate?: boolean; interval?: number; rankHidden?: boolean; rank?: ThemeNode; template?: ThemeNode }
  rows?: { defaults?: RowPresentation; byId?: Record<string, RowPresentation> }
}
/** Every host binds the same shapes: `rankPosition` and `score` (0-100) are numbers, the rest strings. */
export type DisplayModel = Partial<Record<Exclude<DisplayField, NumericDisplayField> | 'poster' | 'backdrop' | 'logo', string> & Record<NumericDisplayField, number>>
export const ROW_CONTEXT = Symbol('theme-row')
export interface RowScope { id: string; title: string }
const fields = ['title', 'description', 'rank', 'rankPosition', 'score', 'format', 'year']
const numericFields: string[] = ['rankPosition', 'score'] satisfies NumericDisplayField[]
const actions = ['play', 'details', 'favorite', 'previous', 'next']
const numericStyles: Record<string, [number, number, string]> = {
  gap: [0, 96, 'px'], padding: [0, 96, 'px'], fontSize: [10, 96, 'px'], fontWeight: [400, 900, ''],
  radius: [0, 80, 'px'], opacity: [0, 1, ''], width: [5, 100, '%'], minHeight: [0, 600, 'px'],
  columns: [1, 6, ''], grow: [0, 1, ''], maxWidth: [80, 1200, 'px'],
}
const choices: Record<string, string[]> = {
  align: ['start', 'center', 'end', 'stretch'], justify: ['start', 'center', 'end', 'space-between'],
  textAlign: ['start', 'center', 'end'], position: ['relative', 'absolute'],
  anchor: ['fill', 'bottom-start', 'bottom-end', 'top-start', 'top-end'],
  fit: ['cover', 'contain'], aspect: ['2 / 3', '16 / 9', '1 / 1'],
}
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
export function parseNode(value: unknown, budget = { count: 0 }, depth = 0, interactive = true): ThemeNode {
  if (++budget.count > 96 || depth > 8) throw new Error('This theme template is too complex.')
  const raw = record(value)
  only(raw, ['type', 'text', 'field', 'artwork', 'action', 'when', 'style', 'children'])
  const node: ThemeNode = { type: choice(raw.type, ['stack', 'row', 'grid', 'overlay', 'text', 'artwork', 'action']) }
  if (node.type === 'action' && !interactive) throw new Error('Card and badge templates cannot contain nested actions.')
  if (raw.text !== undefined) {
    if (typeof raw.text !== 'string' || raw.text.length > 300) throw new Error('Theme text is too long.')
    node.text = raw.text
  }
  if (raw.field !== undefined) node.field = choice(raw.field, fields) as DisplayField
  if (raw.artwork !== undefined) node.artwork = choice(raw.artwork, ['poster', 'backdrop', 'logo'])
  if (node.type === 'artwork' && !node.artwork) throw new Error('Choose artwork for this template.')
  if (node.type === 'action') node.action = choice(raw.action, actions) as ThemeAction
  if (raw.when !== undefined) {
    const condition = record(raw.when); only(condition, ['field', 'atMost'])
    node.when = { field: choice(condition.field, fields) as DisplayField }
    if (condition.atMost !== undefined) {
      if (!numericFields.includes(node.when.field)) throw new Error('atMost only applies to the numeric fields rankPosition and score.')
      node.when.atMost = number(condition.atMost, 0, 10000)
    }
  }
  if (raw.style !== undefined) {
    const style = record(raw.style); node.style = {}
    for (const [key, value] of Object.entries(style)) {
      if (numericStyles[key]) node.style[key] = number(value, numericStyles[key][0], numericStyles[key][1])
      else if (choices[key]) node.style[key] = choice(value, choices[key])
      else if (key === 'color' || key === 'background') {
        if (typeof value !== 'string' || !(colors.includes(value) || /^#[0-9a-f]{6}([0-9a-f]{2})?$/i.test(value))) throw new Error('Use a theme color or a hex color.')
        node.style[key] = value
      } else throw new Error('This theme style is not supported.')
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
export function parsePresentation(value: unknown): ThemePresentation {
  const raw = record(value); only(raw, ['hero', 'rows'])
  const result: ThemePresentation = {}
  if (raw.hero !== undefined) {
    const hero = record(raw.hero); only(hero, ['hidden', 'height', 'mobileHeight', 'rotate', 'interval', 'rankHidden', 'rank', 'template'])
    result.hero = {}
    for (const key of ['hidden', 'rotate', 'rankHidden'] as const) if (hero[key] !== undefined) {
      if (typeof hero[key] !== 'boolean') throw new Error('Expected a theme toggle.')
      result.hero[key] = hero[key]
    }
    for (const key of ['height', 'mobileHeight'] as const) if (hero[key] !== undefined) result.hero[key] = number(hero[key], 24, 75)
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
  return field === 'score' ? `${value}%` : String(value)
}
export function nodeStyle(node: ThemeNode): string {
  const styles: Record<string, string> = { 'min-width': '0', 'box-sizing': 'border-box' }
  if (['stack', 'row', 'grid', 'overlay'].includes(node.type)) {
    styles.display = node.type === 'grid' || node.type === 'overlay' ? 'grid' : 'flex'
    if (node.type === 'stack') styles['flex-direction'] = 'column'
    if (node.type === 'row') styles['flex-wrap'] = 'wrap'
    styles.position = 'relative'
  }
  if (node.type === 'artwork') { styles.width = '100%'; styles['object-fit'] = 'cover' }
  // `anchor` is applied after every other style entry so its absolute positioning cannot be
  // reordered away by JSON key order (an explicit `position` entry must never win over it).
  let anchor: string | undefined
  for (const [key, value] of Object.entries(node.style ?? {})) {
    const property = ({ radius: 'border-radius', fontSize: 'font-size', fontWeight: 'font-weight', minHeight: 'min-height', maxWidth: 'max-width', textAlign: 'text-align', align: 'align-items', justify: 'justify-content', fit: 'object-fit', aspect: 'aspect-ratio', grow: 'flex-grow' } as Record<string, string>)[key] ?? key
    if (key === 'columns') styles['grid-template-columns'] = `repeat(${Math.round(Number(value))},minmax(0,1fr))`
    else if (key === 'anchor') anchor = String(value)
    else if (key === 'color' || key === 'background') styles[property] = String(value).startsWith('#') || value === 'transparent' ? String(value) : `hsl(var(--${value}))`
    else styles[property] = `${value}${numericStyles[key]?.[2] ?? ''}`
  }
  if (anchor !== undefined) {
    styles.position = 'absolute'
    if (anchor === 'fill') styles.inset = '0'
    else { styles[anchor.startsWith('bottom') ? 'bottom' : 'top'] = '0'; styles[`inset-inline-${anchor.endsWith('end') ? 'end' : 'start'}`] = '0' }
  }
  return Object.entries(styles).map(([key, value]) => `${key}:${value}`).join(';')
}
export function resolveRow(layout: ThemePresentation | undefined, id = ''): RowPresentation {
  const role = id.includes(':') ? id.slice(id.indexOf(':') + 1) : id
  return { ...layout?.rows?.defaults, ...layout?.rows?.byId?.[role], ...layout?.rows?.byId?.[id] }
}
