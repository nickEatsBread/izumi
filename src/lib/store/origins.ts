import { persisted } from 'svelte-persisted-store'

/** Which store each installed package came from (package id → store URL). An installed package only
 *  ever updates from this store — a same-id package elsewhere is a takeover, not an update. */
export const packageOrigins = persisted<Record<string, string>>('package-origins-v1', {})

export function recordPackageOrigin(id: string, storeUrl: string): void {
  packageOrigins.update((origins) => ({ ...origins, [id]: storeUrl }))
}

export function forgetPackageOrigin(id: string): void {
  packageOrigins.update((origins) => {
    const next = { ...origins }
    delete next[id]
    return next
  })
}
