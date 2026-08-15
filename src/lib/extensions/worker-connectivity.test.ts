import { describe, expect, it } from 'vitest'
import { markExtensionNavigatorOnline } from './worker-connectivity'

describe('extension worker connectivity', () => {
  it('does not let a false WebView hint suppress native extension requests', () => {
    const prototype = { onLine: false }
    const workerNavigator = Object.create(prototype) as { onLine: boolean; isOnline?: boolean }

    markExtensionNavigatorOnline(workerNavigator)

    expect(workerNavigator.onLine).toBe(true)
    expect(workerNavigator.isOnline).toBe(true)
    expect(prototype.onLine).toBe(false)
  })
})
