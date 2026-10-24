import { describe, expect, it } from 'vitest'
import { applyKey, GRID_KEYBOARD_ROWS } from './grid-keyboard'

describe('grid keyboard', () => {
  it('lays out Space and Backspace, then a–z and 0–9 in six columns', () => {
    expect(GRID_KEYBOARD_ROWS[0]).toEqual([
      { key: 'space', label: 'Space', span: 3 },
      { key: 'backspace', label: '⌫', span: 3 },
    ])
    expect(GRID_KEYBOARD_ROWS.slice(1).map((row) => row.map((key) => key.key).join(''))).toEqual(['abcdef', 'ghijkl', 'mnopqr', 'stuvwx', 'yz1234', '567890'])
    for (const row of GRID_KEYBOARD_ROWS) expect(row.reduce((sum, key) => sum + key.span, 0)).toBe(6)
  })

  it('types characters, one space between words, and backspaces one character', () => {
    expect(applyKey('', 'a')).toBe('a')
    expect(applyKey('ab', '7')).toBe('ab7')
    expect(applyKey('', 'space')).toBe('')
    expect(applyKey('ab', 'space')).toBe('ab ')
    expect(applyKey('ab ', 'space')).toBe('ab ')
    expect(applyKey('ab', 'backspace')).toBe('a')
    expect(applyKey('', 'backspace')).toBe('')
    expect(applyKey('a😀', 'backspace')).toBe('a')
  })
})
