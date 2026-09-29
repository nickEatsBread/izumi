/** A prompt in the button-hint bar; `l2r2` is the page-tab trigger pair. */
export type HintButton = 'a' | 'x' | 'b' | 'l2r2' | 'start'
export interface Hint { button: HintButton; label: string }
export interface HintContext { home: boolean; pageTabs: boolean }

const ORDER: HintButton[] = ['a', 'x', 'b', 'l2r2', 'start']
const isContinue = (element: Element) => element.matches('[data-part="card"][data-family="continue"]')

function primaryAction(element: HTMLElement): string {
  if (isContinue(element)) return 'Resume'
  if (element.matches('[data-part="episode"]')) return 'Play'
  if (element.closest('[data-part="card"]')) return 'Open'
  return 'Select'
}

/** The prompts for whatever holds focus: `data-hint-a` / `data-hint-x` on the element win, else the
 *  defaults for its kind. B closes inside a dialog (and the menu prompt goes), exits on Home, else
 *  goes back. */
export function hintsFor(focused: Element | null, context: HintContext): Hint[] {
  const element = focused instanceof HTMLElement && focused.tagName !== 'BODY' ? focused : null
  const dialog = element?.closest('[data-nav-trap]')
  const labels: Partial<Record<HintButton, string>> = {}
  if (element) {
    labels.a = element.dataset.hintA ?? primaryAction(element)
    const x = element.dataset.hintX ?? (isContinue(element) ? 'Remove' : undefined)
    if (x) labels.x = x
  }
  labels.b = dialog ? 'Close' : context.home ? 'Exit' : 'Back'
  if (context.pageTabs) labels.l2r2 = 'Tabs'
  if (!dialog) labels.start = 'Menu'
  return ORDER.flatMap((button) => {
    const label = labels[button]
    return label ? [{ button, label }] : []
  })
}
