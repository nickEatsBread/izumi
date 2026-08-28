import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const component = readFileSync(
  fileURLToPath(new URL('./RefreshButton.svelte', import.meta.url)),
  'utf8',
)

describe('RefreshButton', () => {
  it('acknowledges every stage of a refresh without allowing duplicate requests', () => {
    expect(component).toContain("type RefreshPhase = 'idle' | 'refreshing' | 'success' | 'error'")
    expect(component).toContain("phase === 'refreshing'")
    expect(component).toContain("settle(await onRefresh() === false ? 'error' : 'success')")
    expect(component).toContain("disabled={disabled || phase === 'refreshing'}")
    expect(component).toContain("class={phase === 'refreshing' ? 'animate-spin' : ''}")
  })

  it('briefly announces the outcome to assistive technology', () => {
    expect(component).toContain('role="status" aria-live="polite"')
    expect(component).toContain("setTimeout(() => (phase = 'idle')")
    expect(component).toContain('successLabel')
    expect(component).toContain('errorLabel')
  })
})
