//! Keeps the font files a saved subtitle style needs.
//!
//! Releases often ship their typesetting fonts as Matroska attachments, and mpv loads those only
//! while that file plays. A saved style stored just the font's NAME, so on any other file (another
//! release, an SRT, a later episode streamed elsewhere) libass silently fell back to a different
//! face. Saving a style now copies the attached faces it names into one folder that both mpv cores
//! read through `sub-fonts-dir`, which is additive to the system's own fonts. Faces the system
//! already has are not copied: a saved copy (often an older or subset version) would otherwise
//! shadow the installed one for every subtitle that asks for it.

use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::OnceLock;
use tauri::Manager;

static DIR: OnceLock<PathBuf> = OnceLock::new();

/// Create the folder at startup. Android's player plugin points `sub-fonts-dir` at the same
/// `<dataDir>/subtitle-fonts` path (Tauri's app data dir there is the activity's `dataDir`).
pub fn init(app: &tauri::AppHandle) {
    let Ok(root) = app.path().app_data_dir() else {
        return;
    };
    let dir = root.join("subtitle-fonts");
    if std::fs::create_dir_all(&dir).is_ok() {
        let _ = DIR.set(dir);
    }
}

/// The saved-fonts folder, once [`init`] created it.
#[cfg_attr(target_os = "android", allow(dead_code))]
pub fn dir() -> Option<&'static Path> {
    DIR.get().map(PathBuf::as_path)
}

const EBML: u64 = 0x1A45_DFA3;
const SEGMENT: u64 = 0x1853_8067;
const SEEK_HEAD: u64 = 0x114D_9B74;
const SEEK: u64 = 0x4DBB;
const SEEK_ID: u64 = 0x53AB;
const SEEK_POSITION: u64 = 0x53AC;
const CLUSTER: u64 = 0x1F43_B675;
const ATTACHMENTS: u64 = 0x1941_A469;
const ATTACHED_FILE: u64 = 0x61A7;
const FILE_NAME: u64 = 0x466E;
const FILE_DATA: u64 = 0x465C;

/// Enough of the file to hold the EBML header and the SeekHead that points at the attachments.
const HEAD_BYTES: u64 = 256 * 1024;
/// Releases attach tens of MB of fonts at most; refuse to buffer anything wildly bigger.
const MAX_ATTACHMENTS: u64 = 256 * 1024 * 1024;

struct Element {
    id: u64,
    size: Option<u64>,
    data: usize,
}

/// One EBML variable-length integer at `buf[at..]`: (value, length). IDs keep their marker bit.
fn vint(buf: &[u8], at: usize, keep_marker: bool) -> Option<(u64, usize)> {
    let first = *buf.get(at)?;
    let len = first.leading_zeros() as usize + 1;
    if len > 8 {
        return None;
    }
    let bytes = buf.get(at..at + len)?;
    let marker_free = if keep_marker {
        first as u64
    } else {
        first as u64 & (0xFF >> len)
    };
    Some((
        bytes[1..]
            .iter()
            .fold(marker_free, |value, b| (value << 8) | *b as u64),
        len,
    ))
}

fn element(buf: &[u8], at: usize) -> Option<Element> {
    let (id, id_len) = vint(buf, at, true)?;
    let (size, size_len) = vint(buf, at + id_len, false)?;
    let unknown = size == (1u64 << (7 * size_len)) - 1;
    Some(Element {
        id,
        size: (!unknown).then_some(size),
        data: at + id_len + size_len,
    })
}

fn body_end(element: &Element) -> Option<usize> {
    element
        .data
        .checked_add(usize::try_from(element.size?).ok()?)
}

/// The complete child elements of an element body.
fn children(body: &[u8]) -> Vec<(u64, &[u8])> {
    let mut out = Vec::new();
    let mut at = 0;
    while let Some(el) = element(body, at) {
        let Some(end) = body_end(&el) else { break };
        let Some(data) = body.get(el.data..end) else {
            break;
        };
        out.push((el.id, data));
        at = end;
    }
    out
}

fn uint(bytes: &[u8]) -> u64 {
    bytes.iter().fold(0, |value, b| (value << 8) | *b as u64)
}

