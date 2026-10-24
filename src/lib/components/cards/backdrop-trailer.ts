// When a theme's backdrop trailer (API 6 `hero.preview` / `detail.preview: "trailer"`) may play.
export const HERO_TRAILER_DWELL = 3000
export const DETAIL_TRAILER_DWELL = 1500

export interface BackdropTrailerGate {
  enabled: boolean
  id?: string
  /** The viewer's Theme trailers setting (Settings → Appearance). */
  setting: boolean
  /** Desktop only: no phone, Android, TV or Game mode. */
  desktop: boolean
  reducedMotion: boolean
  saveData: boolean
  /** izumi's player is up (Home stays mounted underneath it). */
  playerUp: boolean
  pageHidden: boolean
  /** Held back: by its host, by scrolling the page past 100 px, by the trailer dialog or a hover preview. */
  held: boolean
}

export function backdropTrailerOn(g: BackdropTrailerGate): boolean {
  return g.enabled && !!g.id && g.setting && g.desktop && !g.reducedMotion && !g.saveData && !g.playerUp && !g.pageHidden && !g.held
}
