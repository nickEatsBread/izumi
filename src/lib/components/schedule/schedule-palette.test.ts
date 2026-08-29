import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const read = (name: string) =>
  readFileSync(fileURLToPath(new URL(`./${name}`, import.meta.url)), 'utf8')

const nextUp = read('ScheduleNextUp.svelte')
const dayColumn = read('DayColumn.svelte')
const agenda = read('AgendaWeek.svelte')

describe('schedule palette', () => {
  it('keeps repeated cards and list-status badges neutral instead of using the theme accent', () => {
    for (const source of [nextUp, dayColumn, agenda]) {
      expect(source).not.toContain('border-theme')
      expect(source).not.toContain('bg-theme/15')
      expect(source).not.toContain('text-theme')
    }

    expect(nextUp).toContain('text-sky-400')
    expect(dayColumn).toContain('bg-foreground/[0.08]')
    expect(agenda).toContain('bg-foreground/[0.08]')
  })
})
