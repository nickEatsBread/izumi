import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const source = readFileSync(fileURLToPath(new URL('./ListEditor.svelte', import.meta.url)), 'utf8')

describe('mobile list editor layout', () => {
  it('uses the dynamic viewport and keeps fields in a separate scrolling region', () => {
    expect(source).toContain('h-[100dvh]')
    expect(source).toContain('min-h-0 flex-1 overflow-y-auto')
  })

  it('keeps the save actions outside the scroll area and above Android system UI', () => {
    expect(source).toContain('flex shrink-0 items-center gap-2 border-t')
    expect(source).toContain('env(safe-area-inset-bottom)')
  })
})
