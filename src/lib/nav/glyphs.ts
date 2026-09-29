import { writable } from 'svelte/store'

/** Whose printed button labels a prompt shows: the Deck's own, or the pad a browser reports. */
export type GlyphFamily = 'deck' | 'xbox' | 'playstation' | 'nintendo'
/** izumi's logical buttons, by Standard Gamepad position: `a` is the bottom face button. */
export type GlyphButton = 'a' | 'b' | 'x' | 'y' | 'l1' | 'r1' | 'l2' | 'r2' | 'start' | 'select'
export interface GlyphFace { text: string; name: string; shape: 'round' | 'pill' }

/** The id of the last browser-visible pad that pressed a button ('' until one does). */
export const lastPadId = writable('')

/** Remember the connected pad so prompts match it; call on a button press. */
export function rememberPad(): void {
  try {
    const pad = [...(navigator.getGamepads?.() ?? [])].find((candidate) => candidate?.connected && candidate.id)
    if (pad) lastPadId.set(pad.id)
  } catch { /* no Gamepad API: the Deck's native input still reports Game mode */ }
}

export function glyphFamily(padId: string, gameMode: boolean): GlyphFamily {
  if (gameMode) return 'deck'
  const id = padId.toLowerCase()
  if (/28de|steam deck|valve/.test(id)) return 'deck'
  if (/054c|dualsense|dualshock|playstation|wireless controller/.test(id)) return 'playstation'
  if (/057e|pro controller|joy-con|nintendo/.test(id)) return 'nintendo'
  return 'xbox'
}

const FACES: Record<GlyphFamily, Record<GlyphButton, string>> = {
  deck: { a: 'A', b: 'B', x: 'X', y: 'Y', l1: 'L1', r1: 'R1', l2: 'L2', r2: 'R2', start: '☰', select: '⧉' },
  xbox: { a: 'A', b: 'B', x: 'X', y: 'Y', l1: 'LB', r1: 'RB', l2: 'LT', r2: 'RT', start: '☰', select: '⧉' },
  playstation: { a: '✕', b: '○', x: '□', y: '△', l1: 'L1', r1: 'R1', l2: 'L2', r2: 'R2', start: '☰', select: '⧉' },
  // The Standard Gamepad's bottom face button is the one Nintendo prints B on.
  nintendo: { a: 'B', b: 'A', x: 'Y', y: 'X', l1: 'L', r1: 'R', l2: 'ZL', r2: 'ZR', start: '+', select: '−' },
}
const SPOKEN: Record<GlyphFamily, Partial<Record<GlyphButton, string>>> = {
  deck: { start: 'Menu', select: 'View' },
  xbox: { start: 'Menu', select: 'View' },
  playstation: { a: 'Cross', b: 'Circle', x: 'Square', y: 'Triangle', start: 'Options', select: 'Create' },
  nintendo: { start: 'Plus', select: 'Minus' },
}
const FACE_BUTTONS: GlyphButton[] = ['a', 'b', 'x', 'y']

export function glyphFor(family: GlyphFamily, button: GlyphButton): GlyphFace {
  const text = FACES[family][button]
  return { text, name: `${SPOKEN[family][button] ?? text} button`, shape: FACE_BUTTONS.includes(button) ? 'round' : 'pill' }
}
