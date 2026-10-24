import { persisted } from 'svelte-persisted-store'

/** Which interface izumi shows: the catalog UI, or one search box over the user's own release
 *  sources. Device-level like the catalog choice, not per profile. */
export type InterfaceMode = 'catalogs' | 'search'
export const interfaceMode = persisted<InterfaceMode>('interface-mode', 'catalogs')
