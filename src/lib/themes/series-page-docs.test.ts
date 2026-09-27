import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const docs = readFileSync(fileURLToPath(new URL('../../../docs/THEMES.md', import.meta.url)), 'utf8')

describe('series page composition docs', () => {
  it('explains every new key', () => {
    for (const text of ['`detail.sections`', '`nav: "hidden"`', '`continue: "card"`', '`toolbar`', '`controls`', '`search: "field"`', '`paging`', '`pageSize`', '`toolbarMin`', '`seasons`', '`order`']) {
      expect(docs, text).toContain(text)
    }
  })
  it('lists the episode template fields', () => {
    for (const field of ['`episodeNo`', '`episodeCode`', '`watched`', '`filler`', '`rating`']) expect(docs, field).toContain(field)
  })
})
