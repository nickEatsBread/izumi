//! The lines of one text subtitle track inside a local Matroska file, for the plugin runtime's
//! `player.subtitles` scope. mpv only exposes the line on screen, so the track is read from the
//! file itself: one forward pass over the clusters that reads this track's blocks and seeks past
//! every other payload, so video and audio are never read into memory.

use crate::subtitle_fonts::{children, uint, vint, CLUSTER, EBML, SEGMENT};
use flate2::read::ZlibDecoder;
use std::io::{self, BufRead, BufReader, Read, Seek};
use std::path::{Path, PathBuf};

const INFO: u64 = 0x1549_A966;
const TIMESTAMP_SCALE: u64 = 0x2A_D7B1;
const TRACKS: u64 = 0x1654_AE6B;
const TRACK_ENTRY: u64 = 0xAE;
const TRACK_NUMBER: u64 = 0xD7;
const CODEC_ID: u64 = 0x86;
const DEFAULT_DURATION: u64 = 0x23_E383;
const CONTENT_ENCODINGS: u64 = 0x6D80;
const CONTENT_ENCODING: u64 = 0x6240;
const CONTENT_ENCODING_ORDER: u64 = 0x5031;
const CONTENT_ENCODING_SCOPE: u64 = 0x5032;
const CONTENT_ENCODING_TYPE: u64 = 0x5033;
const CONTENT_COMPRESSION: u64 = 0x5034;
const CONTENT_COMP_ALGO: u64 = 0x4254;
const CONTENT_COMP_SETTINGS: u64 = 0x4255;
const CLUSTER_TIMESTAMP: u64 = 0xE7;
const SIMPLE_BLOCK: u64 = 0xA3;
const BLOCK_GROUP: u64 = 0xA0;
const BLOCK: u64 = 0xA1;
const BLOCK_DURATION: u64 = 0x9B;

const MAX_CUES: usize = 5000;
const MAX_TEXT: usize = 4 * 1024 * 1024;
/// Info and Tracks are read whole; real ones are a few KB (ASS styles sit in CodecPrivate).
const MAX_HEADER: u64 = 16 * 1024 * 1024;
/// A subtitle frame is a line of text; anything bigger is not one (or is damage).
const MAX_FRAME: u64 = 1024 * 1024;

#[derive(Debug, serde::Serialize)]
pub struct Cue {
    start: f64,
    end: f64,
    /// As stored: an ASS line's Text field with its override tags, which the caller strips.
    text: String,
}

struct Track {
    ass: bool,
    /// Nanoseconds; spaces laced frames and ends a block that has no BlockDuration.
    default_duration: u64,
    /// (ContentCompAlgo, ContentCompSettings) in the order they are undone.
    encodings: Vec<(u64, Vec<u8>)>,
}

fn get<'a>(fields: &[(u64, &'a [u8])], id: u64) -> Option<&'a [u8]> {
    fields
        .iter()
        .find(|(field, _)| *field == id)
        .map(|(_, data)| *data)
}

