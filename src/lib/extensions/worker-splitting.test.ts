import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const worker = readFileSync(fileURLToPath(new URL('./worker.ts', import.meta.url)), 'utf8')
const config = readFileSync(fileURLToPath(new URL('../../../vite.config.js', import.meta.url)), 'utf8')

describe('extension worker runtime splitting', () => {
  it('keeps heavyweight format runtimes out of the base worker', () => {
    expect(worker).not.toMatch(/^import .*seanime-shim/m)
    expect(worker).not.toMatch(/^import .*miru-shim/m)
    expect(worker).not.toMatch(/^import .*extractors\/registry/m)
    expect(worker).toContain("await import('./seanime-shim')")
    expect(worker).toContain("await import('./miru-shim')")
  })

  it('emits a module worker so dynamic chunks remain loadable', () => {
    expect(config).toMatch(/worker:\s*\{\s*format:.*\("es"\)/)
  })
})
