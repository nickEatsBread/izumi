import { describe, expect, it } from 'vitest'
import { flipInGutter, planEpisodeToolbar, themedEpisodeToolbar, type EpisodeToolbarInput } from './toolbar-plan'

const base: EpisodeToolbarInput = { phone: true, offline: false, queueEnabled: false, selecting: false, total: 24, rail: false }

describe('episode toolbar plan', () => {
  it("keeps izumi's own toolbar when no toolbar key is set", () => {
    expect(planEpisodeToolbar(base).composed).toBe(false)
    expect(planEpisodeToolbar({ ...base, order: 'flip', phone: false, rail: true }).composed).toBe(false)
    expect(planEpisodeToolbar({ ...base, paging: 'ranges', search: false }).composed).toBe(false)
  })
  it('composes a toolbar for any toolbar key or no sort', () => {
    for (const input of [{ toolbar: 'bar' }, { controls: [] }, { search: 'field' }, { order: 'none' }, { paging: 'dropdown' }, { toolbarMin: 25 }] as Partial<EpisodeToolbarInput>[]) {
      expect(planEpisodeToolbar({ ...base, ...input }).composed, JSON.stringify(input)).toBe(true)
      expect(themedEpisodeToolbar({ ...base, ...input }), JSON.stringify(input)).toBe(true)
    }
  })
  // API 1 and 2 themes set `order: "flip"` on its own: they keep izumi's toolbar exactly as before.
  it("keeps izumi's toolbar for a flip order alone, on phones and on desktop", () => {
    for (const phone of [true, false]) {
      for (const rail of [true, false]) {
        const plan = planEpisodeToolbar({ ...base, order: 'flip', phone, rail })
        expect(plan.composed, JSON.stringify({ phone, rail })).toBe(false)
        // Desktop keeps the round flip button beside the list; phones ignore the flip.
        expect(plan.gutter, JSON.stringify({ phone, rail })).toBe(!phone)
      }
    }
  })
  it("draws a flip inside the theme's toolbar, except beside a desktop right-hand rail", () => {
    const desktop = planEpisodeToolbar({ ...base, order: 'flip', phone: false, toolbar: 'bar' })
    expect(desktop).toMatchObject({ composed: true, gutter: false })
    expect(desktop.inline).toContain('sort')
    const phone = planEpisodeToolbar({ ...base, order: 'flip', toolbar: 'header' })
    expect(phone).toMatchObject({ composed: true, gutter: false })
    expect(phone.inline).toContain('sort')
    const rail = planEpisodeToolbar({ ...base, order: 'flip', phone: false, rail: true, toolbar: 'bar' })
    expect(rail).toMatchObject({ composed: true, gutter: true })
    expect([...rail.inline, ...rail.menu]).not.toContain('sort')
    expect(planEpisodeToolbar({ ...base, order: 'tabs', phone: false, rail: true }).gutter).toBe(false)
    expect(planEpisodeToolbar({ ...base, phone: false }).gutter).toBe(false)
  })
  it('answers the gutter question for the info column without a whole plan', () => {
    expect(flipInGutter({ order: 'flip', total: 24, phone: false, rail: false })).toBe(true)
    expect(flipInGutter({ order: 'flip', total: 24, phone: false, rail: false, controls: ['sort'] })).toBe(false)
    expect(flipInGutter({ order: 'flip', total: 24, phone: false, rail: true, controls: ['sort'] })).toBe(true)
    expect(flipInGutter({ order: 'flip', total: 24, phone: true, rail: false })).toBe(false)
    // A list shorter than `toolbarMin` swaps in the theme's toolbar, and the flip goes with it.
    expect(flipInGutter({ order: 'flip', total: 12, toolbarMin: 13, phone: false, rail: false })).toBe(false)
  })
  it('shows the listed controls inline in order and moves the rest into the menu', () => {
    const plan = planEpisodeToolbar({ ...base, queueEnabled: true, controls: ['search', 'sort'] })
    expect(plan.inline).toEqual(['search', 'sort'])
    expect(plan.menu).toEqual(['layout', 'download', 'queue'])
  })
  it('puts every control in the menu for an empty list', () => {
    expect(planEpisodeToolbar({ ...base, toolbar: 'header', controls: [] })).toMatchObject({ variant: 'header', inline: [], menu: ['sort', 'layout', 'search', 'download'], search: 'toggle' })
  })
  it('drops controls that cannot work', () => {
    expect(planEpisodeToolbar({ ...base, order: 'none', search: false, offline: true }).inline).toEqual(['layout'])
    expect(planEpisodeToolbar({ ...base, toolbar: 'bar', arrangement: 'carousel' }).inline).toEqual(['sort', 'search', 'download'])
    expect(planEpisodeToolbar({ ...base, toolbar: 'bar', arrangement: 'grid' }).inline).not.toContain('layout')
    expect(planEpisodeToolbar({ ...base, toolbar: 'bar', arrangement: 'list' }).inline).toContain('layout')
    expect(planEpisodeToolbar({ ...base, toolbar: 'bar', phone: false }).inline).toEqual(['sort', 'search', 'download'])
    expect(planEpisodeToolbar({ ...base, toolbar: 'bar', selecting: true }).inline).not.toContain('download')
    expect(planEpisodeToolbar({ ...base, toolbar: 'bar', phone: false, order: 'flip', rail: true }).inline).not.toContain('sort')
  })
  it('keeps an always-visible field in the bar, or on its own row under a heading', () => {
    expect(planEpisodeToolbar({ ...base, search: 'field', controls: ['layout'] })).toMatchObject({ inline: ['search', 'layout'], search: 'inline' })
    expect(planEpisodeToolbar({ ...base, toolbar: 'header', search: 'field' })).toMatchObject({ search: 'row' })
    expect(planEpisodeToolbar({ ...base, toolbar: 'header', search: 'field' }).inline).not.toContain('search')
    expect(planEpisodeToolbar({ ...base, toolbar: 'header', search: 'field' }).menu).not.toContain('search')
    expect(planEpisodeToolbar({ ...base, toolbar: 'bar', phone: false }).search).toBe('inline')
    expect(planEpisodeToolbar({ ...base, toolbar: 'bar' }).search).toBe('toggle')
  })
  it('shrinks to the overflow menu below the episode threshold', () => {
    const plan = planEpisodeToolbar({ ...base, total: 12, toolbarMin: 13, search: 'field', controls: ['search', 'layout'] })
    expect(plan).toMatchObject({ composed: true, inline: [], search: 'toggle' })
    expect(plan.menu).toEqual(['sort', 'layout', 'search', 'download'])
    expect(planEpisodeToolbar({ ...base, total: 13, toolbarMin: 13, controls: ['layout'] }).inline).toEqual(['layout'])
  })
})
