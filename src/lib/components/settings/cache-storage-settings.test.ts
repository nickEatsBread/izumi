import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const source = readFileSync(fileURLToPath(new URL('./CacheStorageSettings.svelte', import.meta.url)), 'utf8').replace(/\r\n/g, '\n')

describe('CacheStorageSettings', () => {
  it('lists the cache buckets the native side clears, one per line, with stable keys', () => {
    for (const id of ['thumbs', 'direct-torrents', 'subs', 'gif-capture']) expect(source).toContain(`{ id: '${id}'`)
    expect(source).toContain('settingKey={`cache-${bucket.id}`}')
    expect(source).toContain('settingKey="cache-total"')
  })

  it('keeps the size read, the per-bucket clear and the guarded clear-all', () => {
    expect(source).toContain("invoke<{ id: string; bytes: number }[]>('cache_usage')")
    expect(source).toContain("invoke<number>('clear_cache', { bucket })")
    expect(source).toContain("onclick={() => clear('all')} disabled={busy !== '' || total === 0}")
    expect(source).toContain("disabled={busy !== '' || !sizes[bucket.id]}")
    expect(source).toContain('onMount(() => { void refresh() })')
  })

  it('keeps bucket descriptions to one line and names no provider', () => {
    for (const [, desc] of source.matchAll(/desc: '([^']*)'/g)) expect(desc.length, desc).toBeLessThanOrEqual(80)
    expect(source).not.toMatch(/OpenSubtitles|SubDL|Jimaku/)
  })
})
