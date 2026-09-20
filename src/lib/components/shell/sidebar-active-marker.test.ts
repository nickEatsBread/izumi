import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const sidebar = readFileSync(fileURLToPath(new URL('./Sidebar.svelte', import.meta.url)), 'utf8')

describe('sidebar active state', () => {
  it('uses only the quiet row highlight without an accent line', () => {
    expect(sidebar).not.toContain('ACTIVE_MARKER_HOLD_MS')
    expect(sidebar).not.toContain('activeMarkerVisible')
    expect(sidebar).not.toContain('rounded-full bg-theme transition-opacity')
    expect(sidebar).toContain("on ? 'bg-foreground/[0.06] text-foreground' : 'text-muted-foreground'")
  })

  it('keeps the active destination exposed to assistive technology', () => {
    expect(sidebar).toContain("aria-current={on ? 'page' : undefined}")
    expect(sidebar).toContain("aria-current={active('/app/settings') ? 'page' : undefined}")
  })

  it('renders top chrome as compact icon buttons instead of stretched rail rows', () => {
    expect(sidebar).toContain("grid size-10 shrink-0 place-items-center rounded-lg")
    expect(sidebar).toContain('<span class="sr-only">{it.label}</span>')
    expect(sidebar).toContain("top ? 'inset-x-0 top-0 h-[4.75rem] w-full flex-row items-center border-b border-border/50 bg-background px-3 pt-8'")
    expect(sidebar).not.toContain('bg-background/90 backdrop-blur')
    expect(sidebar).toContain("top ? destClass(false)")
  })
})
