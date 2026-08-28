import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const manager = readFileSync(fileURLToPath(new URL('./manager.ts', import.meta.url)), 'utf8')
const android = readFileSync(fileURLToPath(new URL('../../../src-tauri/tauri-plugin-extplayer/android/src/main/java/app/izumi/extplayer/ExtPlayerPlugin.kt', import.meta.url)), 'utf8')
const androidBridge = readFileSync(fileURLToPath(new URL('../../../src-tauri/src/jvm_extensions_android.rs', import.meta.url)), 'utf8')
const desktopBridge = readFileSync(fileURLToPath(new URL('../../../src-tauri/src/jvm_extensions.rs', import.meta.url)), 'utf8')
const packages = readFileSync(fileURLToPath(new URL('../../../src-tauri/src/extension_package.rs', import.meta.url)), 'utf8')

describe('JVM catalog bridge', () => {
  it('exposes browsing through the shared desktop command', () => {
    expect(manager).toContain("method: 'getPopular' | 'getLatestUpdates' | 'search'")
    expect(manager).toContain("jvmInvoke<Record<string, unknown>>('getDetail'")
  })

  it('dispatches popular and latest calls through the Android runtime host', () => {
    expect(android).toContain('"getPopular" -> invokeAniyomi(')
    expect(android).toContain('"aniyomiGetPopular"')
    expect(android).toContain('"getLatestUpdates" -> invokeAniyomi(')
    expect(android).toContain('"aniyomiGetLatestUpdates"')
  })

  it('aligns Android with the filter and preference capable 2.3 runtime', () => {
    expect(androidBridge).toContain('const RUNTIME_VERSION: &str = "2.3.0"')
    expect(android).toContain('"getFilterList" -> invokeAniyomi(')
    expect(android).toContain('"aniyomiGetPreferences" -> invokeAniyomi(')
    expect(android).toContain('"aniyomiSavePreference" -> invokeAniyomi(')
    expect(manager).toContain("jvmInvoke<JvmSourceFilter[]>('getFilterList'")
    expect(manager).toContain("jvmInvoke<JvmSourcePreference[]>('aniyomiGetPreferences'")
  })

  it('cancels the native runtime request when the UI aborts or times out', () => {
    expect(manager).toContain("invoke<void>('jvm_extension_cancel', { requestId })")
    expect(manager).toContain('void cancel().then(() => reject(')
    expect(android).toContain('invokeAniyomi("cancelRequest", it)')
    expect(desktopBridge).toContain('runtime.cancel_request(&request_id).await')
    expect(desktopBridge).not.toContain('ensure_started(&app)\n        .await?\n        .cancel(&request_id)')
  })

  it('keeps desktop runtime startup cancellable while extensions load', () => {
    expect(desktopBridge).toContain('startup: Mutex<()>')
    expect(desktopBridge).toContain('generation: AtomicU64')
    const publishProcess = desktopBridge.indexOf('*self.process.lock().await = Some(process.clone());')
    const loadExtensions = desktopBridge.indexOf('"loadExtensions",', publishProcess)
    expect(publishProcess).toBeGreaterThan(0)
    expect(loadExtensions).toBeGreaterThan(publishProcess)
  })

  it('repairs APK resources and converts every dex file on desktop', () => {
    expect(packages).toContain('repair_aniyomi_jar_resources')
    expect(packages).toContain('name.starts_with("assets/")')
    expect(desktopBridge).toContain('com.googlecode.dex2jar.tools.Dex2jarCmd')
    expect(desktopBridge).toContain('aniyomi_multidex_packages')
  })
})
