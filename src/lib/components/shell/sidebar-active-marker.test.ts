import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const sidebar = readFileSync(fileURLToPath(new URL('./Sidebar.svelte', import.meta.url)), 'utf8')

describe('sidebar active marker', () => {
  it('fades the strong marker after navigation while retaining the quiet active row', () => {
    expect(sidebar).toContain('const ACTIVE_MARKER_HOLD_MS = 3_000')
    expect(sidebar).toContain('setTimeout(() => (activeMarkerVisible = false), ACTIVE_MARKER_HOLD_MS)')
    expect(sidebar).toContain("activeMarkerVisible || focused ? 'opacity-100' : 'opacity-0'")
    expect(sidebar).toContain("on ? 'bg-foreground/[0.06] text-foreground' : 'text-muted-foreground'")
  })

  it('keeps the active destination exposed to assistive technology', () => {
    expect(sidebar).toContain("aria-current={on ? 'page' : undefined}")
    expect(sidebar).toContain("aria-current={active('/app/settings') ? 'page' : undefined}")
  })
})
