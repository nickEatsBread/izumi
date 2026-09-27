import type { EpisodeArrangement, EpisodeControl, EpisodeOrderControl } from '$lib/themes/presentation'

/** Every episode control, in the order a theme's toolbar shows them when it lists none. */
export const EPISODE_CONTROL_ORDER: readonly EpisodeControl[] = ['sort', 'layout', 'search', 'download', 'queue']

export interface EpisodeToolbarInput {
  order?: EpisodeOrderControl
  search?: boolean | 'field'
  arrangement?: EpisodeArrangement
  controls?: EpisodeControl[]
  toolbar?: 'bar' | 'header'
  toolbarMin?: number
  paging?: 'pages' | 'ranges' | 'dropdown'
  phone: boolean
  offline: boolean
  queueEnabled: boolean
  selecting: boolean
  total: number
  /** A flip sort sits in the gutter of a desktop right-hand rail, not in the toolbar. */
  railGutter: boolean
}

export interface EpisodeToolbarPlan {
  /** False when no toolbar key is set: izumi's own toolbar markup renders unchanged. */
  composed: boolean
  variant: 'bar' | 'header'
  /** Controls drawn in the toolbar, in order. */
  inline: EpisodeControl[]
  /** Controls in the overflow menu: every one that applies but is not inline. */
  menu: EpisodeControl[]
  /** `inline`: a field in the bar; `row`: an always-visible field under a heading row; `toggle`: a
   *  button or menu entry opens a field under the toolbar; `none`: no search. */
  search: 'inline' | 'row' | 'toggle' | 'none'
}

/** Whether a control can do anything here. The theme turns sort and search off; the cards/numbers
 *  switch is phone-only and a grid or carousel arrangement ignores it; downloading needs a
 *  connection and is already under way while picking; the queue follows its Settings switch. */
export function episodeControlApplies(control: EpisodeControl, input: EpisodeToolbarInput): boolean {
  switch (control) {
    case 'sort': return input.order !== 'none' && !input.railGutter
    case 'layout': return input.phone && input.arrangement !== 'grid' && input.arrangement !== 'carousel'
    case 'search': return input.search !== false
    case 'download': return !input.offline && !input.selecting
    case 'queue': return input.queueEnabled
  }
}

export function planEpisodeToolbar(input: EpisodeToolbarInput): EpisodeToolbarPlan {
  const variant = input.toolbar ?? 'bar'
  // Below `toolbarMin` episodes only the overflow button stays, so nothing becomes unreachable.
  const collapsed = input.toolbarMin !== undefined && input.total < input.toolbarMin
  const composed = input.toolbar !== undefined || input.controls !== undefined || input.search === 'field'
    || input.order === 'none' || (input.order === 'flip' && !input.railGutter) || input.paging === 'dropdown' || collapsed
  const applicable = EPISODE_CONTROL_ORDER.filter((control) => episodeControlApplies(control, input))
  const field = input.search === 'field' && !collapsed && applicable.includes('search')
  let inline: EpisodeControl[] = collapsed ? [] : (input.controls ?? EPISODE_CONTROL_ORDER).filter((control) => applicable.includes(control))
  // An always-visible field is never tucked away: first in a bar unless listed, its own row under a heading.
  if (field && variant === 'bar' && !inline.includes('search')) inline = ['search', ...inline]
  if (field && variant === 'header') inline = inline.filter((control) => control !== 'search')
  const menu = applicable.filter((control) => !inline.includes(control) && !(field && variant === 'header' && control === 'search'))
  const search = !applicable.includes('search') ? 'none'
    : field && variant === 'header' ? 'row'
    : variant === 'bar' && inline.includes('search') && (field || !input.phone) ? 'inline'
    : 'toggle'
  return { composed, variant, inline, menu, search }
}
