import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CONTINUE_DISMISS_HOLD_MS, longPressDismiss } from './continue-dismiss'

type Handler = (event: any) => void

function fakeNode() {
  const listeners = new Map<string, Handler>()
  const node = {
    addEventListener(type: string, handler: Handler) { listeners.set(type, handler) },
    removeEventListener(type: string) { listeners.delete(type) },
  } as unknown as HTMLElement
  const fire = (type: string, event: Record<string, unknown> = {}) => listeners.get(type)?.({
    preventDefault: vi.fn(), stopImmediatePropagation: vi.fn(), ...event,
  })
  return { node, fire, listeners }
}

const bareTarget = { closest: () => null }

describe('Continue Watching long-press dismissal', () => {
  afterEach(() => vi.useRealTimers())

  it('dismisses after a stationary touch hold and suppresses the following play click', () => {
    vi.useFakeTimers()
    const onLongPress = vi.fn()
    const { node, fire } = fakeNode()
    longPressDismiss(node, { onLongPress })

    fire('pointerdown', { pointerType: 'touch', button: 0, clientX: 20, clientY: 30, target: bareTarget })
    vi.advanceTimersByTime(CONTINUE_DISMISS_HOLD_MS - 1)
    expect(onLongPress).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(onLongPress).toHaveBeenCalledOnce()

    const click = { preventDefault: vi.fn(), stopImmediatePropagation: vi.fn() }
    fire('click', click)
    expect(click.preventDefault).toHaveBeenCalledOnce()
    expect(click.stopImmediatePropagation).toHaveBeenCalledOnce()
  })

  it('cancels when the touch turns into a carousel swipe', () => {
    vi.useFakeTimers()
    const onLongPress = vi.fn()
    const { node, fire } = fakeNode()
    longPressDismiss(node, { onLongPress })

    fire('pointerdown', { pointerType: 'touch', button: 0, clientX: 20, clientY: 30, target: bareTarget })
    fire('pointermove', { clientX: 50, clientY: 30 })
    vi.advanceTimersByTime(CONTINUE_DISMISS_HOLD_MS)
    expect(onLongPress).not.toHaveBeenCalled()
  })

  it('ignores mouse presses and interactive controls', () => {
    vi.useFakeTimers()
    const onLongPress = vi.fn()
    const { node, fire } = fakeNode()
    longPressDismiss(node, { onLongPress })

    fire('pointerdown', { pointerType: 'mouse', button: 0, clientX: 0, clientY: 0, target: bareTarget })
    fire('pointerdown', { pointerType: 'touch', button: 0, clientX: 0, clientY: 0, target: { closest: () => ({}) } })
    vi.runAllTimers()
    expect(onLongPress).not.toHaveBeenCalled()
  })
})

describe('Continue Watching dismissal input wiring', () => {
  it('keeps dismissal gesture-only and maps the Deck X button to the existing D action', () => {
    const row = readFileSync(fileURLToPath(new URL('./ContinueRow.svelte', import.meta.url)), 'utf8')
    const nav = readFileSync(fileURLToPath(new URL('../../nav/gamepad.ts', import.meta.url)), 'utf8')
    const nativePad = readFileSync(fileURLToPath(new URL('../../../../src-tauri/src/player/gamepad_linux.rs', import.meta.url)), 'utf8')

    expect(row).toContain('use:longPressDismiss')
    expect(row).not.toContain('title="Remove from Continue Watching"')
    expect(nav).toContain("case 'x': keydown('d')")
    expect(nativePad).toContain('Button::West => "x"')
  })
})