fn find_track(tracks: &[u8], number: u64) -> Result<Track, &'static str> {
    let entry = children(tracks)
        .into_iter()
        .filter(|(id, _)| *id == TRACK_ENTRY)
        .map(|(_, entry)| children(entry))
        .find(|fields| get(fields, TRACK_NUMBER).map(uint) == Some(number))
        .ok_or("track-not-found")?;
    let codec = get(&entry, CODEC_ID).unwrap_or_default();
    let ass = matches!(codec, b"S_TEXT/ASS" | b"S_TEXT/SSA");
    if !ass && !matches!(codec, b"S_TEXT/UTF8" | b"S_TEXT/WEBVTT") {
        return Err("not-text");
    }
    let mut encodings = Vec::new();
    for (_, encoding) in get(&entry, CONTENT_ENCODINGS)
        .map(children)
        .unwrap_or_default()
        .into_iter()
        .filter(|(id, _)| *id == CONTENT_ENCODING)
    {
        let fields = children(encoding);
        // Scope bit 1 is the frames; an encoding of CodecPrivate alone does not touch the text.
        if get(&fields, CONTENT_ENCODING_SCOPE).map_or(1, uint) & 1 == 0 {
            continue;
        }
        if get(&fields, CONTENT_ENCODING_TYPE).map_or(0, uint) != 0 {
            return Err("encrypted");
        }
        let compression = get(&fields, CONTENT_COMPRESSION)
            .map(children)
            .unwrap_or_default();
        // 0 = zlib (the usual one for ASS), 3 = header stripping. bzlib and LZO are not in use.
        let algo = get(&compression, CONTENT_COMP_ALGO).map_or(0, uint);
        if algo != 0 && algo != 3 {
            return Err("unsupported-compression");
        }
        let settings = get(&compression, CONTENT_COMP_SETTINGS).unwrap_or_default();
        let order = get(&fields, CONTENT_ENCODING_ORDER).map_or(0, uint);
        encodings.push((order, algo, settings.to_vec()));
    }
    // Encodings are undone from the highest ContentEncodingOrder down.
    encodings.sort_by(|a, b| b.0.cmp(&a.0));
    Ok(Track {
        ass,
        default_duration: get(&entry, DEFAULT_DURATION).map_or(0, uint),
        encodings: encodings
            .into_iter()
            .map(|(_, algo, settings)| (algo, settings))
            .collect(),
    })
}

/// A Block body after its track number: (relative timestamp, frames), laced or not.
fn frames(body: &[u8]) -> Option<(i16, Vec<&[u8]>)> {
    let time = i16::from_be_bytes([*body.first()?, *body.get(1)?]);
    let lacing = (body.get(2)? >> 1) & 3;
    let data = body.get(3..)?;
    if lacing == 0 {
        return Some((time, vec![data]));
    }
    let count = *data.first()? as usize + 1;
    let mut at = 1;
    let mut sizes: Vec<usize> = Vec::with_capacity(count);
    match lacing {
        // Xiph: each size is a run of 255s plus one smaller byte.
        1 => {
            for _ in 1..count {
                let mut size = 0;
                loop {
                    let byte = *data.get(at)?;
                    at += 1;
                    size += byte as usize;
                    if byte != 255 {
                        break;
                    }
                }
                sizes.push(size);
            }
        }
        // EBML: the first size, then each one as a signed difference from the one before.
        3 => {
            for _ in 1..count {
                let (value, len) = vint(data, at, false)?;
                at += len;
                let size = match sizes.last() {
                    Some(&last) => last as i64 + value as i64 - ((1i64 << (7 * len - 1)) - 1),
                    None => value as i64,
                };
                sizes.push(usize::try_from(size).ok()?);
            }
        }
        // Fixed: equal sizes.
        _ => sizes = vec![(data.len() - 1) / count; count - 1],
    }
    let mut out = Vec::with_capacity(count);
    for size in sizes {
        out.push(data.get(at..at.checked_add(size)?)?);
        at += size;
    }
    out.push(data.get(at..)?);
    Some((time, out))
}

fn decode(frame: &[u8], encodings: &[(u64, Vec<u8>)]) -> Option<Vec<u8>> {
    let mut data = frame.to_vec();
    for (algo, settings) in encodings {
        data = if *algo == 0 {
            let mut out = Vec::new();
            ZlibDecoder::new(data.as_slice())
                .take(MAX_FRAME)
                .read_to_end(&mut out)
                .ok()?;
            out
        } else {
            [settings.as_slice(), &data].concat()
        };
    }
    Some(data)
}

struct Walk<R> {
    r: BufReader<R>,
    pos: u64,
}

impl<R: Read + Seek> Walk<R> {
    fn read(&mut self, buf: &mut [u8]) -> io::Result<()> {
        self.r.read_exact(buf)?;
        self.pos += buf.len() as u64;
        Ok(())
    }

    fn body(&mut self, size: u64) -> io::Result<Vec<u8>> {
        let mut body = vec![0; size as usize];
        self.read(&mut body)?;
        Ok(body)
    }

    /// Seeking inside the buffer is free; past it, only the next read touches the disk.
    fn skip_to(&mut self, to: u64) -> io::Result<()> {
        self.r.seek_relative(to as i64 - self.pos as i64)?;
        self.pos = to;
        Ok(())
    }

