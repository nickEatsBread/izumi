import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

// Settings text follows the rem scale (14.5 px root on phones, 18 px on TV); fixed 10 and 11 px
// classes ignore it (spec §3.3, §6).

const ROOT = fileURLToPath(new URL('../../../../', import.meta.url))
const DIRS = ['src/routes/app/settings', 'src/lib/components/settings']

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return sourceFiles(path)
    return /\.(svelte|ts)$/.test(name) && !name.endsWith('.test.ts') ? [path] : []
  })
}

describe('settings text sizes', () => {
  it('never uses fixed 10 or 11 px text', () => {
    const offenders = DIRS.flatMap((dir) => sourceFiles(join(ROOT, dir)))
      .filter((file) => /text-\[1[01]px\]/.test(readFileSync(file, 'utf8')))
      .map((file) => relative(ROOT, file).split('\\').join('/'))
    expect(offenders).toEqual([])
  })
})
