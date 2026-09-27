import { describe, expect, it } from 'vitest'
import { planEpisodeToolbar, type EpisodeToolbarInput } from './toolbar-plan'

const base: EpisodeToolbarInput = { phone: true, offline: false, queueEnabled: false, selecting: false, total: 24, railGutter: false }

describe('episode toolbar plan', () => {
  it("keeps izumi's own toolbar when no toolbar key is set", () => {
    expect(planEpisodeToolbar(base).composed).toBe(false)
    expect(planEpisodeToolbar({ ...base, order: 'flip', phone: false, railGutter: true }).composed).toBe(false)
    expect(planEpisodeToolbar({ ...base, paging: 'ranges', search: false }).composed).toBe(false)
  })
  it('composes a toolbar for any toolbar key, a flip outside the rail, or no sort', () => {
    for (const input of [{ toolbar: 'bar' }, { controls: [] }, { search: 'field' }, { order: 'none' }, { order: 'flip' }, { paging: 'dropdown' }] as Partial<EpisodeToolbarInput>[]) {
      expect(planEpisodeToolbar({ ...base, ...input }).composed, JSON.stringify(input)).toBe(true)
    }
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
    expect(planEpisodeToolbar({ ...base, toolbar: 'bar', phone: false, order: 'flip', railGutter: true }).inline).not.toContain('sort')
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
