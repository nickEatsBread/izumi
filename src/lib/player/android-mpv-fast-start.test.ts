import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const plugin = readFileSync(fileURLToPath(new URL(
  '../../../src-tauri/tauri-plugin-mpv/android/src/main/java/app/izumi/mpv/MpvPlugin.kt',
  import.meta.url,
)), 'utf8')

describe('Android mpv fast-start configuration', () => {
  it('caps network probing without dropping secondary anime tracks', () => {
    expect(plugin).toContain('setOptionString("force-seekable", "yes")')
    expect(plugin).toContain('setOptionString("demuxer-lavf-probesize", "2097152")')
    expect(plugin).toContain('setOptionString("demuxer-lavf-analyzeduration", "1")')
    expect(plugin).toContain('setOptionString("stream-buffer-size", "262144")')
  })
})
