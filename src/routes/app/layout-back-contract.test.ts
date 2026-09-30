import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

// The app layout is the one place history Back and every navigation pass through (spec §3.8
// "Route-level and mouse Back"). Commits 10 and 11 extend this file and reuse `read`, `layout` and
// `hookStatements`.
const read = (relative: string) =>
  readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8').replace(/\r\n/g, '\n')
const layout = read('./+layout.svelte')

/** The statements of the hook block that starts with `hook`, comments and blank lines dropped. */
function hookStatements(hook: string): string[] {
  const start = layout.indexOf(hook)
  expect(start, hook).toBeGreaterThanOrEqual(0)
  const end = layout.indexOf('\n  })\n', start)
  return layout.slice(start, end).split('\n').slice(1)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('//'))
}

describe('app layout Back contract', () => {
  it('closes the top layer on a history Back before anything else runs', () => {
    const statements = hookStatements('beforeNavigate((navigation) => {')
    expect(statements[0]).toBe("if (navigation.type === 'popstate' && topNavLayer()) { navigation.cancel(); closeTopNavLayer('back'); return }")
    const body = statements.join('\n')
    const closeAll = body.indexOf("closeAllNavLayers('navigate')")
    expect(closeAll).toBeGreaterThan(0)
    expect(body.indexOf('navEpoch.update(')).toBeGreaterThan(0)
    expect(body.indexOf('navInFlight.set(true)')).toBeGreaterThan(0)
    expect(closeAll).toBeLessThan(body.indexOf('rememberScroll(from.url)'))
    expect(body.indexOf('rememberScroll(from.url)')).toBeLessThan(body.indexOf("invoke('close_player')"))
  })

  it('clears the in-flight flag once a navigation lands', () => {
    expect(hookStatements('afterNavigate(({ to }) => {')).toContain('navInFlight.set(false)')
  })
})
