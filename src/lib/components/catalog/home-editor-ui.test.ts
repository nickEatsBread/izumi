import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8')
const editor = read('./HomeEditor.svelte')
const frame = read('./HomeRowFrame.svelte')
const home = read('../../../routes/app/home/+page.svelte')

describe('in-place Home editor UI', () => {
  it('wraps every provider style in the same editable section frame', () => {
    expect(home).toContain('<HomeRowFrame')
    expect(read('./CatalogHome.svelte')).toContain('<HomeRowFrame')
    expect(read('./MergedCatalogHome.svelte')).toContain('<HomeRowFrame')
  })

  it('supports webview-safe pointer dragging plus explicit movement controls', () => {
    expect(frame).toContain('onpointerdown={startDrag}')
    expect(frame).toContain('setPointerCapture(event.pointerId)')
    expect(frame).toContain('document.elementFromPoint(event.clientX, event.clientY)')
    expect(frame).toContain('moveHomeRowBefore(target, visibleIds, rowId, beforeId)')
    expect(frame).toContain('moveHomeRowBy(target, visibleIds, rowId, -1)')
    expect(frame).toContain('moveHomeRowBy(target, visibleIds, rowId, 1)')
  })

  it('offers an insertion point between sections and a grouped section library', () => {
    expect(frame).toContain('Add here')
    expect(frame).toContain('beforeId: rowId')
    expect(editor).toContain('Add a section')
    expect(editor).toContain('insertHomeRow(target, rows, rowId, request?.beforeId ?? null)')
    expect(editor).toContain('{#each groups as group (group.name)}')
  })

  it('keeps editing reversible and easy to leave', () => {
    expect(editor).toContain('resetCatalogHomeLayout(target)')
    expect(editor).toContain('Done')
    expect(editor).toContain("event.key !== 'Escape'")
  })

  it('lets backdrop clicks reach the section picker scrim and keeps the status concise', () => {
    expect(editor).toContain('pointer-events-none fixed inset-x-0 bottom-0')
    expect(editor).toContain('data-nav-trap class="pointer-events-auto')
    expect(editor).toContain('Editing {label}')
    expect(editor).not.toContain('Editing {label} Home')
  })
})
