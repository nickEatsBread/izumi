import { describe, expect, it } from 'vitest'
import { changedJvmFilters } from './jvm-filters'
import type { JvmSourceFilter } from './manager'

const defaults: JvmSourceFilter[] = [
  { name: 'Sort', type: 'Sort', state: {}, values: ['Popular', 'Newest'] },
  { name: '', type: 'Separator', state: 0 },
  { name: 'Genre', type: 'Select', state: 0, values: ['<select>', 'Action', 'Drama'] },
  {
    name: 'Tags',
    type: 'Group',
    state: [
      { name: 'Magic', type: 'TriState', state: 0 },
      { name: 'School', type: 'TriState', state: 0 },
    ],
  },
]

const copy = (filters: JvmSourceFilter[]): JvmSourceFilter[] => structuredClone(filters)

describe('changedJvmFilters', () => {
  it('sends nothing while every filter still holds the source default', () => {
    expect(changedJvmFilters(copy(defaults), defaults)).toBeUndefined()
    expect(changedJvmFilters([], [])).toBeUndefined()
  })

  it('keeps every position but only the states the user changed', () => {
    const current = copy(defaults)
    current[2].state = 1
    const sent = changedJvmFilters(current, defaults)!
    expect(sent).toHaveLength(4)
    expect(sent[2]).toMatchObject({ name: 'Genre', state: 1 })
    expect('state' in sent[0]).toBe(false)
    expect('state' in sent[1]).toBe(false)
    expect('state' in sent[3]).toBe(false)
  })

  it('leaves an untouched sort alone instead of sending its empty selection back', () => {
    const current = copy(defaults)
    current[2].state = 2
    expect('state' in changedJvmFilters(current, defaults)![0]).toBe(false)
    current[0].state = { index: 1, ascending: false }
    expect(changedJvmFilters(current, defaults)![0].state).toEqual({ index: 1, ascending: false })
  })

  it('sends a group with only its changed children', () => {
    const current = copy(defaults)
    ;(current[3].state as JvmSourceFilter[])[1].state = 2
    const group = changedJvmFilters(current, defaults)![3]
    const children = group.state as JvmSourceFilter[]
    expect(children).toHaveLength(2)
    expect('state' in children[0]).toBe(false)
    expect(children[1]).toMatchObject({ name: 'School', state: 2 })
  })

  it('treats a reset filter as unchanged again', () => {
    const current = copy(defaults)
    current[2].state = 1
    current[2].state = 0
    expect(changedJvmFilters(current, defaults)).toBeUndefined()
  })
})
