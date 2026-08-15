/**
 * Extension HTTP is owned by the native bridge, not the WebView. Its navigator connectivity hint
 * can therefore be false while requests work perfectly (notably in sandboxed/Android workers).
 * Extensions may use both the standard `onLine` and its `isOnline` compatibility property.
 */
export function markExtensionNavigatorOnline(navigatorObject: object): void {
  for (const property of ['onLine', 'isOnline']) {
    try {
      Object.defineProperty(navigatorObject, property, {
        configurable: true,
        enumerable: true,
        value: true,
      })
    } catch {
      // A future WebView may make the object non-extensible. The real request remains authoritative.
    }
  }
}
