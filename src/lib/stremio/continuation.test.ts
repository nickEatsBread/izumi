import { describe, expect, it, vi } from 'vitest'
import { applyContinuationState } from './continuation'

describe('automatic continuation picker lifecycle', () => {
  it.each(['resolving', 'idle', 'error'] as const)('keeps the picker open for %s', (status) => {
    const closePicker = vi.fn()
    const onState = vi.fn()
    const state = status === 'error' ? { status, message: 'Source failed' } : { status }

    const result = applyContinuationState(state, closePicker, onState)

    expect(closePicker).not.toHaveBeenCalled()
    expect(onState).toHaveBeenCalledWith(state)
    expect(result.played).toBe(false)
  })

  it('closes the picker after playback actually starts', () => {
    const closePicker = vi.fn()
    const onState = vi.fn()
    const state = { status: 'playing' } as const

    const result = applyContinuationState(state, closePicker, onState)

    expect(closePicker).toHaveBeenCalledOnce()
    expect(onState).toHaveBeenCalledWith(state)
    expect(result).toEqual({ played: true, error: '' })
  })
})
