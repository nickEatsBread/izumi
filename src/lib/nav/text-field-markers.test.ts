import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

// Text fields the Settings reachability scan does not reach (it walks the Settings import closure):
// the list editor's episode count and the watch-party room code (spec §4, [T] rows). Each is a
// d-pad stop like every Settings text field: the pad passes over it, A opens the on-screen keyboard.

const read = (relative: string) =>
  readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8').replace(/\r\n/g, '\n')

/** The opening tag of the element whose attributes contain `marker`. */
function openingTagWith(source: string, marker: string): string {
  const at = source.indexOf(marker)
  expect(at, `missing: ${marker}`).toBeGreaterThan(-1)
  const start = source.lastIndexOf('<', at)
  const end = source.indexOf('>', at)
  return source.slice(start, end + 1)
}

describe('text fields outside the Settings scan', () => {
  it('the list editor episode count is a d-pad stop', () => {
    const tag = openingTagWith(read('../components/detail/ListEditor.svelte'), 'bind:value={progress}')
    expect(tag.startsWith('<input')).toBe(true)
    expect(tag).toContain('data-focusable')
  })

  it('the watch-party room code is a d-pad stop', () => {
    const tag = openingTagWith(read('../../routes/app/watch/+page.svelte'), 'bind:value={code}')
    expect(tag.startsWith('<input')).toBe(true)
    expect(tag).toContain('data-focusable')
  })
})
