const VIDEO_EXTENSIONS: [&str; 8] = ["mkv", "mp4", "webm", "avi", "m4v", "mov", "ts", "m2ts"];
const SUBTITLE_EXTENSIONS: [&str; 4] = ["ass", "ssa", "srt", "vtt"];

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct TorrentFile {
    pub(crate) index: usize,
    pub(crate) name: String,
    pub(crate) length: u64,
}

fn is_video(name: &str) -> bool {
    let ext = name.rsplit('.').next().unwrap_or_default();
    VIDEO_EXTENSIONS
        .iter()
        .any(|candidate| ext.eq_ignore_ascii_case(candidate))
}

fn is_subtitle(name: &str) -> bool {
    let ext = name.rsplit('.').next().unwrap_or_default();
    SUBTITLE_EXTENSIONS
        .iter()
        .any(|candidate| ext.eq_ignore_ascii_case(candidate))
}

fn normalized(name: &str) -> String {
    name.replace('\\', "/").trim().to_lowercase()
}

fn basename_stem(name: &str) -> String {
    let name = normalized(name);
    let basename = name.rsplit('/').next().unwrap_or(&name);
    basename
        .rsplit_once('.')
        .map(|(stem, _)| stem)
        .unwrap_or(basename)
        .to_string()
}

/// Find external subtitle files whose basename belongs to the selected video. Anime releases
/// commonly suffix a video's complete stem with a language/variant marker:
/// `Episode 01.mkv` -> `Episode 01.eng.ass`, including when the subtitles live in `ENG/` or
/// `Subs/`. Requiring a separator after the complete stem keeps episode 1 from matching episode 10.
pub(crate) fn select_subtitles(files: &[TorrentFile], video: &TorrentFile) -> Vec<TorrentFile> {
    let video_stem = basename_stem(&video.name);
    files
        .iter()
        .filter(|file| is_subtitle(&file.name))
        .filter(|file| {
            let subtitle_stem = basename_stem(&file.name);
            let Some(suffix) = subtitle_stem.strip_prefix(&video_stem) else {
                return false;
            };
            suffix.is_empty()
                || suffix
                    .chars()
                    .next()
                    .is_some_and(|c| matches!(c, '.' | '_' | '-' | ' ' | '[' | '('))
        })
        .cloned()
        .collect()
}

/// Best-effort ISO 639-2 language inference from directory and filename tokens. `und` is preferable
/// to guessing: mpv still lists the track and the filename remains available as its title.
pub(crate) fn subtitle_language(name: &str) -> &'static str {
    let normalized = normalized(name);
    let tokens = normalized.split(|c: char| !c.is_ascii_alphabetic());
    for token in tokens {
        let lang = match token {
            "en" | "eng" | "english" => "eng",
            "ja" | "jpn" | "japanese" => "jpn",
            "zh" | "chi" | "zho" | "chinese" => "chi",
            "ko" | "kor" | "korean" => "kor",
            "es" | "spa" | "spanish" => "spa",
            "fr" | "fre" | "fra" | "french" => "fre",
            "de" | "ger" | "deu" | "german" => "ger",
            "it" | "ita" | "italian" => "ita",
            "pt" | "por" | "portuguese" => "por",
            "ru" | "rus" | "russian" => "rus",
            "ar" | "ara" | "arabic" => "ara",
            "pl" | "pol" | "polish" => "pol",
            "tr" | "tur" | "turkish" => "tur",
            _ => continue,
        };
        return lang;
    }
    "und"
}

pub(crate) fn select_file(files: &[TorrentFile], preferred: Option<&str>) -> Option<TorrentFile> {
    if let Some(preferred) = preferred.map(normalized).filter(|name| !name.is_empty()) {
        let preferred_basename = preferred.rsplit('/').next().unwrap_or(&preferred);
        if let Some(found) = files.iter().find(|file| {
            let name = normalized(&file.name);
            let basename = name.rsplit('/').next().unwrap_or(&name);
            name == preferred
                || name.ends_with(&format!("/{preferred}"))
                || basename == preferred_basename
        }) {
            return Some(found.clone());
        }
    }

    files
        .iter()
        .filter(|file| is_video(&file.name))
        .max_by_key(|file| file.length)
        .cloned()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn file(index: usize, name: &str, length: u64) -> TorrentFile {
        TorrentFile {
            index,
            name: name.into(),
            length,
        }
    }

    #[test]
    fn prefers_the_requested_episode_from_a_pack() {
        let files = vec![
            file(0, "Season/Episode 01.mkv", 900),
            file(1, "Season/Episode 02.mkv", 800),
            file(2, "cover.jpg", 2_000),
        ];
        assert_eq!(
            select_file(&files, Some("Episode 02.mkv")).unwrap().index,
            1
        );
    }

    #[test]
    fn falls_back_to_the_largest_video_not_the_largest_attachment() {
        let files = vec![
            file(0, "sample.mp4", 100),
            file(1, "episode.mkv", 1_000),
            file(2, "archive.bin", 5_000),
        ];
        assert_eq!(select_file(&files, None).unwrap().index, 1);
    }

    #[test]
    fn selects_only_sidecars_for_the_chosen_episode() {
        let files = vec![
            file(0, "ENG/Show_01_[AAAA].eng_HH.ass", 10),
            file(1, "CHI/Show_01_[AAAA].chi.sub.ass", 11),
            file(2, "CHI/Show_01_[AAAA].chi.sub_karaoke.ass", 12),
            file(3, "ENG/Show_02_[BBBB].eng_HH.ass", 13),
            file(4, "Show_01_[AAAA].mkv", 1_000),
            file(5, "Show_02_[BBBB].mkv", 1_100),
        ];
        let selected = select_subtitles(&files, &files[4]);
        assert_eq!(
            selected.iter().map(|file| file.index).collect::<Vec<_>>(),
            vec![0, 1, 2]
        );
    }

    #[test]
    fn does_not_confuse_episode_one_with_episode_ten() {
        let files = vec![
            file(0, "Show 01.mkv", 1_000),
            file(1, "Show 01.eng.ass", 10),
            file(2, "Show 010.eng.ass", 10),
        ];
        assert_eq!(
            select_subtitles(&files, &files[0])
                .iter()
                .map(|file| file.index)
                .collect::<Vec<_>>(),
            vec![1]
        );
    }

    #[test]
    fn infers_language_from_folder_or_filename_tokens() {
        assert_eq!(subtitle_language("ENG/Show_01.ass"), "eng");
        assert_eq!(subtitle_language("Subs/Show_01.chi_Maho.ass"), "chi");
        assert_eq!(subtitle_language("Subs/Show_01.ass"), "und");
    }
}
