import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, it, expect } from 'vitest'

// Theme templates see one display model whatever component renders them. A hero that passed
// `score` as the string "78%" while cards passed the number 78 made `when.atMost` silently never
// match in hero templates. Both hosts hand the number to the renderer, which owns the "%" label.

const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8')
const hero = read('../banner/Hero.svelte')
const card = read('../cards/SmallCard.svelte')
const node = read('./ThemeNode.svelte')
const layoutEditor = read('./ThemeLayoutEditor.svelte')
const installPreview = read('./ThemeInstallPreview.svelte')
const studio = read('../settings/ThemeStudio.svelte')

describe('theme display model', () => {
  it('passes the numeric score from every host component', () => {
    expect(hero).toContain('score: current.averageScore || undefined')
    expect(card).toContain('score: media.averageScore || undefined')
    expect(hero).not.toMatch(/score: current\.averageScore \?/)
  })
  it('renders bound fields through the shared formatter', () => {
    expect(node).toContain("import { nodeStyle, visibleNode, displayText")
    expect(node).toContain('displayText(item.field, model)')
  })
})

describe('theme recovery surfaces', () => {
  const styleBlock = (src: string) => src.slice(src.indexOf('<style>'))
  it('keeps the layout editor on the Studio editor palette instead of loose hex values', () => {
    expect(styleBlock(layoutEditor)).not.toMatch(/#[0-9a-f]{3,8}\b/i)
    expect(layoutEditor).toContain('accent-color: var(--editor-accent)')
    expect(layoutEditor).toContain('outline: 2px solid var(--editor-focus)')
    expect(studio).toMatch(/--editor-accent: #[0-9a-f]{6}; --editor-focus: #[0-9a-f]{6};/i)
    expect(studio).toContain('accent-color: var(--editor-accent)')
    expect(studio).toContain('outline: 2px solid var(--editor-focus)')
  })
  it('gives the installation preview bar one named recovery palette with a matching focus ring', () => {
    const style = styleBlock(installPreview)
    expect(style).toMatch(/\.theme-preview-bar \{[^}]*--recovery-bg: #19191d; --recovery-fg: #f1f1f4; --recovery-muted: #a5a5af; --recovery-line: #34343d; --recovery-control: #26262d; --recovery-focus: #c8c8e0;/)
    expect(style.replace(/--recovery-[a-z]+: #[0-9a-f]{6};/g, '').replace(/box-shadow:[^;]+;/g, '')).not.toMatch(/#[0-9a-f]{3,8}\b/i)
    expect(style).toContain('outline: 2px solid var(--recovery-focus)')
  })
})