    fn vint(&mut self, keep_marker: bool, max_len: usize) -> io::Result<Option<u64>> {
        let mut buf = [0u8; 8];
        self.read(&mut buf[..1])?;
        let len = buf[0].leading_zeros() as usize + 1;
        if len > max_len {
            return Ok(None);
        }
        self.read(&mut buf[1..len])?;
        Ok(vint(&buf[..len], 0, keep_marker).map(|(value, _)| value))
    }

    /// An element header: (id, size, None when unknown); None when the bytes here are no header.
    fn header(&mut self) -> io::Result<Option<(u64, Option<u64>)>> {
        let Some(id) = self.vint(true, 4)? else {
            return Ok(None);
        };
        let first = self.pos;
        let Some(size) = self.vint(false, 8)? else {
            return Ok(None);
        };
        let len = self.pos - first;
        let unknown = size == (1u64 << (7 * len)) - 1;
        Ok(Some((id, (!unknown).then_some(size))))
    }

    /// The body after the track number of a SimpleBlock or of a BlockGroup's Block, plus the
    /// group's BlockDuration, when it belongs to track `number`. Others are skipped unread.
    fn block(
        &mut self,
        id: u64,
        size: u64,
        number: u64,
    ) -> io::Result<Option<(Vec<u8>, Option<u64>)>> {
        let end = self.pos + size;
        let mut found = None;
        let mut duration = None;
        if id == SIMPLE_BLOCK {
            found = self.payload(end, number)?;
        } else {
            while self.pos < end {
                let Some((child, Some(size))) = self.header()? else {
                    break;
                };
                match child {
                    BLOCK => {
                        found = self.payload(self.pos + size, number)?;
                        if found.is_none() {
                            break;
                        }
                    }
                    BLOCK_DURATION if size <= 8 => duration = Some(uint(&self.body(size)?)),
                    _ => self.skip_to(self.pos + size)?,
                }
            }
        }
        self.skip_to(end)?;
        Ok(found.map(|body| (body, duration)))
    }

    fn payload(&mut self, end: u64, number: u64) -> io::Result<Option<Vec<u8>>> {
        if self.vint(false, 8)? != Some(number) || end.saturating_sub(self.pos) > MAX_FRAME {
            return Ok(None);
        }
        self.body(end.saturating_sub(self.pos)).map(Some)
    }

    /// Moves to the next Cluster ID after `from`. Bytes that are no element (damage, or a part of a
    /// torrent not downloaded yet, which reads as zeros) end there. False at the end of the file.
    fn resync(&mut self, from: u64) -> io::Result<bool> {
        self.skip_to(from + 1)?;
        let mut window = 0u32;
        loop {
            let buf = self.r.fill_buf()?;
            if buf.is_empty() {
                return Ok(false);
            }
            let hit = buf.iter().position(|&byte| {
                window = window << 8 | byte as u32;
                window == CLUSTER as u32
            });
            let used = hit.map_or(buf.len(), |i| i + 1);
            self.r.consume(used);
            self.pos += used as u64;
            if hit.is_some() {
                self.skip_to(self.pos - 4)?;
                return Ok(true);
            }
        }
    }
}

