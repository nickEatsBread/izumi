import { describe, expect, it } from 'vitest'
import { agendaScrollTop, agendaTargetDay, isAgendaScrollKey } from './agenda-scroll'

describe('agenda auto-scroll', () => {
  it('targets today when today has shows', () => {
    expect(agendaTargetDay([['mon'], ['today'], ['wed']], 1)).toBe(1)
  })

  it('targets the next populated day when today is empty', () => {
    expect(agendaTargetDay([['mon'], [], [], ['thu']], 1)).toBe(3)
    expect(agendaTargetDay([['mon'], [], []], 1)).toBe(-1)
    expect(agendaTargetDay([['mon']], -1)).toBe(-1)
  })

  it('places the day heading below the final sticky-header height', () => {
    expect(agendaScrollTop(400, 900, 320)).toBe(972)
    expect(agendaScrollTop(0, 100, 120)).toBe(0)
  })

  it('does not treat the key that opened Schedule as manual scrolling', () => {
    expect(isAgendaScrollKey('Enter')).toBe(false)
    expect(isAgendaScrollKey('ArrowDown')).toBe(true)
    expect(isAgendaScrollKey('PageDown')).toBe(true)
  })
})
