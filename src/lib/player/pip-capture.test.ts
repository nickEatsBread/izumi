import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const session = readFileSync('src/lib/player/session.ts', 'utf8')
const surface = readFileSync('src/lib/components/player/DrmSurface.svelte', 'utf8')
const contract = readFileSync('src/lib/player/drm.ts', 'utf8')

describe('capture-safe picture in picture transitions', () => {
  it('waits for screenshots and drains active GIF capture before viewport changes', () => {
    const prepare = surface.slice(
      surface.indexOf('async function prepareForViewportChange'),
      surface.indexOf('const thumbCache'),
    )
    expect(contract).toContain('prepareForViewportChange?: () => Promise<boolean>')
    expect(prepare).toContain('if (screenshotTask) await screenshotTask.catch(() => {})')
    expect(prepare).toContain('if (gifBoot) await gifBoot.catch(() => {})')
    expect(prepare).toContain('await gifStop()')
  })

  it('serializes rapid PiP toggles and clears a GIF indicator after handing off encoding', () => {
    expect(session).toContain('let pipTransition: Promise<void> = Promise.resolve()')
    expect(session).toContain('pipTransition.catch(() => {}).then(operation)')
    expect(session).toContain('await engine.prepareForViewportChange()')
    expect(session).toContain("playerNotice.set('Saving GIF in background…')")
    expect(session).toContain('return queuePipTransition(async () => {')
  })
})