/// Where the Attachments element starts in the file: listed in the SeekHead (mkvmerge and FFmpeg
/// always write one), or met while walking the head before the first Cluster.
fn attachments_offset(head: &[u8]) -> Option<u64> {
    let ebml = element(head, 0).filter(|e| e.id == EBML)?;
    let segment = element(head, body_end(&ebml)?).filter(|e| e.id == SEGMENT)?;
    let mut at = segment.data;
    while let Some(el) = element(head, at) {
        match el.id {
            ATTACHMENTS => return Some(at as u64),
            CLUSTER => return None,
            SEEK_HEAD => {
                let seeks = body_end(&el).and_then(|end| head.get(el.data..end));
                let target = seeks.into_iter().flat_map(children).find_map(|(id, seek)| {
                    let fields = children(seek);
                    let field = |want| fields.iter().find(|(id, _)| *id == want).map(|f| uint(f.1));
                    (id == SEEK && field(SEEK_ID) == Some(ATTACHMENTS))
                        .then(|| field(SEEK_POSITION))
                        .flatten()
                });
                if let Some(position) = target {
                    return Some(segment.data as u64 + position);
                }
            }
            _ => {}
        }
        at = body_end(&el)?;
    }
    None
}

/// `name` table ids: family, full name, PostScript name, typographic family. libass matches a
/// style's FontName against all four; full and PostScript names identify one face (Arial Bold).
const NAME_IDS: [usize; 4] = [1, 4, 6, 16];
const FACE_NAME_IDS: [usize; 2] = [4, 6];

/// The `(name id, text)` records of every face in a TrueType/OpenType font or collection, read
/// through `read(offset, len)` so an installed font only has its headers and name table read.
/// Anything that is not a font yields no faces.
fn face_names(mut read: impl FnMut(usize, usize) -> Option<Vec<u8>>) -> Vec<Vec<(usize, String)>> {
    let be16 = |b: &[u8], at: usize| {
        b.get(at..at + 2)
            .map(|b| u16::from_be_bytes([b[0], b[1]]) as usize)
    };
    let be32 = |b: &[u8], at: usize| {
        b.get(at..at + 4)
            .map(|b| u32::from_be_bytes([b[0], b[1], b[2], b[3]]) as usize)
    };
    let Some(head) = read(0, 12) else {
        return Vec::new();
    };
    let faces: Vec<usize> = if head.starts_with(b"ttcf") {
        let count = be32(&head, 8).unwrap_or(0).min(256);
        read(12, 4 * count)
            .map(|offsets| (0..count).filter_map(|i| be32(&offsets, 4 * i)).collect())
            .unwrap_or_default()
    } else {
        vec![0]
    };
    let mut out = Vec::new();
    for face in faces {
        let Some(tables) = read(face, 12).and_then(|header| be16(&header, 4)) else {
            continue;
        };
        let Some(directory) = read(face + 12, 16 * tables) else {
            continue;
        };
        let Some(table) = (0..tables)
            .map(|i| 16 * i)
            .find(|&record| directory.get(record..record + 4) == Some(b"name"))
            .and_then(|record| {
                read(
                    be32(&directory, record + 8)?,
                    be32(&directory, record + 12)?,
                )
            })
        else {
            continue;
        };
        let (Some(count), Some(strings)) = (be16(&table, 2), be16(&table, 4)) else {
            continue;
        };
        let mut names = Vec::new();
        for record in (0..count).map(|i| 6 + 12 * i) {
            let (Some(platform), Some(id), Some(len), Some(offset)) = (
                be16(&table, record),
                be16(&table, record + 6),
                be16(&table, record + 8),
                be16(&table, record + 10),
            ) else {
                break;
            };
            let start = strings + offset;
            let Some(raw) = table
                .get(start..start + len)
                .filter(|_| NAME_IDS.contains(&id))
            else {
                continue;
            };
            names.push((
                id,
                if platform == 1 {
                    raw.iter().map(|&b| b as char).collect()
                } else {
                    let units: Vec<u16> = raw
                        .chunks_exact(2)
                        .map(|c| u16::from_be_bytes([c[0], c[1]]))
                        .collect();
                    String::from_utf16_lossy(&units)
                },
            ));
        }
        if !names.is_empty() {
            out.push(names);
        }
    }
    out
}

