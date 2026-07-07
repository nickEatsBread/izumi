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
    // Region gate: the sidebar is a separate nav region (a fixed left rail). Up/down should
    // stay INSIDE the current region — moving between content rows must never jump to the
    // sidebar, and moving within the sidebar stays in it. The sidebar is reached deliberately
    // by pressing LEFT at a row's edge, so left/right are left unrestricted.
    const inSidebar = (el: Element | null) => !!el?.closest('[data-nav-sidebar]')
    const vertical = dir === 'up' || dir === 'down'
    const activeInSidebar = inSidebar(active)
    const cands: ElCand[] = els
      .filter(el => el !== active)
      .filter(el => !vertical || inSidebar(el) === activeInSidebar)
      .map(el => ({ id: '', rect: el.getBoundingClientRect(), el }))
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
