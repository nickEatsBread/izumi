// L2/R2 page tabs under a theme's bumper tabs (`shell.top.bumpers`): the page's own tab strip —
// series sections, Library sections, a settings page's tabs — marked `data-page-tabs`. Its items are
// the strip's buttons and links (minus disabled ones and `data-page-tabs-skip`); the active one
// carries `data-active`, `aria-current="page"`, `aria-selected="true"` or `aria-pressed="true"`.
// Stepping clicks the neighbour, so each strip keeps its own click behaviour.
const ACTIVE = '[data-active], [aria-current="page"], [aria-selected="true"], [aria-pressed="true"]'

const shown = (element: HTMLElement) => element.checkVisibility?.() ?? true

/** The strip L2/R2 steps: the one inside the open dialog when one is open, else the first visible
 *  strip outside every dialog. */
export function findPageTabs(root: ParentNode = document): HTMLElement | null {
  const dialogs = [...root.querySelectorAll<HTMLElement>('[data-nav-trap]')].filter(shown)
  const scope: ParentNode = dialogs.at(-1) ?? root
  for (const strip of scope.querySelectorAll<HTMLElement>('[data-page-tabs]')) {
    if (!dialogs.length && strip.closest('[data-nav-trap]')) continue
    if (shown(strip)) return strip
  }
  return null
}

/** Click the tab before (-1) or after (+1) the active one. False when there is no strip or no tab
 *  that way (tabs never wrap). */
export function stepPageTabs(dir: -1 | 1, root: ParentNode = document): boolean {
  const strip = findPageTabs(root)
  if (!strip) return false
  const items = [...strip.querySelectorAll<HTMLElement>('button, a')]
    .filter((item) => !(item as HTMLButtonElement).disabled && !item.hasAttribute('data-page-tabs-skip'))
  const current = items.findIndex((item) => item.matches(ACTIVE))
  const target = current < 0 ? items[dir > 0 ? 0 : items.length - 1] : items[current + dir]
  if (!target) return false
  target.click()
  return true
}
