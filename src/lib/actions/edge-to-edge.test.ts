import { beforeEach, describe, expect, it } from 'vitest'
import { acquireEdgeToEdge, resetEdgeToEdgeForTests } from './edge-to-edge'

function fakeRoot() {
  const classes = new Set<string>()
  return {
    classList: { add: (t: string) => classes.add(t), remove: (t: string) => classes.delete(t) },
    has: (t: string) => classes.has(t),
  }
}

describe('acquireEdgeToEdge', () => {
  beforeEach(resetEdgeToEdgeForTests)

  it('adds the class for the first owner and removes it for the last', () => {
    const root = fakeRoot()
    const release = acquireEdgeToEdge(root)
    expect(root.has('edge-to-edge')).toBe(true)
    release()
    expect(root.has('edge-to-edge')).toBe(false)
  })

  it('keeps the class while a second owner still needs it', () => {
    // The overlap case: the next screen mounts before the previous one tears down.
    const root = fakeRoot()
    const first = acquireEdgeToEdge(root)
    const second = acquireEdgeToEdge(root)
    first()
    expect(root.has('edge-to-edge')).toBe(true)
    second()
    expect(root.has('edge-to-edge')).toBe(false)
  })

  it('ignores a release that runs twice', () => {
    const root = fakeRoot()
    const release = acquireEdgeToEdge(root)
    const other = acquireEdgeToEdge(root)
    release()
    release()
    expect(root.has('edge-to-edge')).toBe(true)
    other()
    expect(root.has('edge-to-edge')).toBe(false)
  })
})
