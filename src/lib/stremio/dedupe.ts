import type { Stream } from './parse'
import { normalizeCandidates } from './candidate-model'

// Collapse only exact duplicate ROUTES inside one OFFER. Copies from different addons/extensions
// are intentionally retained as alternate offers on one release; distinct URLs/magnets/fileIdx
// values from one source are alternate routes. The opaque candidate ids also give Svelte unique,
// credential-safe keys when two rows share an infoHash or URL.
export function dedupeStreams(streams: Stream[]): Stream[] {
  return normalizeCandidates(streams)
}
