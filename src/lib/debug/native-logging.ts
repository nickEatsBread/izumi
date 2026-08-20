import { invoke } from '@tauri-apps/api/core'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import { developerLogging } from '$lib/settings/ui'
import { setDeveloperConsoleEnabled } from './log-gate'

type NativeDeveloperLog = {
  target: string
  level: 'debug' | 'info' | 'warn' | 'error'
  message: string
}

/** Bridge opt-in native/JVM diagnostics into the WebView console. The native side checks the same
 * toggle before emitting, so leaving this listener installed has no background logging cost. */
export function initDeveloperLogging(): () => void {
  let disposed = false
  let unlisten: UnlistenFn | undefined
  const unsubscribe = developerLogging.subscribe((enabled) => {
    setDeveloperConsoleEnabled(enabled)
    void invoke('jvm_extension_set_debug', { enabled }).catch(() => {})
  })
  void listen<NativeDeveloperLog>('developer-log', ({ payload }) => {
    const prefix = `[native:${payload.target}]`
    if (payload.level === 'error') console.error(prefix, payload.message)
    else if (payload.level === 'warn') console.warn(prefix, payload.message)
    else if (payload.level === 'info') console.info(prefix, payload.message)
    else console.debug(prefix, payload.message)
  }).then((stop) => {
    if (disposed) stop()
    else unlisten = stop
  }).catch(() => {})
  return () => {
    disposed = true
    unsubscribe()
    unlisten?.()
  }
}
