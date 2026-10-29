/** Theme colours for Game mode's mpv-drawn player (src-tauri/src/player/gm_osd.rs). That chrome is ASS
 *  inside mpv, so no stylesheet reaches it: the active theme's colours travel with its OSD state instead. */

export type GmOsdTheme = { themeAccent: string; themeFocus: string }

/** A computed CSS colour (`rgb(r, g, b)` / `rgba(r, g, b, a)`, the form `getComputedStyle` gives for hex,
 *  rgb and hsl) as ASS's BGR hex (`BBGGRR`). '' keeps the OSD's own colour: other colour spaces, junk and
 *  fully transparent colours. Alpha is otherwise ignored. */
export function assColor(computed: string): string {
  const parts = /^rgba?\(([^)]*)\)$/i.exec(computed.trim())?.[1].split(/[\s,/]+/).filter(Boolean).map(Number)
  if (!parts || parts.length < 3 || parts.length > 4 || parts.some((n) => !Number.isFinite(n)) || parts[3] === 0) return ''
  return [parts[2], parts[1], parts[0]]
    .map((n) => Math.round(Math.min(255, Math.max(0, n))).toString(16).padStart(2, '0'))
    .join('')
    .toUpperCase()
}

/** The CSS colour mpv's spinner draws in for an OSD accent (`BBGGRR`), for the page's copies of that
 *  spinner (Spinner.svelte `player`). Without an accent it is the OSD's own white rather than the
 *  primary colour: the light palette's primary is near-black, which would vanish on the loading black. */
export function osdSpinnerColor(themeAccent: string): string {
  return themeAccent ? `#${themeAccent.slice(4, 6)}${themeAccent.slice(2, 4)}${themeAccent.slice(0, 2)}` : '#fff'
}

/** The active theme's accent (seek bar fill and knob, focused control, spinner) and focus ring: the
 *  theme's `player.seekbarColor`, else its primary, and its ring. Both '' without a theme, so izumi's
 *  own white stays. */
export function readGmOsdTheme(): GmOsdTheme {
  const root = document.documentElement
  // theme.ts marks an active theme on a TV surface (Game mode included) with data-surface="tv".
  if (root.dataset.surface !== 'tv') return { themeAccent: '', themeFocus: '' }
  // The browser resolves var() and every colour syntax; unthemed so no theme rule can colour the probe.
  const probe = document.createElement('span')
  probe.hidden = true
  probe.setAttribute('data-theme-unthemed', '')
  document.body.append(probe)
  const read = (color: string) => {
    probe.style.color = color
    return assColor(getComputedStyle(probe).color)
  }
  // theme.ts writes --theme-seekbar-color inline only for `player.seekbarColor`; app.css's white is no choice.
  const accent = root.style.getPropertyValue('--theme-seekbar-color') ? 'var(--theme-seekbar-color)' : 'hsl(var(--primary))'
  const theme = { themeAccent: read(accent), themeFocus: read('hsl(var(--ring))') }
  probe.remove()
  return theme
}
