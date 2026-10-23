// When a theme's backdrop trailer (API 6 `hero.preview` / `detail.preview: "trailer"`) may play.
export const HERO_TRAILER_DWELL = 3000
export const DETAIL_TRAILER_DWELL = 1500

export interface BackdropTrailerGate {
  enabled: boolean
  id?: string
  /** Desktop only: no phone, Android, TV or Game mode. */
  desktop: boolean
  reducedMotion: boolean
  saveData: boolean
  /** izumi's player is up (Home stays mounted underneath it). */
  playerUp: boolean
  pageHidden: boolean
  /** The host holds it back (the hero scrolled away). */
  held: boolean
}

export function backdropTrailerOn(g: BackdropTrailerGate): boolean {
  return g.enabled && !!g.id && g.desktop && !g.reducedMotion && !g.saveData && !g.playerUp && !g.pageHidden && !g.held
}
