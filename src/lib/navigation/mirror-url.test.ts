import { beforeEach, describe, expect, it, vi } from 'vitest'

const replaceState = vi.fn(async () => {})
vi.mock('$app/navigation', () => ({ replaceState }))
vi.mock('$app/state', () => ({ page: { state: { kept: true } } }))
const { mirrorUrl } = await import('./mirror-url')

describe('mirrorUrl', () => {
  beforeEach(() => {
    replaceState.mockClear()
    vi.stubGlobal('location', { pathname: '/app/search', search: '?search=one' })
  })

  it('writes a different address with the current page state', () => {
    mirrorUrl('/app/search?search=two')
    expect(replaceState).toHaveBeenCalledWith('/app/search?search=two', { kept: true })
  })

  it('settles on the address bar, not on page.url, which a shallow replace never changes', () => {
    mirrorUrl('/app/search?search=one')
    expect(replaceState).not.toHaveBeenCalled()
  })

  it('swallows a rejected write (router still starting)', async () => {
    replaceState.mockRejectedValueOnce(new Error('navigation before start'))
    expect(() => mirrorUrl('/app/search?search=three')).not.toThrow()
    await Promise.resolve()
  })
})