fn names_in(data: &[u8]) -> Vec<Vec<(usize, String)>> {
    face_names(|at, len| data.get(at..at.checked_add(len)?).map(<[u8]>::to_vec))
}

fn names_in_file(path: &Path) -> Vec<Vec<(usize, String)>> {
    use std::io::{Read, Seek, SeekFrom};
    let Ok(mut file) = std::fs::File::open(path) else {
        return Vec::new();
    };
    face_names(|at, len| {
        // A name table is a few KB; anything this big is not a font header.
        if len > 1 << 20 {
            return None;
        }
        let mut buf = vec![0; len];
        file.seek(SeekFrom::Start(at as u64)).ok()?;
        file.read_exact(&mut buf).ok()?;
        Some(buf)
    })
}

/// The face names (full and PostScript) of one face, normalized.
fn face_ids(face: &[(usize, String)]) -> impl Iterator<Item = String> + '_ {
    face.iter()
        .filter(|(id, _)| FACE_NAME_IDS.contains(id))
        .map(|(_, name)| normalize(name))
}

/// Where the platform's font providers (DirectWrite, CoreText, fontconfig) find installed fonts.
fn system_font_dirs() -> Vec<PathBuf> {
    let env = |key: &str| std::env::var_os(key).map(PathBuf::from);
    let mut dirs = Vec::new();
    if cfg!(windows) {
        dirs.extend(env("WINDIR").map(|dir| dir.join("Fonts")));
        dirs.extend(
            env("LOCALAPPDATA").map(|dir| dir.join("Microsoft").join("Windows").join("Fonts")),
        );
    } else if cfg!(target_os = "macos") {
        dirs.extend(["/System/Library/Fonts", "/Library/Fonts"].map(PathBuf::from));
        dirs.extend(env("HOME").map(|home| home.join("Library/Fonts")));
    } else if cfg!(target_os = "android") {
        dirs.extend(["/system/fonts", "/product/fonts"].map(PathBuf::from));
    } else {
        // `/run/host/*` is how the Flatpak build sees the host's fonts.
        dirs.extend(
            [
                "/usr/share/fonts",
                "/usr/local/share/fonts",
                "/run/host/fonts",
                "/run/host/user-fonts",
            ]
            .map(PathBuf::from),
        );
        dirs.extend(
            env("HOME")
                .into_iter()
                .flat_map(|home| [home.join(".local/share/fonts"), home.join(".fonts")]),
        );
    }
    dirs
}

/// Face names of every installed font. Only headers and name tables are read.
fn installed_faces() -> HashSet<String> {
    let mut pending = system_font_dirs();
    let mut faces = HashSet::new();
    while let Some(dir) = pending.pop() {
        let Ok(entries) = std::fs::read_dir(&dir) else {
            continue;
        };
        for entry in entries.flatten() {
            let path = entry.path();
            // DirEntry::file_type does not follow symlinks, so a looping link is never walked.
            if entry.file_type().is_ok_and(|kind| kind.is_dir()) {
                pending.push(path);
                continue;
            }
            let font = path
                .extension()
                .and_then(|ext| ext.to_str())
                .is_some_and(|ext| {
                    ["ttf", "otf", "ttc", "otc"].contains(&ext.to_ascii_lowercase().as_str())
                });
            if font {
                for face in names_in_file(&path) {
                    faces.extend(face_ids(&face));
                }
            }
        }
    }
    faces
}

/// libass compares names case-insensitively; a leading `@` asks for the vertical variant.
fn normalize(name: &str) -> String {
    name.trim().trim_start_matches('@').trim().to_lowercase()
}

