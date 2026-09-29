/** A prompt in the button-hint bar; `l2r2` is the page-tab trigger pair. */
export type HintButton = 'a' | 'x' | 'b' | 'l2r2' | 'start'
export interface Hint { button: HintButton; label: string }
/** `dialog`: a dialog (`[data-nav-trap]`) is open, whether or not focus made it inside. */
export interface HintContext { home: boolean; pageTabs: boolean; dialog?: boolean }

const ORDER: HintButton[] = ['a', 'x', 'b', 'l2r2', 'start']
const isContinue = (element: Element) => element.matches('[data-part="card"][data-family="continue"]')

/** A plain control's own name ("Watch Now", "Share"), when it is short enough to read as a prompt. */
function ownLabel(element: HTMLElement): string | undefined {
  const label = (element.getAttribute('aria-label') ?? element.textContent ?? '').replace(/\s+/g, ' ').trim()
  return label && label.length <= 18 ? label : undefined
}

function primaryAction(element: HTMLElement): string {
  if (isContinue(element)) return 'Resume'
  if (element.matches('[data-part="episode"]')) return 'Play'
  if (element.closest('[data-part="card"]')) return 'Open'
  return ownLabel(element) ?? 'Select'
}

/** The prompts for whatever holds focus: `data-hint-a` / `data-hint-x` on the element win, else the
 *  defaults for its kind. B closes while a dialog is open (and the menu prompt goes), exits on Home,
 *  else goes back. A dialog that left focus on the page behind it gets a plain Select: the element's
 *  own prompts would describe the page, not the dialog. */
export function hintsFor(focused: Element | null, context: HintContext): Hint[] {
  const element = focused instanceof HTMLElement && focused.tagName !== 'BODY' ? focused : null
  const inDialog = !!element?.closest('[data-nav-trap]')
  const dialog = inDialog || context.dialog === true
  const labels: Partial<Record<HintButton, string>> = {}
  if (element && dialog && !inDialog) labels.a = 'Select'
  else if (element) {
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
