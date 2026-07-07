import { pickInDirection, type Dir } from './spatial'
export * from './input'
export * from './actions'
export * from './spatial'

interface ElCand { id: string; rect: DOMRect; el: HTMLElement }

export function initDpadNav() {
  window.addEventListener('keydown', (e) => {
    const map: Record<string, Dir> = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right' }
    const dir = map[e.key]
    if (!dir) { if (e.key === 'Enter') (document.activeElement as HTMLElement)?.click(); return }
    const els = [...document.querySelectorAll<HTMLElement>('[data-focusable]')].filter(el => el.checkVisibility?.() ?? true)
    const active = document.activeElement as HTMLElement
    const cur = active?.getBoundingClientRect?.() ?? els[0]?.getBoundingClientRect()
    if (!cur) return
    const cands: ElCand[] = els.filter(el => el !== active).map(el => ({ id: '', rect: el.getBoundingClientRect(), el }))
    const pick = pickInDirection(cur, cands, dir)
    if (pick?.el) {
      // Focus WITHOUT the browser's instant jump-scroll, then smoothly center the target
      // (both axes: the row scrolls horizontally, the page vertically) — the VacuumTube /
      // YouTube-TV feel. scrollIntoView walks every scroll ancestor, so nested carousels
      // and the page both animate.
      pick.el.focus({ preventScroll: true })
      pick.el.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' })
      e.preventDefault()
    }
  })
}
