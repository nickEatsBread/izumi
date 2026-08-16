package app.izumi.mpv

import org.junit.Assert.assertEquals
import org.junit.Test

class SubtitleSelectionTest {
    private fun track(
        id: String,
        kind: String,
        title: String,
        lang: String,
        selected: Boolean = false,
    ) = SemanticTrack(id, kind, title, lang, selected)

    @Test
    fun bracketedSignsDoesNotBeatPlainEnglish() {
        val tracks = listOf(
            track("1", "audio", "Japanese", "jpn", true),
            track("2", "sub", "English [Signs]", "eng", true),
            track("3", "sub", "English", "eng"),
        )

        assertEquals("3", preferredSubtitleId("eng", tracks))
    }

    @Test
    fun existingNormalEnglishSelectionIsPreserved() {
        val tracks = listOf(
            track("1", "audio", "Japanese", "jpn", true),
            track("2", "sub", "English [Signs]", "eng"),
            track("3", "sub", "English", "eng", true),
        )

        assertEquals("3", preferredSubtitleId("eng", tracks))
    }

    @Test
    fun commentaryDoesNotReplaceSignsOnly() {
        val tracks = listOf(
            track("1", "audio", "Japanese", "jpn", true),
            track("2", "sub", "English [Signs]", "eng", true),
            track("3", "sub", "English Commentary", "eng"),
        )

        assertEquals("2", preferredSubtitleId("eng", tracks))
    }

    @Test
    fun japaneseAudioCanUseMislabeledFullDialogue() {
        val tracks = listOf(
            track("1", "audio", "Japanese", "jpn", true),
            track("2", "sub", "Signs & Songs", "eng", true),
            track("3", "sub", "Full Subtitles", "jpn"),
        )

        assertEquals("3", preferredSubtitleId("eng", tracks))
    }
}
