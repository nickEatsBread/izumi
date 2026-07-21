const VIDEO_EXTENSIONS: [&str; 8] = ["mkv", "mp4", "webm", "avi", "m4v", "mov", "ts", "m2ts"];

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

fn normalized(name: &str) -> String {
    name.replace('\\', "/").trim().to_lowercase()
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
}
