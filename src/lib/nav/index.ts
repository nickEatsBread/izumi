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
    // The sidebar is a separate nav region (a fixed left rail). Movement stays INSIDE the
    // current region first; only when there's nothing that way in-region do we cross to the
    // other region. Up/down never crosses (rows never jump to the sidebar, and vice-versa);
    // left/right crosses at a row's edge — WITHOUT the alignment cone, so a low row can still
    // reach a sidebar link that sits well above it (the "fantasy row can't reach the menu" bug).
    const inSidebar = (el: Element | null) => !!el?.closest('[data-nav-sidebar]')
    const vertical = dir === 'up' || dir === 'down'
    const activeInSidebar = inSidebar(active)
    const all: ElCand[] = els.filter(el => el !== active).map(el => ({ id: '', rect: el.getBoundingClientRect(), el }))
    const sameRegion = all.filter(c => inSidebar(c.el) === activeInSidebar)
    let pick = pickInDirection(cur, sameRegion, dir)
    if (!pick && !vertical) {
      const otherRegion = all.filter(c => inSidebar(c.el) !== activeInSidebar)
      pick = pickInDirection(cur, otherRegion, dir, /* cone */ false)
    }
    if (pick?.el) {
      // Focus WITHOUT the browser's instant jump-scroll, then smooth-scroll ONLY along the axis
      // we moved: horizontal moves scroll the row horizontally (block:nearest avoids a vertical
      // re-center jitter on every left/right); vertical moves scroll the page vertically.
      pick.el.focus({ preventScroll: true })
      pick.el.scrollIntoView({
        behavior: 'smooth',
        block: vertical ? 'center' : 'nearest',
        inline: vertical ? 'nearest' : 'center',
      })
      e.preventDefault()
    }
  })
}
