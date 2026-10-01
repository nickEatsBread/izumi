import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const read = (relative: string) =>
  readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8').replace(/\r\n/g, '\n')

describe('the controller B goes through the layered Back', () => {
  const gamepad = read('./gamepad.ts')
  const back = read('./back.ts')

  it('drops the second source of one press before any owner in the pad chain sees it', () => {
    expect(gamepad).toContain("import { handleLayeredBack, isDuplicateBackPress } from './back'")
    expect(gamepad).toContain([
      "    inputType.set('dpad')",
      '    // One physical B can arrive twice on Android (this pad edge and the system Back it also raises).',
      '    // Whichever comes second within BACK_DEBOUNCE_MS is dropped here, before any owner below sees it.',
      "    if (name === 'b' && isDuplicateBackPress('gamepad')) return",
    ].join('\n'))
  })

  it('runs the pipeline in browse after the player-closed guard, then keeps the Home prompt / history.back()', () => {
    expect(gamepad).toContain([
      "      case 'b':",
      '        // Swallow B briefly after the player closed (the close-vs-exit race, above).',
      '        if (performance.now() - playerClosedAt < 500) break',
      "        if (handleLayeredBack('gamepad')) break",
      "        if (location.pathname.replace(/\\/$/, '') === '/app/home') exitPrompt.set(true)",
      '        else {',
      '          markBackPending()',
      '          history.back()',
      '        }',
      '        break',
    ].join('\n'))
    // The legacy trap probe moved into back.ts step 5, which also covers traps without data-nav-escape.
    expect(gamepad).not.toContain("document.querySelector('[data-nav-trap][data-nav-escape]')")
    expect(back).toContain("return plan('close', () => { dispatchPadKey('Escape'); return true })")
  })

  it('keeps the import graph acyclic, with $app/navigation only in settings/back.ts', () => {
    expect(back).not.toMatch(/from '\.\/(gamepad|index)'/)
    expect(back).not.toContain("from '$app/")
    expect(read('./nav-state.ts')).not.toMatch(/from '(\$app|\$lib|\.)/)
    expect(read('./focus-memory.ts')).not.toMatch(/from '\.\/(gamepad|index|back)'/)
    expect(read('../settings/hierarchy.ts')).not.toMatch(/^import /m)
    expect(read('../navigation/history-trail.ts')).not.toContain("from '$app/")
    expect(read('../settings/back.ts')).toContain("import { goto } from '$app/navigation'")
  })
})
