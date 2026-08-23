import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const read = (url: URL) => readFileSync(fileURLToPath(url), 'utf8')
const store = read(new URL('./store.ts', import.meta.url))
const service = read(new URL('../../../src-tauri/tauri-plugin-extplayer/android/src/main/java/app/izumi/extplayer/DownloadService.kt', import.meta.url))
const plugin = read(new URL('../../../src-tauri/tauri-plugin-extplayer/android/src/main/java/app/izumi/extplayer/ExtPlayerPlugin.kt', import.meta.url))

describe('Android background downloads', () => {
  it('requests notification access at the download boundary', () => {
    expect(store).toContain("invoke<{ granted?: boolean }>('plugin:extplayer|download_notifications')")
    expect(store).toContain('ensureAndroidDownloadNotifications().finally(pump)')
    expect(plugin).toContain('fun requestDownloadNotifications(invoke: Invoke)')
    expect(plugin).toContain('Manifest.permission.POST_NOTIFICATIONS')
  })

  it('publishes useful progress and survives removing the UI task', () => {
    expect(store).toContain('formatSpeed(totalSpeed)')
    expect(store).toContain('detail: detail || null')
    expect(service).toContain('.setCategory(NotificationCompat.CATEGORY_PROGRESS)')
    expect(service).toContain('.setVisibility(NotificationCompat.VISIBILITY_PUBLIC)')
    expect(service).not.toContain('override fun onTaskRemoved(rootIntent: Intent?) {\n        stopSelf()')
    expect(service).toContain('override fun onTimeout(startId: Int, fgsType: Int)')
  })
})
