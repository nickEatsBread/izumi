import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8').replace(/\r\n/g, '\n')
const source = read('./CacheStorageSettings.svelte')
const rustList = read('../../../../src-tauri/src/cache_gc.rs').match(/const BUCKETS: \[&str; \d+\] = \[([^\]]*)\]/)?.[1] ?? ''
const rustBuckets = [...rustList.matchAll(/"([^"]+)"/g)].map((m) => m[1])

describe('CacheStorageSettings', () => {
  it('lists the cache buckets the native side clears, one per line, with stable keys', () => {
    for (const id of ['thumbs', 'direct-torrents', 'torrent-metadata', 'subs', 'gif-capture']) expect(source).toContain(`{ id: '${id}'`)
    expect(source).toContain('settingKey={`cache-${bucket.id}`}')
    expect(source).toContain('settingKey="cache-total"')
  })

  it('lists every bucket the native side reports, in its order, so the rows add up to the total', () => {
    expect(rustBuckets.length).toBeGreaterThan(0)
    expect([...source.matchAll(/\{ id: '([^']+)'/g)].map((m) => m[1])).toEqual(rustBuckets)
  })

  it('drops the total row controls below the text on a phone, with larger tap targets there', () => {
    expect(source).toMatch(/settingKey="cache-total"[^>]*controlLayout="stack"/)
    expect(source.match(/py-2\.5 text-sm[^"]*sm:py-2 sm:text-xs/g)).toHaveLength(2)
    expect(source).toMatch(/py-2 text-sm[^"]*sm:py-1\.5 sm:text-xs/)
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
