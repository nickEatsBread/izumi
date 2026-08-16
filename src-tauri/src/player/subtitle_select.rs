#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) struct SemanticTrack {
    pub(super) id: i64,
    pub(super) kind: String,
    pub(super) title: String,
    pub(super) lang: String,
    pub(super) selected: bool,
}

fn canonical_track_lang(value: &str) -> &str {
    match value.trim().to_ascii_lowercase().as_str() {
        "en" | "eng" | "english" => "eng",
        "ja" | "jpn" | "japanese" => "jpn",
        _ => "und",
    }
}

fn is_signs_only_title(title: &str) -> bool {
    let title = title.trim().to_ascii_lowercase();
    let bracketed_signs = [
        "[sign]", "[signs]", "(sign)", "(signs)", "{sign}", "{signs}",
    ]
    .iter()
    .any(|marker| title.contains(marker));
    let plain_signs = matches!(
        title.as_str(),
        "sign" | "signs" | "english sign" | "english signs" | "eng sign" | "eng signs"
    );
    title.contains("sign")
        && (title.contains("song")
            || title.contains("karaoke")
            || title.contains("signs only")
            || bracketed_signs
            || plain_signs)
}

fn is_full_dialogue_title(title: &str) -> bool {
    let title = title.to_ascii_lowercase();
    (title.contains("full")
        && (title.contains("subtitle") || title.contains(" subs") || title.ends_with("subs")))
        || title.contains("dialogue")
}

fn is_dialogue_candidate_title(title: &str) -> bool {
    let title = title.to_ascii_lowercase();
    !is_signs_only_title(&title)
        && !title.contains("commentary")
        && !title.contains("forced")
        && !title.contains("karaoke")
}

/// Anime muxes commonly tag tracks by the audio they accompany rather than by the text language:
/// `eng / Signs & Songs` plus `jpn / Full Subtitles`. mpv correctly follows the tags but therefore
/// chooses signs-only for Japanese audio. Prefer a real dialogue track when that exact layout is
/// present, while leaving ordinary multilingual files and English-dub playback untouched.
pub(super) fn preferred_full_subtitle_id(
    preferred_lang: &str,
    tracks: &[SemanticTrack],
) -> Option<i64> {
    let preferred_lang = preferred_lang
        .split([',', ' '])
        .find(|part| !part.is_empty())
        .map(canonical_track_lang)
        .unwrap_or("und");
    if preferred_lang != "eng" {
        return None;
    }

    let selected_subtitle = tracks
        .iter()
        .find(|track| track.kind == "sub" && track.selected)?;
    if canonical_track_lang(&selected_subtitle.lang) != preferred_lang
        || !is_signs_only_title(&selected_subtitle.title)
    {
        return None;
    }

    let dialogue_tracks = tracks
        .iter()
        .filter(|track| track.kind == "sub" && is_dialogue_candidate_title(&track.title))
        .collect::<Vec<_>>();
    // A correctly tagged English dialogue track always wins over signs-only.
    if let Some(track) = dialogue_tracks
        .iter()
        .filter(|track| canonical_track_lang(&track.lang) == preferred_lang)
        .find(|track| is_full_dialogue_title(&track.title))
        .or_else(|| {
            dialogue_tracks
                .iter()
                .find(|track| canonical_track_lang(&track.lang) == preferred_lang)
        })
    {
        return Some(track.id);
    }

    // The mislabeled-anime fallback is only safe when Japanese audio is actually selected. With
    // English audio, Signs & Songs is precisely the intended track and must remain selected.
    let audio_lang = tracks
        .iter()
        .find(|track| track.kind == "audio" && track.selected)
        .map(|track| canonical_track_lang(&track.lang))?;
    if audio_lang != "jpn" {
        return None;
    }
    dialogue_tracks
        .into_iter()
        .find(|track| {
            is_full_dialogue_title(&track.title)
                && matches!(canonical_track_lang(&track.lang), "jpn" | "und")
        })
        .map(|track| track.id)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn track(id: i64, kind: &str, title: &str, lang: &str, selected: bool) -> SemanticTrack {
        SemanticTrack {
            id,
            kind: kind.to_string(),
            title: title.to_string(),
            lang: lang.to_string(),
            selected,
        }
    }

    #[test]
    fn japanese_audio_uses_full_subtitles_instead_of_english_signs_only() {
        let tracks = vec![
            track(1, "audio", "Japanese", "jpn", true),
            track(2, "sub", "Signs & Songs (Shio-freeka)", "eng", true),
            track(3, "sub", "Full Subtitles (Shio-freeka)", "jpn", false),
            track(4, "sub", "Signs & Songs (Coalgirls)", "eng", false),
            track(5, "sub", "Full Subtitles (Coalgirls)", "jpn", false),
        ];
        assert_eq!(preferred_full_subtitle_id("eng", &tracks), Some(3));
    }

    #[test]
    fn english_audio_keeps_signs_and_songs() {
        let tracks = vec![
            track(1, "audio", "English", "eng", true),
            track(2, "sub", "Signs & Songs", "eng", true),
            track(3, "sub", "Full Subtitles", "jpn", false),
        ];
        assert_eq!(preferred_full_subtitle_id("eng", &tracks), None);
    }

    #[test]
    fn correctly_tagged_full_english_beats_signs_only() {
        let tracks = vec![
            track(1, "audio", "Japanese", "jpn", true),
            track(2, "sub", "Signs & Songs", "eng", true),
            track(3, "sub", "Full Subtitles", "eng", false),
        ];
        assert_eq!(preferred_full_subtitle_id("eng", &tracks), Some(3));
    }

    #[test]
    fn bracketed_signs_uses_plain_english_dialogue() {
        let tracks = vec![
            track(1, "audio", "Japanese", "jpn", true),
            track(2, "sub", "English [Signs]", "eng", true),
            track(3, "sub", "English", "eng", false),
        ];
        assert_eq!(preferred_full_subtitle_id("eng", &tracks), Some(3));
    }

    #[test]
    fn commentary_does_not_replace_signs_only() {
        let tracks = vec![
            track(1, "audio", "Japanese", "jpn", true),
            track(2, "sub", "English [Signs]", "eng", true),
            track(3, "sub", "English Commentary", "eng", false),
        ];
        assert_eq!(preferred_full_subtitle_id("eng", &tracks), None);
    }

    #[test]
    fn sign_language_is_not_mistaken_for_signs_only() {
        assert!(!is_signs_only_title("English Sign Language"));
    }
}
