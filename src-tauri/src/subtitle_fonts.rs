//! Keeps the font files a saved subtitle style needs.
//!
//! Releases often ship their typesetting fonts as Matroska attachments, and mpv loads those only
//! while that file plays. A saved style stored just the font's NAME, so on any other file (another
//! release, an SRT, a later episode streamed elsewhere) libass silently fell back to a different
//! face. Saving a style now copies the attached faces it names into one folder that both mpv cores
//! read through `sub-fonts-dir`, which is additive to the system's own fonts.

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

/// Every family, full and PostScript name in a TrueType/OpenType font or collection: the names
/// libass matches a style's FontName against. Anything that is not a font yields none.
fn font_names(data: &[u8]) -> Vec<String> {
    let be16 = |at: usize| {
        data.get(at..at + 2)
            .map(|b| u16::from_be_bytes([b[0], b[1]]) as usize)
    };
    let be32 = |at: usize| {
        data.get(at..at + 4)
            .map(|b| u32::from_be_bytes([b[0], b[1], b[2], b[3]]) as usize)
    };
    let faces: Vec<usize> = if data.starts_with(b"ttcf") {
        (0..be32(8).unwrap_or(0).min(256))
            .filter_map(|i| be32(12 + 4 * i))
            .collect()
    } else {
        vec![0]
    };
    let mut names = Vec::new();
    for face in faces {
        let Some(tables) = be16(face + 4) else {
            continue;
        };
        let Some(table) = (0..tables)
            .map(|i| face + 12 + 16 * i)
            .find(|&record| data.get(record..record + 4) == Some(b"name"))
            .and_then(|record| be32(record + 8))
        else {
            continue;
        };
        let (Some(count), Some(strings)) = (be16(table + 2), be16(table + 4)) else {
            continue;
        };
        for record in (0..count).map(|i| table + 6 + 12 * i) {
            let (Some(platform), Some(id), Some(len), Some(offset)) = (
                be16(record),
                be16(record + 6),
                be16(record + 8),
                be16(record + 10),
            ) else {
                break;
            };
            if ![1, 4, 6, 16].contains(&id) {
                continue;
            }
            let start = table + strings + offset;
            let Some(raw) = data.get(start..start + len) else {
                continue;
            };
            names.push(if platform == 1 {
                raw.iter().map(|&b| b as char).collect()
            } else {
                let units: Vec<u16> = raw
                    .chunks_exact(2)
                    .map(|c| u16::from_be_bytes([c[0], c[1]]))
                    .collect();
                String::from_utf16_lossy(&units)
            });
        }
    }
    names
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

async fn save_into(dir: &Path, source: &str, families: &[String]) -> Result<Vec<String>, String> {
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

    let mut saved: Vec<String> = Vec::new();
    for (id, file) in children(&body) {
        if id != ATTACHED_FILE {
            continue;
        }
        let fields = children(file);
        let field = |want| fields.iter().find(|(id, _)| *id == want).map(|f| f.1);
        let Some(data) = field(FILE_DATA) else {
            continue;
        };
        let names: Vec<String> = font_names(data).iter().map(|n| normalize(n)).collect();
        let hits: Vec<&String> = wanted
            .iter()
            .filter(|(_, key)| names.contains(key))
            .map(|(family, _)| *family)
            .collect();
        if hits.is_empty() {
            continue;
        }
        let path = dir.join(stored_name(
            &String::from_utf8_lossy(field(FILE_NAME).unwrap_or_default()),
            data,
        ));
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
/// that any of `families` names into the saved-fonts folder. Returns the families now kept there.
/// A family the file does not attach (a system font) is left to the system.
#[tauri::command]
pub async fn subtitle_fonts_save(
    source: String,
    families: Vec<String>,
) -> Result<Vec<String>, String> {
    let dir = DIR.get().ok_or("fonts-folder-unavailable")?;
    save_into(dir, &source, &families).await
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

    /// A minimal sfnt with only a `name` table carrying `family` as a Windows (UTF-16BE) record.
    fn font(family: &str) -> Vec<u8> {
        let text: Vec<u8> = family.encode_utf16().flat_map(u16::to_be_bytes).collect();
        let mut name = Vec::new();
        for v in [0u16, 1, 18] {
            name.extend_from_slice(&v.to_be_bytes()); // format, count, string offset
        }
        for v in [3u16, 1, 0x409, 1, text.len() as u16, 0] {
            name.extend_from_slice(&v.to_be_bytes()); // platform, encoding, language, id, len, offset
        }
        name.extend_from_slice(&text);
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

    #[test]
    fn reads_font_names() {
        assert_eq!(
            font_names(&font("Gandhi Sans")),
            vec!["Gandhi Sans".to_string()]
        );
        assert!(font_names(b"\x89PNG not a font").is_empty());
    }

    #[tokio::test]
    async fn saves_only_the_attached_fonts_a_style_names() {
        let root = std::env::temp_dir().join(format!("izumi-subfonts-{}", std::process::id()));
        let fonts = root.join("fonts");
        std::fs::create_dir_all(&fonts).unwrap();
        let video = root.join("episode.mkv");
        std::fs::write(
            &video,
            mkv(&[
                attached("GandhiSans-Bold.otf", &font("Gandhi Sans")),
                attached("other.ttf", &font("Other")),
            ]),
        )
        .unwrap();
        let source = video.to_string_lossy().to_string();

        let saved = save_into(&fonts, &source, &["@gandhi sans".into(), "Arial".into()])
            .await
            .unwrap();
        assert_eq!(saved, vec!["@gandhi sans".to_string()]);
        let files: Vec<String> = std::fs::read_dir(&fonts)
            .unwrap()
            .map(|e| e.unwrap().file_name().to_string_lossy().to_string())
            .collect();
        assert_eq!(files.len(), 1);
        assert!(files[0].ends_with("-GandhiSans-Bold.otf"));

        // Saving again keeps the one copy.
        save_into(&fonts, &source, &["Gandhi Sans".into()])
            .await
            .unwrap();
        assert_eq!(std::fs::read_dir(&fonts).unwrap().count(), 1);
        std::fs::remove_dir_all(&root).unwrap();
    }
}
