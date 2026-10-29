import { afterEach, describe, expect, it, vi } from 'vitest'

const phttp = vi.hoisted(() => vi.fn())
vi.mock('$lib/net/http', () => ({ phttp }))
vi.mock('$lib/extensions/manager', () => ({ ensureExtensionService: vi.fn(async () => 'http://127.0.0.1:40001/index.json') }))

import { forgetSourceAddon, sourceAddon } from './source-catalogs'

const reply = (body: unknown) => ({ ok: true, status: 200, json: async () => body })
const manifest = (name: string) => ({ id: 'x', name, version: '1', resources: [], types: [], catalogs: [] })

describe('a source manifest read over a minute ago', () => {
  afterEach(() => {
    vi.useRealTimers()
    phttp.mockReset()
    forgetSourceAddon('example.source')
  })

  it('still answers at once while the fresh one is read, which then takes over', async () => {
    vi.useFakeTimers({ now: 0, toFake: ['Date'] })
    let name = 'first'
    let release = () => {}
    phttp.mockImplementation(async (url: string) => {
      if (url.endsWith('/index.json')) return reply({ catalog: '/stremio/manifest.json' })
      const current = name
      if (current === 'second') await new Promise<void>((resolve) => { release = resolve })
      return reply(manifest(current))
    })
    expect((await sourceAddon('example.source')).manifest.name).toBe('first')
    vi.setSystemTime(61_000)
    name = 'second'
    expect((await sourceAddon('example.source')).manifest.name).toBe('first')
    await vi.waitFor(() => expect(phttp).toHaveBeenCalledTimes(4))
    release()
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect((await sourceAddon('example.source')).manifest.name).toBe('second')
  })

  it('is dropped with a fresh read that fails, so the next one reads again', async () => {
    vi.useFakeTimers({ now: 0, toFake: ['Date'] })
    let fail = false
    phttp.mockImplementation(async (url: string) => {
      if (url.endsWith('/index.json')) return reply({ catalog: '/stremio/manifest.json' })
      if (fail) throw new Error('service restarted')
      return reply(manifest('first'))
    })
    await sourceAddon('example.source')
    vi.setSystemTime(61_000)
    fail = true
    await sourceAddon('example.source')
    await new Promise((resolve) => setTimeout(resolve, 20))
    await expect(sourceAddon('example.source')).rejects.toThrow('service restarted')
  })
})
