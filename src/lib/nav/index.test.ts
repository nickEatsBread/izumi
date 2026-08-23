import { describe, it, expect } from 'vitest'
import { fieldOwnsArrow, isEnterInertInput, revealAxisDelta, type ArrowKey, type FieldShape } from './index'

const input = (type: string): FieldShape => ({ tag: 'INPUT', type })
const KEYS: ArrowKey[] = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']
const owned = (field: FieldShape) => KEYS.filter((key) => fieldOwnsArrow(field, key))

describe('fieldOwnsArrow', () => {
  // The regression this exists for: a blanket "any input wins" guard also ate Up/Down, which are
  // the only keyboard way OUT of a focused single-line field (quick search, episode filter,
  // downloads filter all put their results directly below the box).
  for (const type of ['text', 'search', 'password', 'url', 'email', 'tel']) {
    it(`single-line ${type} keeps only the caret axis`, () =>
      expect(owned(input(type))).toEqual(['ArrowLeft', 'ArrowRight']))
  }
  // An <input> with no/unknown type reads as 'text' via the DOM, and the shape defaults to match.
  it('untyped input behaves as text', () => expect(owned({ tag: 'INPUT' })).toEqual(['ArrowLeft', 'ArrowRight']))

  for (const type of ['number', 'date', 'time', 'datetime-local', 'month', 'week']) {
    it(`stepper ${type} keeps all four`, () => expect(owned(input(type))).toEqual(KEYS))
  }

  // Caret-less controls are d-pad-only in Game mode, so nav must keep every arrow or focus strands.
  for (const type of ['checkbox', 'radio', 'range', 'color', 'button', 'submit', 'reset', 'file', 'image']) {
    it(`caret-less ${type} yields all four to nav`, () => expect(owned(input(type))).toEqual([]))
  }

  it('textarea keeps all four (Up/Down walk lines)', () => expect(owned({ tag: 'TEXTAREA' })).toEqual(KEYS))
  it('contenteditable keeps all four', () => expect(owned({ tag: 'DIV', contentEditable: true })).toEqual(KEYS))

  // <select> cycles on all four natively, so the redundant horizontal pair buys an escape route
  // while Up/Down still change the value under gamescope (where the popup does not open reliably).
  it('select keeps the vertical pair and releases the horizontal one', () =>
    expect(owned({ tag: 'SELECT' })).toEqual(['ArrowUp', 'ArrowDown']))

  it('role=combobox behaves like a select', () =>
    expect(owned({ tag: 'DIV', role: 'combobox' })).toEqual(['ArrowUp', 'ArrowDown']))
  for (const role of ['textbox', 'searchbox']) {
    it(`role=${role} behaves like a single-line field`, () =>
      expect(owned({ tag: 'DIV', role })).toEqual(['ArrowLeft', 'ArrowRight']))
  }

  it('a plain button claims nothing', () => expect(owned({ tag: 'BUTTON' })).toEqual([]))
  it('a card div claims nothing', () => expect(owned({ tag: 'DIV' })).toEqual([]))
})

describe('isEnterInertInput', () => {
  // Enter on these does nothing natively (a checkbox/radio only responds to Space), so the handler
  // has to synthesize the click — they are the settings toggles and the picker filter checkboxes.
  for (const type of ['checkbox', 'radio', 'range', 'color']) {
    it(`${type} needs the synthetic activation`, () => expect(isEnterInertInput(input(type))).toBe(true))
  }
  // Everything else already fires on Enter; synthesizing there is what double-activated before.
  for (const type of ['button', 'submit', 'reset', 'file', 'image', 'text', 'search', 'number']) {
    it(`${type} does not`, () => expect(isEnterInertInput(input(type))).toBe(false))
  }
  it('non-inputs never do', () => {
    expect(isEnterInertInput({ tag: 'BUTTON' })).toBe(false)
    expect(isEnterInertInput({ tag: 'DIV', role: 'button' })).toBe(false)
    expect(isEnterInertInput({ tag: 'SELECT' })).toBe(false)
  })
})

describe('revealAxisDelta', () => {
  const base = { portStart: 0, portEnd: 800, startMargin: 80, endMargin: 140 }

  it('keeps an already-safe card still', () => {
    expect(revealAxisDelta({ ...base, itemStart: 260, itemEnd: 500 })).toBe(0)
  })

  it('moves before focus reaches the bottom edge', () => {
    expect(revealAxisDelta({ ...base, itemStart: 600, itemEnd: 750 })).toBe(90)
  })

  it('restores room above a card when moving back', () => {
    expect(revealAxisDelta({ ...base, itemStart: 30, itemEnd: 180 })).toBe(-50)
  })

  it('clamps margins when the focused item nearly fills its viewport', () => {
    expect(revealAxisDelta({
      itemStart: -20, itemEnd: 760, portStart: 0, portEnd: 800,
      startMargin: 100, endMargin: 160,
    })).toBe(-30)
  })
})
