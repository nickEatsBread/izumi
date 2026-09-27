import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const read = (file: string) => readFileSync(fileURLToPath(new URL(file, import.meta.url)), 'utf8')
const detail = read('./AnimeDetail.svelte')

describe('series page chrome for themes', () => {
  it('covers the phone bottom navigation while the page is open when the theme asks', () => {
    expect(detail).toContain("import { suppressBottomNav } from '$lib/shell/chrome'")
    expect(detail).toContain("if (!$isMobile || detailTheme.nav !== 'hidden') return")
    expect(detail).toContain('return suppressBottomNav()')
  })
  it('names the floating bar and the phone byline', () => {
    expect(detail.match(/<div data-slot="detail\.bar" data-solid=\{barState\.solid \|\| undefined\} bind:clientHeight=\{barHeight\}/g)?.length).toBe(2)
    expect(detail).toContain('<div data-part="detail.byline" class="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-foreground/65">')
  })
  it('keys every fact', () => {
    expect(read('./FactList.svelte').match(/data-part="fact" data-key=\{fact\.key\}/g)?.length).toBe(3)
    expect(detail.match(/data-part="fact" data-key="[a-z]+"/g)?.length).toBe(14)
    expect(detail).not.toContain('data-part="fact" class=')
    expect(detail).not.toContain('data-part="fact">')
  })
  it('names character and staff credits', () => {
    const people = read('./RichMetadata.svelte')
    for (const hook of ['person', 'person.photo', 'person.name', 'person.role']) {
      expect(people.match(new RegExp(`data-part="${hook.replace('.', '\\.')}"`, 'g'))?.length, hook).toBe(3)
    }
  })
})