/// Content-addressed, so saving the same style twice (or two releases sharing a font) keeps one copy.
fn stored_name(file_name: &str, data: &[u8]) -> String {
    let clean: String = file_name
        .chars()
        .map(|c| {
            if c.is_alphanumeric() || "._- ".contains(c) {
                c
            } else {
                '_'
            }
        })
        .take(80)
        .collect();
    let clean = clean.trim_matches(|c: char| c == '.' || c == ' ');
    format!(
        "{}-{}",
        &blake3::hash(data).to_hex()[..12],
        if clean.is_empty() { "font" } else { clean }
    )
}

async fn read_range(source: &str, start: u64, len: u64) -> Result<Vec<u8>, String> {
    if len == 0 {
        return Ok(Vec::new());
    }
    if source.starts_with("http://") || source.starts_with("https://") {
        // shortcut: no per-stream request headers; a source that needs them (Referer) fails here
        // and only its fonts go unsaved. Pass mpv's http-header-fields through if that shows up.
        let response = crate::download_http_client()
            .get(source)
            .header(
                reqwest::header::RANGE,
                format!("bytes={start}-{}", start + len - 1),
            )
            .send()
            .await
            .map_err(|_| "range-request-failed".to_string())?;
        if response.status() != reqwest::StatusCode::PARTIAL_CONTENT {
            return Err(format!(
                "range-not-supported-{}",
                response.status().as_u16()
            ));
        }
        let bytes = response
            .bytes()
            .await
            .map_err(|_| "range-read-failed".to_string())?;
        return Ok(bytes.to_vec());
    }
    let path = Path::new(source);
    if !path.is_absolute() {
        return Err("unsupported-source".into());
    }
    use std::io::{Read, Seek, SeekFrom};
    let mut file = std::fs::File::open(path).map_err(|e| e.to_string())?;
    file.seek(SeekFrom::Start(start))
        .map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    file.take(len)
        .read_to_end(&mut out)
        .map_err(|e| e.to_string())?;
    Ok(out)
}

/// `installed` is only awaited when the file attaches a face the style names.
async fn save_into(
    dir: &Path,
    source: &str,
    families: &[String],
    installed: impl std::future::Future<Output = HashSet<String>>,
) -> Result<Vec<String>, String> {
    let wanted: Vec<(&String, String)> = families
        .iter()
        .map(|family| (family, normalize(family)))
        .filter(|(_, key)| !key.is_empty())
        .collect();
    if wanted.is_empty() {
        return Ok(Vec::new());
    }
    let head = read_range(source, 0, HEAD_BYTES).await?;
    let Some(at) = attachments_offset(&head) else {
        return Ok(Vec::new());
    };
    let header = read_range(source, at, 16).await?;
    let attachments = element(&header, 0)
        .filter(|e| e.id == ATTACHMENTS)
        .ok_or("attachments-not-found")?;
    let size = attachments
        .size
        .filter(|&size| size <= MAX_ATTACHMENTS)
        .ok_or("attachments-too-large")?;
    let body = read_range(source, at + attachments.data as u64, size).await?;

    let mut matches = Vec::new();
    for (id, file) in children(&body) {
        if id != ATTACHED_FILE {
            continue;
        }
        let fields = children(file);
        let field = |want| fields.iter().find(|(id, _)| *id == want).map(|f| f.1);
        let Some(data) = field(FILE_DATA) else {
            continue;
        };
        let faces = names_in(data);
        let names: Vec<String> = faces
            .iter()
            .flatten()
            .map(|(_, name)| normalize(name))
            .collect();
        let hits: Vec<&String> = wanted
            .iter()
            .filter(|(_, key)| names.contains(key))
            .map(|(family, _)| *family)
            .collect();
        if !hits.is_empty() {
            matches.push((field(FILE_NAME).unwrap_or_default(), data, faces, hits));
        }
    }
    if matches.is_empty() {
        return Ok(Vec::new());
    }
    let installed = installed.await;

    let mut saved: Vec<String> = Vec::new();
    for (file_name, data, faces, hits) in matches {
        // The system's own copy of the exact face already renders it (any version will do), so
        // only faces it lacks are kept: a release's Bold of a family installed in Regular only.
        if faces
            .iter()
            .all(|face| face_ids(face).any(|id| installed.contains(&id)))
        {
            continue;
        }
        let path = dir.join(stored_name(&String::from_utf8_lossy(file_name), data));
        if !path.exists() {
            // Through a temp name: a half-written file would never be rewritten (the name exists).
            let partial = path.with_extension("partial");
            std::fs::write(&partial, data).map_err(|e| e.to_string())?;
            std::fs::rename(&partial, &path).map_err(|e| e.to_string())?;
        }
        saved.extend(hits.into_iter().cloned());
    }
    saved.sort();
    saved.dedup();
    Ok(saved)
}

