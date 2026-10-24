import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { parseSvelteSource } from '../../../test/svelte-markup'

/** The markup of a component's top-level `{#if $isMobile}` branch, exactly as written. */
function phoneBranch(path: string): string {
  const source = readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8').replace(/\r\n/g, '\n')
  for (const node of parseSvelteSource(source, path).fragment.nodes) {
    if (node.type !== 'IfBlock' || node.test.type !== 'Identifier' || node.test.name !== '$isMobile') continue
    const nodes = node.consequent.nodes
    return source.slice(nodes[0].start, nodes[nodes.length - 1].end)
  }
  throw new Error(`${path} has no top-level {#if $isMobile} block`)
}

// The desktop selection pass (rail indicator, group labels, chips, sticky bar, section fade) must not
// change the phone layout. Update these snapshots only for a deliberate phone change.
describe('phone Settings markup', () => {
  it('keeps the phone section list as it was', () => {
    expect(phoneBranch('./SettingsNav.svelte')).toMatchSnapshot()
  })

  it('keeps the phone settings shell as it was', () => {
    expect(phoneBranch('../../../routes/app/settings/+layout.svelte')).toMatchSnapshot()
  })
})