/// The cues of Matroska track `number`, by start time. A file that ends early (a torrent still
/// downloading) gives the cues before that point, and a hole is skipped to the next cluster.
fn read_cues<R: Read + Seek>(source: R, number: u64) -> Result<Vec<Cue>, &'static str> {
    // Small on purpose: most video frames are bigger, so seeking past them skips their bytes.
    let mut walk = Walk {
        r: BufReader::with_capacity(16 * 1024, source),
        pos: 0,
    };
    let start = (|| {
        let Some((EBML, Some(size))) = walk.header()? else {
            return Ok(false);
        };
        walk.skip_to(walk.pos + size)?;
        Ok::<_, io::Error>(matches!(walk.header()?, Some((SEGMENT, _))))
    })();
    if !start.unwrap_or(false) {
        return Err("not-matroska");
    }
    let mut scale = 1_000_000;
    let mut track: Option<Track> = None;
    // None until the cluster's Timestamp: after a resync, blocks before it have no time.
    let mut cluster: Option<u64> = None;
    let mut cues = Vec::new();
    let mut text_bytes = 0;
    while cues.len() < MAX_CUES && text_bytes < MAX_TEXT {
        let at = walk.pos;
        let Ok(header) = walk.header() else {
            break;
        };
        // Only the Segment and its Clusters may have an unknown size; both are stepped into.
        let element = header.and_then(|(id, size)| match (id, size) {
            (SEGMENT | CLUSTER, _) => Some((id, 0)),
            (_, Some(size)) => Some((id, size)),
            _ => None,
        });
        let Some((id, size)) = element else {
            if walk.resync(at).unwrap_or(false) {
                continue;
            }
            break;
        };
        let step = match id {
            SEGMENT => Ok(()),
            CLUSTER => {
                cluster = None;
                Ok(())
            }
            INFO | TRACKS if size > MAX_HEADER => walk.skip_to(walk.pos + size),
            INFO => walk.body(size).map(|info| {
                scale = get(&children(&info), TIMESTAMP_SCALE)
                    .map_or(scale, uint)
                    .max(1);
            }),
            TRACKS => match walk.body(size) {
                Ok(tracks) => {
                    track = Some(find_track(&tracks, number)?);
                    Ok(())
                }
                Err(error) => Err(error),
            },
            CLUSTER_TIMESTAMP if size <= 8 => {
                walk.body(size).map(|time| cluster = Some(uint(&time)))
            }
            SIMPLE_BLOCK | BLOCK_GROUP => match (&track, cluster) {
                (Some(track), Some(base)) => walk.block(id, size, number).map(|found| {
                    let Some((body, duration)) = found else {
                        return;
                    };
                    let Some((time, parts)) = frames(&body) else {
                        return;
                    };
                    let unit = scale as f64 / 1e9;
                    let block_start = (base as i64 + time as i64) as f64 * unit;
                    let default = track.default_duration as f64 / 1e9;
                    for (i, frame) in parts.into_iter().enumerate() {
                        let Some(data) = decode(frame, &track.encodings) else {
                            continue;
                        };
                        let line = String::from_utf8_lossy(&data);
                        // ASS in Matroska: ReadOrder, Layer, Style, Name, MarginL, MarginR,
                        // MarginV, Effect, Text. The order is fixed, so CodecPrivate is not needed.
                        let text = if track.ass {
                            line.splitn(9, ',').nth(8).unwrap_or_default()
                        } else {
                            &*line
                        };
                        let start = block_start + i as f64 * default;
                        let end = start + duration.map_or(default, |ticks| ticks as f64 * unit);
                        text_bytes += text.len();
                        cues.push(Cue {
                            start,
                            end,
                            text: text.to_string(),
                        });
                    }
                }),
                _ => walk.skip_to(walk.pos + size),
            },
            _ => walk.skip_to(walk.pos + size),
        };
        if step.is_err() {
            break;
        }
    }
    if track.is_none() {
        return Err("track-not-found");
    }
    cues.truncate(MAX_CUES);
    cues.sort_by(|a, b| a.start.total_cmp(&b.start));
    Ok(cues)
}

/// The cues of Matroska track `track` (mpv's `track-list/N/src-id`) in the playing file:
/// `source` is mpv's `path`, a local file or the torrent stream izumi serves. Errors are codes
/// the plugin host passes on: remote-stream, not-matroska, track-not-found, not-text, encrypted,
/// unsupported-compression, read-failed.
#[tauri::command]
pub async fn embedded_subtitle_cues(
    app: tauri::AppHandle,
    source: String,
    track: u64,
) -> Result<Vec<Cue>, String> {
    let path = match crate::direct_torrent::player_stream_path(&app, &source).await {
        Some(path) => path,
        // shortcut: http(s) streams would need the whole file over the network; mkvmerge files
        // index their subtitle blocks in Cues, which could read just those with range requests.
        None if Path::new(&source).is_absolute() => PathBuf::from(source),
        None => return Err("remote-stream".into()),
    };
    tauri::async_runtime::spawn_blocking(move || {
        read_cues(std::fs::File::open(path).map_err(|_| "read-failed")?, track)
    })
    .await
    .map_err(|_| "read-failed")?
    .map_err(String::from)
}