/// Copy the font attachments of the playing Matroska `source` (an http(s) URL or an absolute path)
/// that any of `families` names into the saved-fonts folder, except faces already installed on
/// the system. Returns the families now kept there.
#[tauri::command]
pub async fn subtitle_fonts_save(
    source: String,
    families: Vec<String>,
) -> Result<Vec<String>, String> {
    let dir = DIR.get().ok_or("fonts-folder-unavailable")?;
    let installed = async {
        tauri::async_runtime::spawn_blocking(installed_faces)
            .await
            .unwrap_or_default()
    };
    save_into(dir, &source, &families, installed).await
}

#[cfg(test)]
mod tests {
    use super::*;

    fn el(id: u64, body: &[u8]) -> Vec<u8> {
        let mut out: Vec<u8> = id
            .to_be_bytes()
            .into_iter()
            .skip_while(|b| *b == 0)
            .collect();
        // 8-byte size vint: marker 0x01 then seven value bytes.
        out.push(0x01);
        out.extend_from_slice(&(body.len() as u64).to_be_bytes()[1..]);
        out.extend_from_slice(body);
        out
    }

    /// A minimal sfnt whose only table is `name`: family, full and PostScript names as Windows
    /// (UTF-16BE) records.
    fn face(family: &str, full: &str, postscript: &str) -> Vec<u8> {
        let records = [(1u16, family), (4, full), (6, postscript)];
        let mut name = Vec::new();
        let mut strings = Vec::new();
        for v in [0u16, records.len() as u16, 6 + 12 * records.len() as u16] {
            name.extend_from_slice(&v.to_be_bytes()); // format, count, string offset
        }
        for (id, value) in records {
            let text: Vec<u8> = value.encode_utf16().flat_map(u16::to_be_bytes).collect();
            for v in [3u16, 1, 0x409, id, text.len() as u16, strings.len() as u16] {
                name.extend_from_slice(&v.to_be_bytes()); // platform, encoding, language, id, len, offset
            }
            strings.extend(text);
        }
        name.extend(strings);
        let mut out = vec![0, 1, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0];
        out.extend_from_slice(b"name");
        out.extend_from_slice(&[0, 0, 0, 0]);
        out.extend_from_slice(&28u32.to_be_bytes());
        out.extend_from_slice(&(name.len() as u32).to_be_bytes());
        out.extend_from_slice(&name);
        out
    }

    fn attached(name: &str, data: &[u8]) -> Vec<u8> {
        el(
            ATTACHED_FILE,
            &[el(FILE_NAME, name.as_bytes()), el(FILE_DATA, data)].concat(),
        )
    }

    /// EBML header, Segment { SeekHead → Attachments, Cluster, Attachments } — attachments placed
    /// after a cluster so only the SeekHead can find them.
    fn mkv(files: &[Vec<u8>]) -> Vec<u8> {
        let cluster = el(CLUSTER, &[0; 32]);
        let seek_head = |position: u64| {
            let seek = el(
                SEEK,
                &[
                    el(SEEK_ID, &[0x19, 0x41, 0xA4, 0x69]),
                    el(SEEK_POSITION, &position.to_be_bytes()),
                ]
                .concat(),
            );
            el(SEEK_HEAD, &seek)
        };
        let position = (seek_head(0).len() + cluster.len()) as u64;
        let body = [
            seek_head(position),
            cluster,
            el(ATTACHMENTS, &files.concat()),
        ]
        .concat();
        [el(EBML, &[]), el(SEGMENT, &body)].concat()
    }

    fn temp_root(tag: &str) -> PathBuf {
        let root =
            std::env::temp_dir().join(format!("izumi-subfonts-{tag}-{}", std::process::id()));
        std::fs::create_dir_all(root.join("fonts")).unwrap();
        root
    }

