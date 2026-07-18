import { get } from 'svelte/store'
import { playing } from '$lib/player/session'
import { pickInDirection, type Dir } from './spatial'
export * from './input'
export * from './actions'
export * from './spatial'

interface ElCand { id: string; rect: DOMRect; el: HTMLElement }

// A text field auto-opens the on-screen keyboard on focus (Deck) and captures the arrows, so it
// must never be the AUTO-landing target — the user reaches it deliberately, not by entering a page.
const isTextInput = (el: HTMLElement) =>
  el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable

export function initDpadNav() {
  window.addEventListener('keydown', (e) => {
    // During playback the player owns the arrow/Enter keys (seek/skip/pause). Spatial focus nav
    // must stay OUT of the way — otherwise a desktop arrow both seeks AND moves focus onto the
    // player controls / across to the sidebar (which then expands over the video).
    if (get(playing)) return
    const map: Record<string, Dir> = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right' }
    const dir = map[e.key]
    if (!dir) { if (e.key === 'Enter') (document.activeElement as HTMLElement)?.click(); return }
    // Focus trap: while a modal marks itself `data-nav-trap` (e.g. the exit prompt), confine
    // navigation to its focusables so the d-pad/stick can't wander onto the browse behind it.
    const trap = document.querySelector('[data-nav-trap]')
    const root: ParentNode = trap ?? document
    const els = [...root.querySelectorAll<HTMLElement>('[data-focusable]')]
      .filter(el => el.checkVisibility?.() ?? true)
      // A disabled button can't be actioned, so skip it as a nav target — otherwise `down` from the
      // last episode row dead-ends on a greyed-out Prev/Next. (Only real `disabled` buttons: divs
      // with `aria-disabled`, like unaired episodes, stay focusable on purpose.)
      .filter(el => !(el instanceof HTMLButtonElement && el.disabled))
    const active = document.activeElement as HTMLElement
    // No real focus yet (just opened / focus sits on <body>): the FIRST press must land on the
    // first content focusable — NOT spatial-search from <body>'s full-page rect, which measures
    // "down" from the whole viewport and flings focus deep into the grid (the "jumps to romance,
    // 3rd card" bug). Prefer the first non-sidebar focusable (the hero button) so the row is next.
    if (!active?.closest?.('[data-focusable]')) {
      const content = els.filter(el => !el.closest('[data-nav-sidebar]'))
      // Prefer the first content focusable that ISN'T a text box (so entering Downloads/Search
      // doesn't auto-focus the filter/search field and trap the arrows in the on-screen keyboard).
      const first = content.find(el => !isTextInput(el)) ?? content[0] ?? els[0]
      if (first) {
        first.focus({ preventScroll: true })
        first.scrollIntoView({ behavior: 'smooth', block: 'center' })
        e.preventDefault()
      }
      return
    }
    const cur = active.getBoundingClientRect()
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
    if (!pick) {
      if (vertical) {
        // Nothing straight down/up in-region: drop the alignment cone (still same-region) so a
        // centred bottom-row card can reach the pagination row's Prev/Next sitting off to the sides
        // below it — the ×4 off-axis weighting still prefers the nearest one — instead of the press
        // doing nothing and forcing a LEFT/RIGHT detour.
        pick = pickInDirection(cur, sameRegion, dir, /* cone */ false)
      } else {
        const otherRegion = all.filter(c => inSidebar(c.el) !== activeInSidebar)
        pick = pickInDirection(cur, otherRegion, dir, /* cone */ false)
      }
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
