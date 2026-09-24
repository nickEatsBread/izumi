import { writable } from 'svelte/store'

// Shared, dependency-free view of the Aniyomi (JVM) runtime's lifecycle. It lives apart from
// manager.ts so the resolver, the picker and the manager can all read it without the resolver
// having to import the whole extension runtime (several resolver tests mock that module with a
// handful of exports, and the runtime state must not become one more thing they have to stub).

/** Where the runtime is between a cold process and an answered enumeration. The picker reads it
 *  to label a long first wait honestly instead of showing a generic spinner, and the resolver reads
 *  it to size that wait: a cold Java start is not a slow provider. */
export type JvmRuntimeState = 'idle' | 'starting' | 'ready' | 'failed'
export const jvmRuntimeState = writable<JvmRuntimeState>('idle')

export const JVM_RUNTIME_STARTING_MESSAGE = 'The extension runtime is still starting. The first play after installing a package takes longer — try again in a moment.'
export const JVM_RUNTIME_FAILED_MESSAGE = 'The extension runtime could not start. Check the installed package under Settings → Extensions.'

/** Play-path deadline for the runtime's source enumeration. A cold desktop start is Java discovery
 *  + host spawn + loadExtensions for every package (and on a fresh install a runtime download), and
 *  the 15s browse deadline regularly lost that race: the first play after installing reported "no
 *  sources", then the SECOND play found the warm cache and worked in seconds. */
export const JVM_SOURCES_PLAY_DEADLINE_MS = 75_000

/** Whether the next resolve would have to wait for a cold runtime. The manager registers the real
 *  probe (installed + enabled JVM sources whose enumeration has not answered); until it does, or
 *  when it is absent, a cold start is never assumed and the resolver keeps its ordinary budget. */
let coldStartProbe: () => Promise<boolean> = async () => false
export function registerJvmColdStartProbe(probe: () => Promise<boolean>): void {
  coldStartProbe = probe
}
export function jvmRuntimeColdStartPending(): Promise<boolean> {
  return coldStartProbe().catch(() => false)
}
