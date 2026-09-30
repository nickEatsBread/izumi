import { describe, it, expect } from 'vitest'
import { containedInAxis, fieldOwnsArrow, isEnterInertInput, revealAxisDelta, type ArrowKey, type FieldArrowOptions, type FieldShape } from './index'

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

describe('fieldOwnsArrow options and roving tabs', () => {
  const ownedWith = (field: FieldShape, options: FieldArrowOptions) =>
    KEYS.filter((key) => fieldOwnsArrow(field, key, options))

  // Decision 2: a keyboard-focused slider steps with Left/Right, as the web platform does. The nav
  // handler passes rangeOwnsHorizontal = !isTv; pad arrows never reach this rule at all.
  it('a keyboard-focused slider keeps Left/Right when the caller hands them over (off TV)', () =>
    expect(ownedWith(input('range'), { rangeOwnsHorizontal: true })).toEqual(['ArrowLeft', 'ArrowRight']))

  it('without the option (TV) a slider still yields all four to nav', () => {
    expect(ownedWith(input('range'), { rangeOwnsHorizontal: false })).toEqual([])
    expect(ownedWith(input('range'), {})).toEqual([])
  })

  it('the option only concerns sliders', () => {
    for (const type of ['checkbox', 'radio', 'color', 'button', 'submit', 'reset', 'file', 'image']) {
      expect(ownedWith(input(type), { rangeOwnsHorizontal: true }), type).toEqual([])
    }
    expect(ownedWith(input('text'), { rangeOwnsHorizontal: true })).toEqual(['ArrowLeft', 'ArrowRight'])
    expect(ownedWith(input('number'), { rangeOwnsHorizontal: true })).toEqual(KEYS)
    expect(ownedWith({ tag: 'SELECT' }, { rangeOwnsHorizontal: true })).toEqual(['ArrowUp', 'ArrowDown'])
    expect(ownedWith({ tag: 'TEXTAREA' }, { rangeOwnsHorizontal: true })).toEqual(KEYS)
  })

  // Sources parks its inactive tabs at tabindex -1 and steps them itself (moveTab). Owning the
  // horizontal pair makes that one step; Up/Down still leave the strip.
  it('a roving tab owns Left/Right so the page steps it once', () =>
    expect(owned({ tag: 'BUTTON', role: 'tab', rovingTab: true })).toEqual(['ArrowLeft', 'ArrowRight']))

  it('a tab in a strip without roving tabindex claims nothing', () =>
    expect(owned({ tag: 'BUTTON', role: 'tab' })).toEqual([]))
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

describe('containedInAxis', () => {
  it('accepts cards fully inside the visible row lane', () => {
    expect(containedInAxis(100, 200, 0, 800)).toBe(true)
    expect(containedInAxis(0, 800, 0, 800)).toBe(true)
  })

  it('rejects cards even partially clipped beyond either horizontal edge', () => {
    expect(containedInAxis(-20, 40, 0, 800)).toBe(false)
    expect(containedInAxis(780, 840, 0, 800)).toBe(false)
    expect(containedInAxis(-100, 0, 0, 800)).toBe(false)
    expect(containedInAxis(800, 900, 0, 800)).toBe(false)
  })
})

describe('fieldOwnsArrow: arrow landing and textarea edges (commit 8)', () => {
  const ownedWith = (field: FieldShape, options: FieldArrowOptions) =>
    KEYS.filter((key) => fieldOwnsArrow(field, key, options))

  // Owner decision 2: arrow navigation that just landed on a value field walks on past it
  // vertically; its own keys come back once Enter, Space, typing, a click or a change engages it.
  it('a select the arrows just landed on keeps no arrow', () =>
    expect(ownedWith({ tag: 'SELECT' }, { navArrived: true })).toEqual([]))
  for (const type of ['number', 'date', 'time', 'datetime-local', 'month', 'week']) {
    it(`a ${type} stepper the arrows just landed on keeps only its horizontal pair`, () =>
      expect(ownedWith(input(type), { navArrived: true })).toEqual(['ArrowLeft', 'ArrowRight']))
  }
  it('an engaged select or stepper keeps its native keys', () => {
    expect(ownedWith({ tag: 'SELECT' }, { navArrived: false })).toEqual(['ArrowUp', 'ArrowDown'])
    expect(ownedWith(input('number'), {})).toEqual(KEYS)
  })
  it('a landing never gives a text field its vertical pair or takes its caret axis', () =>
    expect(ownedWith(input('text'), { navArrived: true })).toEqual(['ArrowLeft', 'ArrowRight']))

  // A textarea lets Up go with the caret at 0 and Down with the caret after its last character, so
  // a keyboard or Steam desktop-layout user can always leave it.
  it('a textarea with the caret at 0 lets Up go', () =>
    expect(owned({ tag: 'TEXTAREA', caretAtStart: true, caretAtEnd: false })).toEqual(['ArrowDown', 'ArrowLeft', 'ArrowRight']))
  it('a textarea with the caret at the end lets Down go', () =>
    expect(owned({ tag: 'TEXTAREA', caretAtStart: false, caretAtEnd: true })).toEqual(['ArrowUp', 'ArrowLeft', 'ArrowRight']))
  it('an empty textarea lets both go', () =>
    expect(owned({ tag: 'TEXTAREA', caretAtStart: true, caretAtEnd: true })).toEqual(['ArrowLeft', 'ArrowRight']))
  it('a textarea with the caret inside its text keeps all four', () =>
    expect(owned({ tag: 'TEXTAREA', caretAtStart: false, caretAtEnd: false })).toEqual(KEYS))
  it('contenteditable has no edges', () =>
    expect(owned({ tag: 'DIV', contentEditable: true, caretAtStart: true, caretAtEnd: true })).toEqual(KEYS))
})
