import { describe, expect, it } from 'vitest'
import { fileURLToPath } from 'node:url'
import { hasAttr, markupElementsFromSource, readSvelteSource, type MarkupElement } from '../../test/svelte-markup'

// Text fields the Settings reachability scan does not reach (it walks the Settings import closure):
// the list editor's episode count and the watch-party room code (spec §4, [T] rows). Each is a
// d-pad stop like every Settings text field: the pad passes over it, A opens the on-screen keyboard.

const fromRepo = (path: string) => fileURLToPath(new URL(`../../../${path}`, import.meta.url))

/** The elements of `file` whose value is bound to the variable `name` (`bind:value={name}`), read
 *  from the parsed markup, so attribute order, line breaks and arrow functions do not matter. */
function boundTo(file: string, name: string): MarkupElement[] {
  return markupElementsFromSource(readSvelteSource(fromRepo(file)), file).filter((el) =>
    el.node.attributes.some((attribute) =>
      attribute.type === 'BindDirective' && attribute.name === 'value'
      && attribute.expression.type === 'Identifier' && attribute.expression.name === name))
}

describe('text fields outside the Settings scan', () => {
  it('the list editor episode count is a d-pad stop', () => {
    const fields = boundTo('src/lib/components/detail/ListEditor.svelte', 'progress')
    expect(fields.map((el) => el.name)).toEqual(['input'])
    expect(hasAttr(fields[0], 'data-focusable')).toBe(true)
  })

  it('the watch-party room code is a d-pad stop', () => {
    const fields = boundTo('src/routes/app/watch/+page.svelte', 'code')
    expect(fields.map((el) => el.name)).toEqual(['input'])
    expect(hasAttr(fields[0], 'data-focusable')).toBe(true)
  })
})
