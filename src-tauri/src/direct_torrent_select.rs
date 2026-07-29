use regex::Regex;
use std::sync::OnceLock;

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

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
struct FileEpisode {
    season: Option<u32>,
    episode: Option<u32>,
}

fn rx(slot: &'static OnceLock<Regex>, pattern: &str) -> &'static Regex {
    slot.get_or_init(|| Regex::new(pattern).expect("direct torrent filename regex is valid"))
}

fn parsed_file_episode(name: &str) -> FileEpisode {
    static BRACKETS: OnceLock<Regex> = OnceLock::new();
    static SXE: OnceLock<Regex> = OnceLock::new();
    static CROSS: OnceLock<Regex> = OnceLock::new();
    static SEASON: OnceLock<Regex> = OnceLock::new();
    static EXPLICIT: OnceLock<Regex> = OnceLock::new();
    static HYPHEN: OnceLock<Regex> = OnceLock::new();
    static NOISE: OnceLock<Regex> = OnceLock::new();

    let normalized_name = normalized(name);
    let mut value = normalized_name
        .rsplit_once('.')
        .map(|(stem, _)| stem.to_string())
        .unwrap_or(normalized_name);
    value = rx(&BRACKETS, r"\[[^\]]*\]")
        .replace_all(&value, " ")
        .into_owned();

    if let Some(found) = rx(
        &SXE,
        r"(?i)(?:^|[^a-z0-9])s(\d{1,2})\s*e(\d{1,4})(?:v\d+)?(?:[^0-9]|$)",
    )
    .captures(&value)
    {
        return FileEpisode {
            season: found.get(1).and_then(|item| item.as_str().parse().ok()),
            episode: found.get(2).and_then(|item| item.as_str().parse().ok()),
        };
    }

    if let Some(found) =
        rx(&CROSS, r"(?i)(?:^|[^0-9])(\d{1,2})x(\d{1,3})(?:[^0-9]|$)").captures(&value)
    {
        return FileEpisode {
            season: found.get(1).and_then(|item| item.as_str().parse().ok()),
            episode: found.get(2).and_then(|item| item.as_str().parse().ok()),
        };
    }

    let mut parsed = FileEpisode::default();
    if let Some(found) = rx(
        &SEASON,
        r"(?i)(?:^|[^a-z0-9])(?:s|season\s*)(\d{1,2})(?:[^0-9]|$)",
    )
    .captures(&value)
    {
        parsed.season = found.get(1).and_then(|item| item.as_str().parse().ok());
        value = rx(
            &SEASON,
            r"(?i)(?:^|[^a-z0-9])(?:s|season\s*)(\d{1,2})(?:[^0-9]|$)",
        )
        .replace(&value, " ")
        .into_owned();
    }

    value = rx(
        &NOISE,
        r"(?i)\b(?:2160|1440|1080|720|480|360|240)p?\b|\b(?:19|20)\d{2}\b|\b(?:x|h)\.?26[45]\b|\bav1\b|\b(?:8|10)-?bit\b|\b\d\.\d\b",
    )
    .replace_all(&value, " ")
    .into_owned();

    if let Some(found) = rx(
        &EXPLICIT,
        r"(?i)(?:^|[^a-z0-9])(?:episode|ep\.?|e|#)\s*(\d{1,4})(?:v\d+)?(?:[^0-9]|$)",
    )
    .captures(&value)
    {
        parsed.episode = found.get(1).and_then(|item| item.as_str().parse().ok());
        return parsed;
    }

    if let Some(found) =
        rx(&HYPHEN, r"(?:^|\s)[-–]\s*(\d{1,4})(?:v\d+)?(?:[^0-9]|$)").captures(&value)
    {
        let number = found.get(1);
        let fractional = number.is_some_and(|number| {
            let tail = &value[number.end()..];
            tail.starts_with('.')
                && tail[1..]
                    .chars()
                    .next()
                    .is_some_and(|character| character.is_ascii_digit())
        });
        if !fractional {
            parsed.episode = number.and_then(|item| item.as_str().parse().ok());
            return parsed;
        }
    }

    let numbers = value
        .split(|character: char| !character.is_ascii_digit())
        .filter(|item| !item.is_empty())
        .filter_map(|item| item.parse::<u32>().ok())
        .collect::<Vec<_>>();
    if numbers.len() == 1 {
        parsed.episode = numbers.first().copied();
    }
    parsed
}

fn is_extra(name: &str) -> bool {
    static EXTRA: OnceLock<Regex> = OnceLock::new();
    rx(
        &EXTRA,
        r"(?i)\b(?:sample|preview|trailer|teaser|promo|menu|ncop\d*|nced\d*|creditless|textless|clean\s*(?:op|ed|opening|ending))\b",
    )
    .is_match(name)
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
    // A single-video torrent names its sidecars freely (`Subs/eng.ass`), so a stem match would
    // drop them. With only one video there is nothing to mis-assign them to.
    if files.iter().filter(|file| is_video(&file.name)).count() == 1 {
        return files
            .iter()
            .filter(|file| is_subtitle(&file.name))
            .cloned()
            .collect();
    }
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

pub(crate) fn select_file(
    files: &[TorrentFile],
    preferred: Option<&str>,
    episode: Option<u32>,
    absolute_episode: Option<u32>,
    season: Option<u32>,
) -> Option<TorrentFile> {
    if let Some(preferred) = preferred.map(normalized).filter(|name| !name.is_empty()) {
        let preferred_basename = preferred.rsplit('/').next().unwrap_or(&preferred);
        if let Some(found) = files.iter().find(|file| {
            if !is_video(&file.name) {
                return false;
            }
            let name = normalized(&file.name);
            let basename = name.rsplit('/').next().unwrap_or(&name);
            name == preferred
                || name.ends_with(&format!("/{preferred}"))
                || basename == preferred_basename
        }) {
            return Some(found.clone());
        }
    }

    let candidates = files
        .iter()
        .filter(|file| is_video(&file.name) && !is_extra(&file.name))
        .collect::<Vec<_>>();

    if episode.is_some() || absolute_episode.is_some() {
        let mut matching = candidates
            .iter()
            .filter_map(|file| {
                let parsed = parsed_file_episode(&file.name);
                let parsed_episode = parsed.episode?;
                let number_matches =
                    episode == Some(parsed_episode) || absolute_episode == Some(parsed_episode);
                let season_matches = match (season, parsed.season) {
                    (Some(wanted), Some(found)) => wanted == found,
                    _ => true,
                };
                (number_matches && season_matches).then_some((*file, parsed))
            })
            .collect::<Vec<_>>();

        matching.sort_by_key(|(file, parsed)| {
            (
                usize::from(season.is_some() && parsed.season == season),
                usize::from(parsed.season.is_some()),
                file.length,
            )
        });
        if let Some((file, _)) = matching.last() {
            return Some((*file).clone());
        }

        // A single video is unambiguous even when its release name has no episode token. For a
        // pack, failing closed is safer than silently playing the largest (and often wrong) file.
        return (candidates.len() == 1).then(|| candidates[0].clone());
    }

    candidates
        .into_iter()
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
            select_file(&files, Some("Episode 02.mkv"), Some(2), None, None)
                .unwrap()
                .index,
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
        assert_eq!(
            select_file(&files, None, None, None, None).unwrap().index,
            1
        );
    }

    #[test]
    fn season_match_beats_a_larger_tanya_mini_episode() {
        let files = vec![
            file(0, "[Group] Youjo Senki S02E01.mkv", 900),
            file(1, "[CenturyZeta] Youjo Shenki 2 - 01 (1080p).mkv", 1_000),
        ];
        assert_eq!(
            select_file(&files, None, Some(1), Some(15), Some(2))
                .unwrap()
                .index,
            0
        );
    }

    #[test]
    fn selects_an_absolute_numbered_episode() {
        let files = vec![
            file(0, "Youjo Senki - 14.mkv", 900),
            file(1, "Youjo Senki - 15.mkv", 850),
            file(2, "Youjo Senki - 16.mkv", 950),
        ];
        assert_eq!(
            select_file(&files, None, Some(1), Some(15), Some(2))
                .unwrap()
                .index,
            1
        );
    }

    #[test]
    fn rejects_an_ambiguous_pack_instead_of_playing_the_largest_file() {
        let files = vec![
            file(0, "Show - 01.mkv", 900),
            file(1, "Show - 02.mkv", 1_000),
        ];
        assert!(select_file(&files, None, Some(3), None, Some(1)).is_none());
    }

    #[test]
    fn accepts_a_single_video_without_an_episode_token() {
        let files = vec![file(0, "Show [WEB 1080p].mkv", 900)];
        assert_eq!(
            select_file(&files, None, Some(3), None, Some(1))
                .unwrap()
                .index,
            0
        );
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
            file(3, "Show 010.mkv", 1_000),
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

    #[derive(serde::Deserialize)]
    struct FixtureCase {
        name: String,
        files: Vec<String>,
        video: usize,
        expected: Vec<usize>,
    }

    #[derive(serde::Deserialize)]
    struct Fixture {
        cases: Vec<FixtureCase>,
    }

    /// The TypeScript twin in src/lib/stremio/debrid/sidecar-subs.ts runs this exact fixture. If
    /// the two matchers ever disagree, debrid and direct playback would show different subtitle
    /// tracks for the same torrent — this test makes that a build failure instead.
    #[test]
    fn matches_the_shared_sidecar_fixture() {
        let raw = include_str!("../../src/lib/stremio/debrid/__fixtures__/sidecar-cases.json");
        let fixture: Fixture = serde_json::from_str(raw).expect("fixture parses");
        for case in fixture.cases {
            let files = case
                .files
                .iter()
                .enumerate()
                .map(|(index, name)| file(index, name, 100))
                .collect::<Vec<_>>();
            let got = select_subtitles(&files, &files[case.video])
                .iter()
                .map(|f| f.index)
                .collect::<Vec<_>>();
            assert_eq!(got, case.expected, "case: {}", case.name);
        }
    }
}
