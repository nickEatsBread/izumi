import type { GlyphButton } from '$lib/nav/glyphs'

// What each button does in Game mode, shown read-only in Playback › Controls where desktop has
// keyboard rebinding (spec §5.5). Mirrors gamepad.ts (browsing), PlayerOverlay (watching) and the
// Settings zones (settings/controller-zones.ts).

/** A button the map names: one izumi draws as a glyph, or a plain label for the rest. */
export type MapKey = GlyphButton | 'dpad' | 'l4' | 'r4'
export interface ControllerMapRow { keys: readonly MapKey[]; action: string }
export interface ControllerMapGroup { title: string; rows: readonly ControllerMapRow[] }

export const MAP_KEY_LABEL: Record<Exclude<MapKey, GlyphButton>, string> = { dpad: 'D-pad', l4: 'L4', r4: 'R4' }
export const isGlyphKey = (key: MapKey): key is GlyphButton => !(key in MAP_KEY_LABEL)

export const CONTROLLER_MAP: readonly ControllerMapGroup[] = [
  {
    title: 'Browsing',
    rows: [
      { keys: ['dpad'], action: 'Move' },
      { keys: ['a'], action: 'Select' },
      { keys: ['b'], action: 'Back' },
      { keys: ['x'], action: 'Remove a Continue Watching card' },
      { keys: ['y'], action: 'Search settings' },
      { keys: ['l1', 'r1'], action: 'Featured titles on Home, sections in Settings' },
      { keys: ['start'], action: 'Open the menu' },
    ],
  },
  {
    title: 'Watching',
    rows: [
      { keys: ['a'], action: 'Play or pause; skip an intro when offered' },
      { keys: ['b'], action: 'Close the player' },
      { keys: ['dpad'], action: 'Left and right skim; up opens player settings' },
      { keys: ['l2', 'r2'], action: 'Skim back and forward' },
      { keys: ['l1', 'r1'], action: 'Previous or next episode (press twice)' },
      { keys: ['select'], action: 'Discussion' },
      { keys: ['start'], action: 'Audio and subtitle tracks' },
      { keys: ['l4'], action: 'Screenshot' },
      { keys: ['r4'], action: 'Record a GIF' },
    ],
  },
]
