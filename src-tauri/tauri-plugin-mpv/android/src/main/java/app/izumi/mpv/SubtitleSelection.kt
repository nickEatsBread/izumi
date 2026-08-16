package app.izumi.mpv

internal data class SemanticTrack(
    val id: String,
    val kind: String,
    val title: String,
    val lang: String,
    val selected: Boolean,
)

internal fun normalizedTrackLanguage(raw: String?): String = when (raw?.trim()?.lowercase()) {
    "en", "eng", "english" -> "eng"
    "ja", "jpn", "japanese" -> "jpn"
    "zh", "chi", "zho", "chinese" -> "chi"
    "ko", "kor", "korean" -> "kor"
    "es", "spa", "spanish" -> "spa"
    "fr", "fre", "fra", "french" -> "fre"
    "de", "ger", "deu", "german" -> "ger"
    "it", "ita", "italian" -> "ita"
    "pt", "por", "portuguese" -> "por"
    "ru", "rus", "russian" -> "rus"
    "ar", "ara", "arabic" -> "ara"
    "pl", "pol", "polish" -> "pol"
    "tr", "tur", "turkish" -> "tur"
    else -> raw?.trim()?.lowercase().orEmpty()
}

private fun isSignsOnlyTitle(raw: String): Boolean {
    val title = raw.trim().lowercase()
    val bracketedSigns = listOf("[sign]", "[signs]", "(sign)", "(signs)", "{sign}", "{signs}")
        .any(title::contains)
    val plainSigns = title in setOf(
        "sign", "signs", "english sign", "english signs", "eng sign", "eng signs",
    )
    return "sign" in title && (
        "song" in title || "karaoke" in title || "signs only" in title || bracketedSigns || plainSigns
    )
}

private fun isFullDialogueTitle(raw: String): Boolean {
    val title = raw.lowercase()
    return ("full" in title && ("subtitle" in title || " subs" in title || title.endsWith("subs"))) ||
        "dialogue" in title
}

private fun isDialogueCandidate(raw: String): Boolean {
    val title = raw.lowercase()
    return !isSignsOnlyTitle(title) && "commentary" !in title && "forced" !in title && "karaoke" !in title
}

/** Choose the user's language without allowing a signs-only track to beat full dialogue. Some
 * anime muxes tag full English dialogue as Japanese, so that fallback is only allowed while the
 * selected audio is Japanese; a correctly tagged English dialogue track is always safe. */
internal fun preferredSubtitleId(preferredRaw: String?, tracks: List<SemanticTrack>): String? {
    val preferred = normalizedTrackLanguage(preferredRaw)
    if (preferred.isEmpty() || preferred == "none") return null

    val subtitles = tracks.filter { it.kind == "sub" }
    val selected = subtitles.firstOrNull { it.selected }
    val preferredTracks = subtitles.filter { normalizedTrackLanguage(it.lang) == preferred }

    // Preserve mpv's valid preferred-language choice. The correction is only needed when mpv
    // selected signs-only, or when no preferred-language track was selected at all.
    if (selected != null && normalizedTrackLanguage(selected.lang) == preferred && !isSignsOnlyTitle(selected.title)) {
        return selected.id
    }
    if (preferred != "eng") return preferredTracks.firstOrNull()?.id

    val dialogue = preferredTracks.filter { isDialogueCandidate(it.title) }
    dialogue.firstOrNull { isFullDialogueTitle(it.title) }?.let { return it.id }
    dialogue.firstOrNull()?.let { return it.id }

    val signs = selected?.takeIf {
        normalizedTrackLanguage(it.lang) == preferred && isSignsOnlyTitle(it.title)
    } ?: preferredTracks.firstOrNull()
    if (signs == null) return null

    val audioIsJapanese = tracks.any {
        it.kind == "audio" && it.selected && normalizedTrackLanguage(it.lang) == "jpn"
    }
    if (!audioIsJapanese) return signs.id
    return subtitles.firstOrNull {
        isFullDialogueTitle(it.title) && isDialogueCandidate(it.title) &&
            normalizedTrackLanguage(it.lang) in setOf("jpn", "")
    }?.id ?: signs.id
}
