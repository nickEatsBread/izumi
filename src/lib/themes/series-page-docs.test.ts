import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { THEME_HOOKS } from './hooks'

const docs = readFileSync(fileURLToPath(new URL('../../../docs/THEMES.md', import.meta.url)), 'utf8')

describe('series page composition docs', () => {
  it('explains every new key', () => {
    for (const text of ['`detail.sections`', '`nav: "hidden"`', '`continue: "card"`', '`toolbar`', '`controls`', '`search: "field"`', '`paging`', '`pageSize`', '`toolbarMin`', '`seasons`', '`order`']) {
      expect(docs, text).toContain(text)
    }
  })
  // izumi's own bar draws the layout switch as two options; a theme's toolbar draws one toggle.
  it('describes both forms of the layout switch, in the hook list and the docs alike', () => {
    const hook = Object.values(THEME_HOOKS).flatMap((hooks) => hooks ?? []).find((entry) => entry.name === 'episodes.layout')
    expect(hook?.description).toContain('both options')
    expect(hook?.description).toContain('one toggle')
    expect(docs).toContain(`| \`episodes.layout\` | part | ${hook?.description} | \`data-layout\` |`)
  })
  it("says a flip order alone keeps izumi's toolbar", () => {
    expect(docs).toContain('`order: "flip"` on its own does not')
  })
  it('says where the desktop synopsis shows once a theme sets the sections', () => {
    expect(docs).toContain('a theme that sets `sections` shows the synopsis once')
  })
  it('lists the episode template fields', () => {
    for (const field of ['`episodeNo`', '`episodeCode`', '`watched`', '`filler`', '`rating`']) expect(docs, field).toContain(field)
  })
})
