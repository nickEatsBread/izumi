import { readable, type Readable } from 'svelte/store'

/** How the Settings rail draws its current section (spec §4; a theme's shell.rail.marker, §7.1). */
export type RailMarker = 'fill' | 'bar' | 'tile' | 'accent' | 'dot'

/** The Settings rail indicator style. Accent until themes choose it through shell.rail.marker. */
export const settingsRailMarker: Readable<RailMarker> = readable<RailMarker>('accent')
