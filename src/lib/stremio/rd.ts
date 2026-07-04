// Deprecated shim: Real-Debrid moved into the multi-provider debrid abstraction.
// Use `$lib/stremio/debrid` (the resolveHash dispatcher) + `debrid/http` helpers.
export { resolveHash } from './debrid'
export { magnetOf, pickLargestVideo } from './debrid/http'
