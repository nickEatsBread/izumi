// parse-torrent ships no types. Only the default export is used: it reads a magnet URI, an infohash
// or a .torrent file's bytes and resolves to the torrent's identity.
declare module 'parse-torrent' {
  export default function parseTorrent(torrentId: string | Uint8Array): Promise<{ infoHash?: string; name?: string }>
}
