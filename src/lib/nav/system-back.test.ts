// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { installSystemBack, type SystemBackWindow } from './system-back'

const mocks = vi.hoisted(() => ({
  handleLayeredBack: vi.fn<(source: 'gamepad' | 'system') => boolean>(() => true),
}))
vi.mock('./back', () => ({ handleLayeredBack: mocks.handleLayeredBack }))

describe('phone system Back bridge', () => {
  beforeEach(() => {
    mocks.handleLayeredBack.mockReset()
    mocks.handleLayeredBack.mockReturnValue(true)
    delete (window as SystemBackWindow).__izumiBack
  })

  it('answers the native bridge with the system source of the layered Back pipeline', () => {
    const target = {} as SystemBackWindow
    installSystemBack(target)
    expect(target.__izumiBack?.()).toBe(true)
    expect(mocks.handleLayeredBack).toHaveBeenCalledTimes(1)
    expect(mocks.handleLayeredBack).toHaveBeenCalledWith('system')
  })

  it('answers false when nothing was open, so MainActivity runs stock Back', () => {
    mocks.handleLayeredBack.mockReturnValue(false)
    const target = {} as SystemBackWindow
    installSystemBack(target)
    expect(target.__izumiBack?.()).toBe(false)
  })

  it('runs the pipeline on every press, never at install time', () => {
    const target = {} as SystemBackWindow
    installSystemBack(target)
    expect(mocks.handleLayeredBack).not.toHaveBeenCalled()
    target.__izumiBack?.()
    target.__izumiBack?.()
    expect(mocks.handleLayeredBack).toHaveBeenCalledTimes(2)
  })

  it('removes the bridge on teardown, so an unmounted shell falls through to stock Back', () => {
    const target = {} as SystemBackWindow
    const stop = installSystemBack(target)
    stop()
    expect('__izumiBack' in target).toBe(false)
  })

  it('never removes a newer bridge when an older mount tears down late', () => {
    const target = {} as SystemBackWindow
    const stopOld = installSystemBack(target)
    installSystemBack(target)
    const newer = target.__izumiBack
    stopOld()
    expect(target.__izumiBack).toBe(newer)
    expect(target.__izumiBack?.()).toBe(true)
  })

  it('installs on the real window by default', () => {
    const stop = installSystemBack()
    expect((window as SystemBackWindow).__izumiBack?.()).toBe(true)
    stop()
    expect('__izumiBack' in window).toBe(false)
  })
})