#[cfg(test)]
mod tests {
    use super::*;
    use flate2::{write::ZlibEncoder, Compression};
    use std::io::{Cursor, Write};

    fn el(id: u64, body: &[u8]) -> Vec<u8> {
        let mut out: Vec<u8> = id
            .to_be_bytes()
            .into_iter()
            .skip_while(|b| *b == 0)
            .collect();
        out.push(0x01);
        out.extend_from_slice(&(body.len() as u64).to_be_bytes()[1..]);
        out.extend_from_slice(body);
        out
    }

    fn unknown_size(id: u64, body: &[u8]) -> Vec<u8> {
        let mut out: Vec<u8> = id
            .to_be_bytes()
            .into_iter()
            .skip_while(|b| *b == 0)
            .collect();
        out.push(0xFF);
        out.extend_from_slice(body);
        out
    }

    fn zlib(data: &[u8]) -> Vec<u8> {
        let mut encoder = ZlibEncoder::new(Vec::new(), Compression::default());
        encoder.write_all(data).unwrap();
        encoder.finish().unwrap()
    }

    /// A Block body: track number vint, relative time, flags, data.
    fn block(track: u8, time: i16, flags: u8, data: &[u8]) -> Vec<u8> {
        [&[0x80 | track], &time.to_be_bytes()[..], &[flags], data].concat()
    }

    fn group(track: u8, time: i16, duration: u8, data: &[u8]) -> Vec<u8> {
        el(
            BLOCK_GROUP,
            &[
                el(BLOCK, &block(track, time, 0, data)),
                el(BLOCK_DURATION, &[duration]),
            ]
            .concat(),
        )
    }

    fn entry(number: u8, codec: &str, extra: &[u8]) -> Vec<u8> {
        el(
            TRACK_ENTRY,
            &[
                el(TRACK_NUMBER, &[number]),
                el(CODEC_ID, codec.as_bytes()),
                extra.to_vec(),
            ]
            .concat(),
        )
    }

    fn zlib_encoding() -> Vec<u8> {
        el(
            CONTENT_ENCODINGS,
            &el(
                CONTENT_ENCODING,
                &el(CONTENT_COMPRESSION, &el(CONTENT_COMP_ALGO, &[0])),
            ),
        )
    }

    /// TimestampScale 10 ms. Track 1 video, 2 ASS (zlib), 3 ASS (plain). The first cluster has a
    /// big video frame and ASS lines as BlockGroups; the second has an unknown size.
    fn mkv() -> Vec<u8> {
        let ass = |text: &str| format!("0,0,Default,,0,0,0,,{text}");
        let tracks = [
            entry(1, "V_MPEG4/ISO/AVC", &[]),
            entry(2, "S_TEXT/ASS", &zlib_encoding()),
            entry(3, "S_TEXT/ASS", &[]),
        ]
        .concat();
        let first = [
            el(CLUSTER_TIMESTAMP, &[100]),
            el(SIMPLE_BLOCK, &block(1, 0, 0x80, &[0x1F; 100_000])),
            group(
                2,
                50,
                200,
                &zlib(ass("{\\i1}Hello,\\Nworld{\\i0}").as_bytes()),
            ),
            group(3, 50, 200, ass("Plain, with commas").as_bytes()),
        ]
        .concat();
        let second = [
            el(CLUSTER_TIMESTAMP, &[0x01, 0x2C]), // 300 → 3 s
            group(2, 0, 100, &zlib(ass("Second line").as_bytes())),
            el(SIMPLE_BLOCK, &block(1, 10, 0x80, &[0; 5_000])),
        ]
        .concat();
        let segment = [
            el(INFO, &el(TIMESTAMP_SCALE, &10_000_000u32.to_be_bytes())),
            el(TRACKS, &tracks),
            el(CLUSTER, &first),
            unknown_size(CLUSTER, &second),
        ]
        .concat();
        [el(EBML, &[]), unknown_size(SEGMENT, &segment)].concat()
    }

