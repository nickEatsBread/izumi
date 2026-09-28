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
  /** The episodes sit in a desktop right-hand rail. */
  rail: boolean
}

export interface EpisodeToolbarPlan {
  /** False when no toolbar key is set: izumi's own toolbar markup renders unchanged. */
  composed: boolean
  /** A flip sort is the round button in the list's gutter, not a control in the toolbar. */
  gutter: boolean
  variant: 'bar' | 'header'
  /** Controls drawn in the toolbar, in order. */
  inline: EpisodeControl[]
  /** Controls in the overflow menu: every one that applies but is not inline. */
  menu: EpisodeControl[]
  /** `inline`: a field in the bar; `row`: an always-visible field under a heading row; `toggle`: a
   *  button or menu entry opens a field under the toolbar; `none`: no search. */
  search: 'inline' | 'row' | 'toggle' | 'none'
}

/** What decides whose toolbar the list shows: the theme's keys and the length of the list. */
export type EpisodeToolbarKeys = Pick<EpisodeToolbarInput, 'order' | 'search' | 'controls' | 'toolbar' | 'toolbarMin' | 'paging' | 'total'>

/** Below `toolbarMin` episodes only the overflow button stays, so nothing becomes unreachable. */
const belowToolbarMin = (input: EpisodeToolbarKeys) => input.toolbarMin !== undefined && input.total < input.toolbarMin

/** Whether the theme's toolbar replaces izumi's own: one of its toolbar keys is set (`toolbar`,
 *  `controls`, `search: "field"`, `order: "none"`, `paging: "dropdown"`) or the list is shorter than
 *  `toolbarMin`. `order: "flip"` on its own is not one, so an API 1 or 2 theme that sets only the flip
 *  keeps izumi's toolbar as before: the round flip button beside the list on desktop, and the
 *  Oldest | Newest switch on phones. */
export function themedEpisodeToolbar(input: EpisodeToolbarKeys): boolean {
  return input.toolbar !== undefined || input.controls !== undefined || input.search === 'field'
    || input.order === 'none' || input.paging === 'dropdown' || belowToolbarMin(input)
}

/** Whether a flip sort is the round button in the list's gutter rather than a toolbar control: on
 *  desktop, beside a right-hand rail, or wherever izumi's own toolbar shows. Inside the theme's
 *  toolbar elsewhere it is one toggle among the controls; phones never have the gutter button. */
export function flipInGutter(input: EpisodeToolbarKeys & Pick<EpisodeToolbarInput, 'phone' | 'rail'>): boolean {
  return input.order === 'flip' && !input.phone && (input.rail || !themedEpisodeToolbar(input))
}

/** Whether a control can do anything here. The theme turns sort and search off, and a flip in the
 *  gutter is not in the toolbar; the cards/numbers switch is phone-only and a grid or carousel
 *  arrangement ignores it; downloading needs a connection and is already under way while picking;
 *  the queue follows its Settings switch. */
export function episodeControlApplies(control: EpisodeControl, input: EpisodeToolbarInput): boolean {
  switch (control) {
    case 'sort': return input.order !== 'none' && !flipInGutter(input)
    case 'layout': return input.phone && input.arrangement !== 'grid' && input.arrangement !== 'carousel'
    case 'search': return input.search !== false
    case 'download': return !input.offline && !input.selecting
    case 'queue': return input.queueEnabled
  }
}

export function planEpisodeToolbar(input: EpisodeToolbarInput): EpisodeToolbarPlan {
  const variant = input.toolbar ?? 'bar'
  const collapsed = belowToolbarMin(input)
  const composed = themedEpisodeToolbar(input)
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
  return { composed, gutter: flipInGutter(input), variant, inline, menu, search }
}