    fn saved_files(dir: &Path) -> Vec<String> {
        let mut files: Vec<String> = std::fs::read_dir(dir)
            .unwrap()
            .map(|e| e.unwrap().file_name().to_string_lossy().to_string())
            .collect();
        files.sort();
        files
    }

    #[test]
    fn reads_font_names_from_memory_and_disk() {
        let data = face("Gandhi Sans", "Gandhi Sans Bold", "GandhiSans-Bold");
        let expected = vec![vec![
            (1, "Gandhi Sans".to_string()),
            (4, "Gandhi Sans Bold".to_string()),
            (6, "GandhiSans-Bold".to_string()),
        ]];
        assert_eq!(names_in(&data), expected);
        let root = temp_root("names");
        let path = root.join("bold.otf");
        std::fs::write(&path, &data).unwrap();
        assert_eq!(names_in_file(&path), expected);
        assert!(names_in(b"\x89PNG not a font").is_empty());
        std::fs::remove_dir_all(&root).unwrap();
    }

    #[tokio::test]
    async fn saves_only_the_attached_fonts_a_style_names() {
        let root = temp_root("save");
        let fonts = root.join("fonts");
        let video = root.join("episode.mkv");
        std::fs::write(
            &video,
            mkv(&[
                attached(
                    "GandhiSans-Bold.otf",
                    &face("Gandhi Sans", "Gandhi Sans Bold", "GandhiSans-Bold"),
                ),
                attached("other.ttf", &face("Other", "Other", "Other")),
            ]),
        )
        .unwrap();
        let source = video.to_string_lossy().to_string();
        let none = || async { HashSet::new() };

        let saved = save_into(
            &fonts,
            &source,
            &["@gandhi sans".into(), "Arial".into()],
            none(),
        )
        .await
        .unwrap();
        assert_eq!(saved, vec!["@gandhi sans".to_string()]);
        let files = saved_files(&fonts);
        assert_eq!(files.len(), 1);
        assert!(files[0].ends_with("-GandhiSans-Bold.otf"));

        // Saving again keeps the one copy.
        save_into(&fonts, &source, &["Gandhi Sans".into()], none())
            .await
            .unwrap();
        assert_eq!(saved_files(&fonts).len(), 1);
        std::fs::remove_dir_all(&root).unwrap();
    }

    #[cfg(windows)]
    #[test]
    fn finds_installed_windows_fonts() {
        let faces = installed_faces();
        assert!(faces.contains("arialmt") && faces.contains("arial bold"));
    }

    #[tokio::test]
    async fn skips_faces_the_system_already_has() {
        let root = temp_root("installed");
        let fonts = root.join("fonts");
        let video = root.join("episode.mkv");
        std::fs::write(
            &video,
            mkv(&[
                attached("arial.ttf", &face("Arial", "Arial", "ArialMT")),
                attached("arialbd.ttf", &face("Arial", "Arial Bold", "Arial-BoldMT")),
            ]),
        )
        .unwrap();
        let source = video.to_string_lossy().to_string();
        let installed = |faces: &[&str]| {
            let set: HashSet<String> = faces.iter().map(|f| f.to_string()).collect();
            async { set }
        };

        // Regular installed, Bold missing: only the Bold is kept.
        let saved = save_into(&fonts, &source, &["Arial".into()], installed(&["arialmt"]))
            .await
            .unwrap();
        assert_eq!(saved, vec!["Arial".to_string()]);
        let files = saved_files(&fonts);
        assert_eq!(files.len(), 1);
        assert!(files[0].ends_with("-arialbd.ttf"));

        // Both installed: nothing is copied and nothing is reported.
        std::fs::remove_file(fonts.join(&files[0])).unwrap();
        let both = installed(&["arialmt", "arial bold"]);
        let saved = save_into(&fonts, &source, &["Arial".into()], both)
            .await
            .unwrap();
        assert!(saved.is_empty());
        assert!(saved_files(&fonts).is_empty());
        std::fs::remove_dir_all(&root).unwrap();
    }
}
