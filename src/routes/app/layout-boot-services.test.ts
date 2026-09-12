import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

// The app shell's boot chunk used to carry every background service it starts. They are loaded
// behind the boot-work queue now; this pins the split so a future edit cannot quietly re-import one.

const layout = readFileSync(fileURLToPath(new URL('./+layout.svelte', import.meta.url)), 'utf8')
const sourceBridge = readFileSync(
  fileURLToPath(new URL('../../lib/companion/source-bridge.ts', import.meta.url)),
  'utf8',
)
const companionStores = readFileSync(
  fileURLToPath(new URL('../../lib/companion/stores.ts', import.meta.url)),
  'utf8',
)

const DEFERRED = [
  '$lib/trackers/queue',
  '$lib/player/auto-incognito',
  '$lib/sync/client',
  '$lib/stremio/account-sync',
  '$lib/companion/client',
  '$lib/companion/source-bridge',
  '$lib/companion/snapshot',
  '$lib/companion/playback',
  '$lib/downloads/rules',
  '$lib/watch-together/client',
  '$lib/notifications/airing',
  '$lib/updater',
]

describe('app layout boot services', () => {
  it('loads background services behind the boot queue instead of the boot chunk', () => {
    for (const module of DEFERRED) {
      // A static import has a `from`; the dynamic `import('…')` inside the boot task does not.
      expect(layout, module).not.toMatch(new RegExp(`^[ \\t]*import\\s+(?!type\\b)[^\\n]*from\\s+['"]${module.replace(/[$/]/g, '\\$&')}['"]`, 'm'))
      expect(layout, module).toContain(`import('${module}')`)
    }
    expect(layout).toContain("scheduleBootWork('services'")
    // Everything that returns a stop function is registered for teardown, and a teardown that
    // beats the imports stops whatever managed to start.
    expect(layout).toContain('servicesStopped = true')
    expect(layout).toContain('if (servicesStopped) for (const stop of serviceStops.splice(0)) stop()')
  })

  it('reads the companion picker state from a dependency-free module', () => {
    expect(layout).toContain("import { companionResolveSession, companionStreamPicker } from '$lib/companion/stores'")
    // Only `svelte/store` may be a runtime import there; everything else must be `import type`.
    expect(companionStores).not.toMatch(/^import (?!type\b)[^\n]*from ['"](?!svelte\/store['"])/m)
    expect(sourceBridge).toContain("from './stores'")
    expect(sourceBridge).toContain('export { companionResolveSession, companionStreamPicker }')
  })

  it('mounts first-run setup lazily and only while onboarding is incomplete', () => {
    expect(layout).not.toContain("import FirstRunSetup from")
    expect(layout).toContain("const loadFirstRunSetup = () => import('$lib/components/onboarding/FirstRunSetup.svelte')")
    expect(layout).toContain("{#if !$onboardingComplete && page.url.pathname !== '/app/companion-restore'}<Lazy load={loadFirstRunSetup} />{/if}")
  })
})
