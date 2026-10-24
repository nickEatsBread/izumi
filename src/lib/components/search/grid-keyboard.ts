// The TV themes' alphabetical search keyboard (Theme API 6 `tv.search.keyboard: "grid"`), measured
// from the TV apps: Space and Backspace over six columns of lowercase letters and digits, then a
// full-width Clear (a theme that wants the six columns alone hides `[data-key="clear"]`).

export interface GridKey { key: string; label: string; span: number }

export const GRID_KEYBOARD_ROWS: GridKey[][] = [
  [{ key: 'space', label: 'Space', span: 3 }, { key: 'backspace', label: '⌫', span: 3 }],
  ...['abcdef', 'ghijkl', 'mnopqr', 'stuvwx', 'yz1234', '567890'].map((row) => [...row].map((key) => ({ key, label: key, span: 1 }))),
  [{ key: 'clear', label: 'Clear', span: 6 }],
]

/** The field's value after a key press: Space never leads or doubles, Backspace drops one character,
 *  Clear empties it. */
export function applyKey(value: string, key: string): string {
  if (key === 'clear') return ''
  if (key === 'backspace') return [...value].slice(0, -1).join('')
  if (key === 'space') return !value || value.endsWith(' ') ? value : `${value} `
  return value + key
}
