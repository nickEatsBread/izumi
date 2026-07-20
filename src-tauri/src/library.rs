use serde::Serialize;
use std::path::{Path, PathBuf};

const VIDEO_EXTENSIONS: &[&str] = &["mkv", "mp4", "avi", "mov", "webm", "m4v", "ts"];
const MAX_SCAN_DEPTH: usize = 16;
const MAX_SCAN_FILES: usize = 50_000;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LibraryFile {
    path: String,
    filename: String,
    size: u64,
    modified_at: Option<u64>,
}

fn is_video(path: &Path) -> bool {
    path.extension()
        .and_then(|value| value.to_str())
        .map(|value| VIDEO_EXTENSIONS.contains(&value.to_ascii_lowercase().as_str()))
        .unwrap_or(false)
}

fn visit(path: &Path, depth: usize, files: &mut Vec<LibraryFile>) -> Result<(), String> {
    if depth > MAX_SCAN_DEPTH || files.len() >= MAX_SCAN_FILES {
        return Ok(());
    }
    let metadata = std::fs::metadata(path).map_err(|error| error.to_string())?;
    if metadata.is_file() {
        if is_video(path) {
            files.push(LibraryFile {
                path: path.to_string_lossy().into_owned(),
                filename: path
                    .file_name()
                    .and_then(|value| value.to_str())
                    .unwrap_or_default()
                    .to_string(),
                size: metadata.len(),
                modified_at: metadata
                    .modified()
                    .ok()
                    .and_then(|value| value.duration_since(std::time::UNIX_EPOCH).ok())
                    .map(|value| value.as_millis().min(u64::MAX as u128) as u64),
            });
        }
        return Ok(());
    }
    if !metadata.is_dir() {
        return Ok(());
    }
    let entries = std::fs::read_dir(path).map_err(|error| error.to_string())?;
    for entry in entries {
        if files.len() >= MAX_SCAN_FILES {
            break;
        }
        let entry = match entry {
            Ok(value) => value,
            Err(_) => continue,
        };
        let child = entry.path();
        // Do not follow directory symlinks: a media-library link can otherwise create a cycle.
        if entry.file_type().map(|kind| kind.is_symlink()).unwrap_or(true) {
            continue;
        }
        let _ = visit(&child, depth + 1, files);
    }
    Ok(())
}

#[tauri::command]
pub async fn library_scan(paths: Vec<String>) -> Result<Vec<LibraryFile>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let mut files = Vec::new();
        for raw in paths {
            let path = PathBuf::from(raw);
            if !path.is_absolute() {
                return Err("Library folders must be absolute paths.".to_string());
            }
            visit(&path, 0, &mut files)?;
        }
        files.sort_by(|left, right| left.path.cmp(&right.path));
        files.dedup_by(|left, right| left.path == right.path);
        Ok(files)
    })
    .await
    .map_err(|error| error.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn recognises_supported_video_extensions_case_insensitively() {
        assert!(is_video(Path::new("Episode 01.MKV")));
        assert!(is_video(Path::new("movie.mp4")));
        assert!(!is_video(Path::new("poster.jpg")));
        assert!(!is_video(Path::new("subtitles.ass")));
    }
}
