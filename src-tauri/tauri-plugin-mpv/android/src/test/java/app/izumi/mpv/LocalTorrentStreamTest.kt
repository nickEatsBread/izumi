package app.izumi.mpv

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class LocalTorrentStreamTest {
    @Test
    fun theInProcessTorrentServerIsALocalTorrentStream() {
        assertTrue(isLocalTorrentStream("http://127.0.0.1:51234/torrents/7/stream/3"))
    }

    @Test
    fun everythingElseIsAnOrdinaryStream() {
        listOf(
            "https://cdn.example.com/torrents/7/stream/3",
            "http://localhost:51234/torrents/7/stream/3",
            "http://127.0.0.1/torrents/7/stream/3",
            "http://127.0.0.1:port/torrents/7/stream/3",
            "http://127.0.0.1:51234/torrents/7/stream/",
            "http://127.0.0.1:51234/torrents/7/stream/3/extra",
            "http://127.0.0.1:51234/torrents/7/stream/3?download=1",
            "http://127.0.0.1:51234/playlist.m3u8",
            "/storage/emulated/0/Movies/episode.mkv",
            "",
        ).forEach { assertFalse(it, isLocalTorrentStream(it)) }
    }
}
