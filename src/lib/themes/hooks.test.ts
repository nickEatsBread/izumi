import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { THEME_HOOKS } from './hooks'

const SRC = fileURLToPath(new URL('../../', import.meta.url))
function svelteFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return svelteFiles(path)
    return name.endsWith('.svelte') ? [path] : []
  })
}

/** Every hook the markup renders: literal attributes plus quoted literals inside expressions. */
const rendered = new Map<string, Set<'slot' | 'part'>>()
const add = (kind: string, name: string) => {
  const kinds = rendered.get(name) ?? new Set<'slot' | 'part'>()
  kinds.add(kind as 'slot' | 'part')
  rendered.set(name, kinds)
}
for (const file of svelteFiles(SRC)) {
  const text = readFileSync(file, 'utf8')
  for (const match of text.matchAll(/data-(slot|part)="([a-z][a-z0-9.-]*)"/g)) add(match[1], match[2])
  for (const match of text.matchAll(/data-(slot|part)=\{([^}]*)\}/g)) {
    for (const literal of match[2].matchAll(/'([a-z][a-z0-9.-]*)'/g)) add(match[1], literal[1])
  }
}

describe('theme styling hook contract', () => {
  for (const [group, hooks] of Object.entries(THEME_HOOKS)) {
    it(`renders every documented ${group} hook`, () => {
      for (const hook of hooks ?? []) expect(rendered.get(hook.name)?.has(hook.kind), `${hook.kind} ${hook.name}`).toBe(true)
    })
  }
  it('documents every hook the app renders', () => {
    const documented = new Map(Object.values(THEME_HOOKS).flatMap((hooks) => hooks ?? []).map((hook) => [hook.name, hook.kind]))
    for (const [name, kinds] of rendered) for (const kind of kinds) expect(documented.get(name), `${kind} ${name}`).toBe(kind)
  })
  it('keeps hook names unique and well formed', () => {
    const names = Object.values(THEME_HOOKS).flatMap((hooks) => hooks ?? []).map((hook) => hook.name)
    expect(new Set(names).size).toBe(names.length)
    for (const name of names) expect(name).toMatch(/^[a-z][a-z0-9.-]*$/)
  })
})
