import type { Stream } from './addon'

export interface DirectMetadataPrefetchRequest {
  magnet: string
  expectedInfoHash: string
  timeoutMs?: number
}

/** Build the native metadata request without exposing a URL or hash to diagnostics. */
export function directMetadataPrefetchRequest(
  stream: Stream,
): DirectMetadataPrefetchRequest | undefined {
  if (stream.url || !stream.infoHash) return undefined
  if (stream.__torrentUrl) {
    return {
      magnet: stream.__torrentUrl,
      expectedInfoHash: stream.infoHash,
      // A metadata URL should be quick; fall back to the magnet if its host is unavailable.
      timeoutMs: 5_000,
    }
  }
  return {
    magnet: stream.__magnet ?? `magnet:?xt=urn:btih:${stream.infoHash}`,
    expectedInfoHash: stream.infoHash,
  }
}

export const directMetadataPrefetchKey = (request: DirectMetadataPrefetchRequest) =>
  `${request.expectedInfoHash.toLowerCase()}:${request.timeoutMs ? 'torrent' : 'magnet'}`