    fn lines(cues: &[Cue]) -> Vec<(f64, f64, &str)> {
        cues.iter()
            .map(|c| {
                (
                    (c.start * 1000.0).round() / 1000.0,
                    (c.end * 1000.0).round() / 1000.0,
                    c.text.as_str(),
                )
            })
            .collect()
    }

    #[test]
    fn reads_a_zlib_ass_track() {
        let cues = read_cues(Cursor::new(mkv()), 2).unwrap();
        assert_eq!(
            lines(&cues),
            [
                (1.5, 3.5, "{\\i1}Hello,\\Nworld{\\i0}"),
                (3.0, 4.0, "Second line")
            ]
        );
    }

    #[test]
    fn reads_a_plain_ass_track() {
        let cues = read_cues(Cursor::new(mkv()), 3).unwrap();
        assert_eq!(lines(&cues), [(1.5, 3.5, "Plain, with commas")]);
    }

    #[test]
    fn refuses_tracks_that_are_not_text() {
        assert_eq!(read_cues(Cursor::new(mkv()), 1).unwrap_err(), "not-text");
        assert_eq!(
            read_cues(Cursor::new(mkv()), 9).unwrap_err(),
            "track-not-found"
        );
        assert_eq!(
            read_cues(Cursor::new(b"RIFF....".to_vec()), 2).unwrap_err(),
            "not-matroska"
        );
    }

    #[test]
    fn skips_a_hole_to_the_next_cluster() {
        let mut file = mkv();
        // Zero out the first cluster from its first ASS block on, as a torrent piece not yet downloaded.
        let first_ass = file.windows(2).position(|w| w == [0xA0, 0x01]).unwrap();
        let second_cluster = file
            .windows(4)
            .rposition(|w| w == [0x1F, 0x43, 0xB6, 0x75])
            .unwrap();
        file[first_ass..second_cluster].fill(0);
        let cues = read_cues(Cursor::new(file), 2).unwrap();
        assert_eq!(lines(&cues), [(3.0, 4.0, "Second line")]);
    }

    #[test]
    fn splits_laced_frames() {
        let split = |lacing: u8, sizes: &[u8]| {
            let mut body = vec![0, 0, lacing << 1, 2];
            body.extend_from_slice(sizes);
            body.extend_from_slice(b"aaabbcccc");
            frames(&body)
                .unwrap()
                .1
                .iter()
                .map(|f| f.to_vec())
                .collect::<Vec<_>>()
        };
        let want = [b"aaa".to_vec(), b"bb".to_vec(), b"cccc".to_vec()];
        assert_eq!(split(1, &[3, 2]), want); // Xiph
        assert_eq!(split(3, &[0x83, 0xBE]), want); // EBML: 3, then -1 (signed, biased by 63)
        assert_eq!(
            &split(2, &[])[..],
            [b"aaa".to_vec(), b"bbc".to_vec(), b"ccc".to_vec()]
        ); // fixed
    }

    #[test]
    fn undoes_header_stripping() {
        assert_eq!(decode(b"lo", &[(3, b"Hel".to_vec())]).unwrap(), b"Hello");
        assert_eq!(decode(&zlib(b"Hi"), &[(0, Vec::new())]).unwrap(), b"Hi");
    }

    /// `IZUMI_MKV=<file> IZUMI_MKV_TRACK=<n> cargo test --lib real_file -- --ignored --nocapture`
    #[test]
    #[ignore]
    fn real_file() {
        let path = std::env::var("IZUMI_MKV").unwrap();
        let track = std::env::var("IZUMI_MKV_TRACK").map_or(3, |t| t.parse().unwrap());
        let started = std::time::Instant::now();
        let cues = read_cues(std::fs::File::open(path).unwrap(), track).unwrap();
        println!("{} cues in {:?}", cues.len(), started.elapsed());
        for cue in cues.iter().take(5).chain(cues.last()) {
            println!("{:.2} → {:.2} {}", cue.start, cue.end, cue.text);
        }
    }
}
