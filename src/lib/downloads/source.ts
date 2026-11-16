import { describe, type Stream } from '$lib/stremio/parse'
import { candidateIds } from '$lib/stremio/candidate-model'
import type { ContinueHint } from '$lib/stremio/play'

// The stream a download saves. Kept on the item so a resume, a retry or a restart fetches the same
// file again instead of whatever ranks best that day: the HTTP engine appends to the partial file
// it already has, so a different file there would corrupt it.

/** What a download keeps of the stream it saves: the stream minus the resolver's bookkeeping. */
export function savedSource(stream: Stream): Stream {
  const { __evidence: _evidence, __candidate: _candidate, ...source } = stream
  return source
}

/** The release `stream` belongs to, for the other episodes of a download to follow. */
export const releaseOf = (stream: Stream): ContinueHint => ({
  bingeGroup: stream.behaviorHints?.bingeGroup,
  infoHash: stream.infoHash,
  group: describe(stream).group,
  originId: stream.__origin?.id,
  online: !!stream.__stream,
  audio: stream.__audio,
})

/** The playing stream when a download can save it: a torrent or a remote link, not a saved file. */
export const savableStream = (stream: Stream | null | undefined): Stream | undefined =>
  stream && (stream.infoHash || /^https?:\/\//i.test(stream.url ?? '')) ? stream : undefined

/** `source` again in a fresh resolve: the same file over the same route, else the same release
 *  from the same source (its link is tokenized anew on every listing), the same row label first. */
export function findSource(streams: Stream[], source: Stream): Stream | undefined {
  const want = candidateIds(source)
  const route = streams.find((stream) => candidateIds(stream).routeId === want.routeId)
  if (route) return route
  const offer = streams.filter((stream) => candidateIds(stream).offerId === want.offerId)
  return offer.find((stream) => stream.name === source.name && stream.title === source.title) ?? offer[0]
}
