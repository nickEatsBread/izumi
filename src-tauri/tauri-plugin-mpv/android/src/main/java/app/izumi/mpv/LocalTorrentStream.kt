package app.izumi.mpv

/**
 * Whether [url] is the in-process torrent stream server
 * (`http://127.0.0.1:{port}/torrents/{id}/stream/{file}`, built by direct_torrent_stream.rs).
 * Its reads wait until the swarm delivers the next piece, so a long wait there is buffering, not a
 * dead connection.
 */
internal fun isLocalTorrentStream(url: String): Boolean {
    if (!url.startsWith("http://127.0.0.1:")) return false
    val parts = url.removePrefix("http://127.0.0.1:").split('/')
    fun number(part: String) = part.isNotEmpty() && part.all { it in '0'..'9' }
    return parts.size == 5 &&
        number(parts[0]) &&
        parts[1] == "torrents" &&
        number(parts[2]) &&
        parts[3] == "stream" &&
        number(parts[4])
}
