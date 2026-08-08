import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { get } from 'svelte/store'
import { describe, expect, it } from 'vitest'
import { scheduleShowNextUp } from '$lib/settings/ui'

// The "Next up" strip is the first thing on the schedule; some people don't want it. Off means the
// grid starts immediately — see ScheduleGrid, the only place this component is rendered.

const grid = readFileSync(fileURLToPath(new URL('./ScheduleGrid.svelte', import.meta.url)), 'utf8')

describe('schedule "Next up" toggle', () => {
  it('is a persisted setting, on by default', () => {
    expect(get(scheduleShowNextUp)).toBe(true)
  })

  it('gates every render of ScheduleNextUp on the setting', () => {
    const renderSites = grid.match(/<ScheduleNextUp\b/g) ?? []
    const gatedSites = grid.match(/\$scheduleShowNextUp\}<ScheduleNextUp\b/g) ?? []
    expect(renderSites.length).toBeGreaterThan(0)
    expect(gatedSites.length).toBe(renderSites.length)
  })
})
