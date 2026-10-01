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

describe('Settings Back and route focus memory in the app layout (commit 10)', () => {
  it('imports the Back model, the history trail and route focus memory', () => {
    expect(layout).toMatch(/^\s*import \{[^}]*\bonMount\b[^}]*\} from 'svelte'$/m)
    expect(layout).toMatch(/^\s*import \{[^}]*\bfocusByNav\b[^}]*\} from '\$lib\/nav'$/m)
    expect(layout).toMatch(/^\s*import \{[^}]*\bclearBackPending\b[^}]*\} from '\$lib\/nav\/nav-state'$/m)
    expect(layout).toContain("import { focusRestoreAllowed, rememberRouteFocus, restoreRouteFocus, routeFocusKey } from '$lib/nav/focus-memory'")
    expect(layout).toContain("import { publishBackHint, startBackHint } from '$lib/nav/back'")
    expect(layout).toContain("import { recordTrail } from '$lib/navigation/history-trail'")
  })

  it('remembers what held focus on the page being left, after the popstate cancel and the scroll save', () => {
    const statements = hookStatements('beforeNavigate((navigation) => {')
    const scroll = statements.indexOf('if (from?.url) rememberScroll(from.url)')
    expect(scroll).toBeGreaterThan(0)
    expect(statements[scroll + 1]).toBe('if (from?.url) rememberRouteFocus(routeFocusKey(from.url))')
    expect(statements[scroll + 2]).toBe('routeFocusRestore?.abort()')
    expect(layout.split('rememberRouteFocus(').length - 1).toBe(1)
  })

  it('after every navigation: trail, Back guard, focus back on a history return, the B prompt republished', () => {
    expect(hookStatements('afterNavigate(({ to, type }) => {')).toEqual([
      'clearBackPending()',
      'if (to?.url) {',
      'recordTrail(to.url.pathname + to.url.search, type)',
      "if (type === 'popstate' && !$playing && focusRestoreAllowed()) {",
      'const controller = new AbortController()',
      'routeFocusRestore = controller',
      'void restoreRouteFocus(routeFocusKey(to.url), {',
      'signal: controller.signal,',
      'focus: (el) => { focusByNav(el, false, true); focusByNav(el, true, true) },',
      '})',
      '}',
      '}',
      'publishBackHint()',
    ])
    expect(layout).toContain('  let routeFocusRestore: AbortController | null = null\n  afterNavigate(({ to, type }) => {')
  })

  it('publishes what B does next from mount, once', () => {
    expect(layout).toContain('  onMount(() => startBackHint())')
    expect(layout.split('startBackHint(').length - 1).toBe(1)
  })
})
