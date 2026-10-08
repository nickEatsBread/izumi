import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8')

describe('profile header parts', () => {
  const header = read('./ProfileHeader.svelte')
  it('renders each stat as its own part with a value and a label', () => {
    expect(header).toContain(`{@render stat('episodes', summary.episodes, 'episode', 'inline')}{@render stat('titles', summary.titles, 'title', "inline before:content-['_·_']")}`)
    expect(header).toContain('<p data-part="block.stat" data-key={key} class={classes}><span data-part="block.stat.value">{n.toLocaleString()}</span> <span data-part="block.stat.label">{plural(n, noun)}</span></p>')
    // izumi's own one-line look: the wrapper keeps the old line's type, the stats flow inline.
    expect(header).toContain('<div class="text-sm text-white/80">{@render stat(')
  })
  it('names the banner gradient and each shortcut destination', () => {
    expect(header).toContain('<div data-part="block.scrim" class="absolute inset-0 bg-gradient-to-t')
    expect(header).toContain('data-part="button" data-variant="secondary" data-dest={button.to}')
  })
  it('groups the avatar, name and stats so a theme can hide them', () => {
    const group = header.slice(header.indexOf('data-part="block.profile"'), header.indexOf('{#if block.buttons.length}'))
    expect(group).toContain('data-part="block.avatar"')
    expect(group).toContain('data-part="block.name"')
    expect(group).toContain("{@render stat('episodes'")
  })
  it('draws artwork only under the buttons that ask for it, in order, from the titles the viewer watches', () => {
    expect(header).toContain('const artSlots = $derived.by(() => {')
    expect(header).toContain('return block.buttons.map((button) => (button.art ? next++ : -1))')
    // Only a block that asks for art reads the Continue Watching and library stores.
    expect(header).toContain('const buttonArt = $derived(artCount ? profileButtonArt(')
    expect(header).toContain('$continueWatching.map((entry) => entry.media)')
    expect(header).toContain('<img data-part="block.button.art" src={art} alt="" loading="lazy"')
    expect(header).toContain('{:else}{button.label}{/if}</a>')
  })
})

describe('tabbed grid opening tab', () => {
  it('opens on the block default until the viewer picks a tab', () => {
    const grid = read('./TabbedGrid.svelte')
    expect(grid).toContain("const current = $derived(labels.includes(selected) ? selected : labels[block.default ?? 0] ?? labels[0] ?? '')")
  })
})
