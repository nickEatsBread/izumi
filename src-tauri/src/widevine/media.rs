//! The two kinds of stream mpv reads through `izcr://`:
//! - [`Track`]: an encrypted on-demand file served byte-identical but clear. Fragments are fetched by
//!   HTTP range, decrypted on the module thread, kept in a small RAM cache and zeroed on eviction.
//! - [`RawVideo`]: video the module decrypts AND decodes. I420 pictures are served as raw video
//!   (`demuxer=rawvideo`): picture N lives at byte N * picture size. A seek resets the module's
//!   decoder and decodes forward from the IDR that starts the fragment holding the target.
//!
//! Nothing here touches the disk; every buffer that held clear media is zeroed before it is freed.
use anyhow::{anyhow, bail, ensure, Context, Result};
use std::collections::{HashMap, HashSet, VecDeque};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Condvar, Mutex};
use std::time::{Duration, Instant};

use super::cdm::{Cdm, Picture, Refused};
use super::fmp4::{self, Head, Sample};

/// Bytes read from the start of a file to find ftyp, moov and the sidx.
const HEAD_BYTES: u64 = 64 * 1024;
const HEAD_BYTES_MAX: u64 = 1024 * 1024;
const TRACK_CACHE_FRAGMENTS: usize = 4;
/// Pictures kept after decoding: covers mpv re-reading the picture it is on and some reordering.
const KEEP_PICTURES: usize = 6;
/// Further ahead than this, re-seeking from the fragment's IDR is cheaper than decoding forward.
const FORWARD_FRAMES: u64 = 48;
/// Encrypted video fragments fetched ahead of the decoder.
const VIDEO_PREFETCH: usize = 2;

/// Interrupts a blocked read when mpv cancels the stream (seek, stop, file change).
#[derive(Default)]
pub struct Cancel {
    flag: AtomicBool,
    notify: tokio::sync::Notify,
}

impl Cancel {
    pub fn cancel(&self) {
        self.flag.store(true, Ordering::SeqCst);
        self.notify.notify_waiters();
    }
    pub fn is_cancelled(&self) -> bool {
        self.flag.load(Ordering::SeqCst)
    }
}

/// Zeroes clear media before its memory is released.
struct Clear(Vec<u8>);
impl Drop for Clear {
    fn drop(&mut self) {
        self.0.fill(0);
    }
}

/// HTTP range reads of one media file, or reads of a saved copy of it (a download).
#[derive(Clone)]
pub struct Remote {
    http: reqwest::Client,
    url: String,
    local: Option<std::path::PathBuf>,
}

impl Remote {
    pub fn new(http: reqwest::Client, url: String) -> Remote {
        Remote { http, url, local: None }
    }

    /// A media file saved on this device. It is stored as the source sent it, still encrypted, and
    /// is decrypted in memory on the way to the player exactly like a streamed one.
    pub fn local(http: reqwest::Client, path: std::path::PathBuf) -> Remote {
        Remote { http, url: path.display().to_string(), local: Some(path) }
    }

    /// Bytes `from..=to` and the file's total size from Content-Range.
    pub async fn range(&self, from: u64, to: u64) -> Result<(Vec<u8>, Option<u64>)> {
        if let Some(path) = &self.local {
            return read_local(path, from, to);
        }
        let mut last = anyhow!("not fetched");
        for attempt in 0..3u64 {
            if attempt > 0 {
                tokio::time::sleep(Duration::from_millis(250 * attempt)).await;
            }
            let res = match self.http.get(&self.url).header("Range", format!("bytes={from}-{to}")).send().await {
                Ok(res) => res,
                Err(e) => {
                    last = e.into();
                    continue;
                }
            };
            let status = res.status();
            if status.is_client_error() && status.as_u16() != 408 && status.as_u16() != 429 {
                bail!("media request failed with HTTP {status}");
            }
            if !status.is_success() {
                last = anyhow!("media request failed with HTTP {status}");
                continue;
            }
            ensure!(status.as_u16() == 206 || from == 0, "the media server ignored the byte range");
            let total = res
                .headers()
                .get("content-range")
                .and_then(|v| v.to_str().ok())
                .and_then(|v| v.rsplit('/').next())
                .and_then(|v| v.parse().ok());
            match res.bytes().await {
                Ok(body) => {
                    let body = body.to_vec();
                    let want = to - from + 1;
                    ensure!(body.len() as u64 == want || total.is_some_and(|t| from + body.len() as u64 == t), "short range read");
                    return Ok((body, total));
                }
                Err(e) => last = e.into(),
            }
        }
        Err(last)
    }

    /// Blocking range read for mpv's stream threads, abandoned as soon as `cancel` fires.
    fn range_blocking(&self, from: u64, to: u64, cancel: Option<&Cancel>) -> Result<Vec<u8>> {
        if cancel.is_some_and(Cancel::is_cancelled) {
            bail!("cancelled");
        }
        tauri::async_runtime::block_on(async {
            match cancel {
                Some(c) => tokio::select! {
                    r = self.range(from, to) => r.map(|(b, _)| b),
                    _ = c.notify.notified() => Err(anyhow!("cancelled")),
                },
                None => self.range(from, to).await.map(|(b, _)| b),
            }
        })
    }

    /// The file head (ftyp + moov + sidx), parsed and with encryption removed, plus the file size.
    pub async fn head(&self) -> Result<(Head, u64)> {
        let mut want = HEAD_BYTES;
        loop {
            let (bytes, total) = self.range(0, want - 1).await?;
            let total = total.context("the media server sent no Content-Range total")?;
            match fmp4::parse_head(&bytes) {
                Ok(head) => {
                    let last = head.fragments.last().map(|(s, l)| s + l).unwrap_or(0);
                    ensure!(last <= total, "the file index runs past the end of the file");
                    return Ok((head, total));
                }
                Err(e) if want < HEAD_BYTES_MAX && (bytes.len() as u64) == want => {
                    // The index may sit further in than the first read reached.
                    want *= 4;
                    let _ = e;
                }
                Err(e) => return Err(e),
            }
        }
    }
}

/// Bytes `from..=to` of a saved file (fewer at its end) and its size.
fn read_local(path: &std::path::Path, from: u64, to: u64) -> Result<(Vec<u8>, Option<u64>)> {
    use std::io::{Read, Seek, SeekFrom};
    let mut file = std::fs::File::open(path).with_context(|| format!("the downloaded file {} could not be opened", path.display()))?;
    let total = file.metadata()?.len();
    ensure!(from < total, "read past the end of the downloaded file");
    let end = to.min(total - 1);
    file.seek(SeekFrom::Start(from))?;
    let mut out = vec![0u8; (end - from + 1) as usize];
    file.read_exact(&mut out)?;
    Ok((out, Some(total)))
}

/// Called once when the module refuses a video sample the hardware path asked it to decrypt.
pub type OnRefused = Arc<dyn Fn() + Send + Sync>;

pub struct Track {
    remote: Remote,
    pub total: u64,
    head: Head,
    cdm: Arc<Cdm>,
    cache: Mutex<VecDeque<(usize, Arc<Clear>)>>,
    inflight: Mutex<HashSet<usize>>,
    ready: Condvar,
    on_refused: Option<OnRefused>,
    refused: AtomicBool,
}

impl Track {
    pub fn new(remote: Remote, head: Head, total: u64, cdm: Arc<Cdm>, on_refused: Option<OnRefused>) -> Arc<Track> {
        Arc::new(Track {
            remote,
            total,
            head,
            cdm,
            cache: Mutex::new(VecDeque::new()),
            inflight: Mutex::new(HashSet::new()),
            ready: Condvar::new(),
            on_refused,
            refused: AtomicBool::new(false),
        })
    }

    fn cached(&self, idx: usize) -> Option<Arc<Clear>> {
        self.cache.lock().ok()?.iter().find(|(i, _)| *i == idx).map(|(_, c)| c.clone())
    }

    fn fragment(&self, idx: usize, cancel: Option<&Cancel>) -> Result<Arc<Clear>> {
        loop {
            if let Some(c) = self.cached(idx) {
                return Ok(c);
            }
            if cancel.is_some_and(Cancel::is_cancelled) {
                bail!("cancelled");
            }
            let mut inflight = self.inflight.lock().map_err(|_| anyhow!("track lock poisoned"))?;
            if inflight.contains(&idx) {
                let (guard, _) = self.ready.wait_timeout(inflight, Duration::from_millis(200)).map_err(|_| anyhow!("track lock poisoned"))?;
                drop(guard);
                continue;
            }
            inflight.insert(idx);
            break;
        }
        let result = self.load(idx, cancel);
        if let Ok(mut inflight) = self.inflight.lock() {
            inflight.remove(&idx);
        }
        self.ready.notify_all();
        result
    }

    fn load(&self, idx: usize, cancel: Option<&Cancel>) -> Result<Arc<Clear>> {
        let (start, size) = self.head.fragments[idx];
        let mut frag = self.remote.range_blocking(start, start + size - 1, cancel)?;
        let samples = match fmp4::plan_fragment(&mut frag, self.head.iv_size) {
            Ok(samples) => samples,
            Err(e) => {
                frag.fill(0);
                return Err(e);
            }
        };
        let (data, result) = self.cdm.decrypt(frag, vec![self.head.default_kid], samples);
        let clear = Arc::new(Clear(data));
        if let Err(e) = result {
            if e.downcast_ref::<Refused>().is_some() && !self.refused.swap(true, Ordering::SeqCst) {
                if let Some(cb) = &self.on_refused {
                    cb();
                }
            }
            return Err(e);
        }
        let mut cache = self.cache.lock().map_err(|_| anyhow!("track lock poisoned"))?;
        cache.push_back((idx, clear.clone()));
        while cache.len() > TRACK_CACHE_FRAGMENTS {
            cache.pop_front();
        }
        Ok(clear)
    }

    fn prefetch(self: &Arc<Self>, idx: usize) {
        if idx >= self.head.fragments.len() || self.cached(idx).is_some() || self.inflight.lock().map_or(true, |i| i.contains(&idx)) {
            return;
        }
        let me = self.clone();
        let _ = std::thread::Builder::new().name("izcr-prefetch".into()).spawn(move || {
            let _ = me.fragment(idx, None);
        });
    }

    pub fn read_at(self: &Arc<Self>, pos: u64, out: &mut [u8], cancel: &Cancel) -> Result<usize> {
        if pos >= self.total || out.is_empty() {
            return Ok(0);
        }
        let header = self.head.header.len() as u64;
        if pos < header {
            let n = out.len().min((header - pos) as usize);
            out[..n].copy_from_slice(&self.head.header[pos as usize..pos as usize + n]);
            return Ok(n);
        }
        let frags = &self.head.fragments;
        let idx = frags.partition_point(|(s, l)| s + l <= pos);
        if idx >= frags.len() || pos < frags[idx].0 {
            // Bytes outside every fragment (a trailing index, say): pass them through unchanged.
            let to = (pos + out.len() as u64 - 1).min(self.total - 1);
            let bytes = self.remote.range_blocking(pos, to, Some(cancel))?;
            let n = bytes.len().min(out.len());
            out[..n].copy_from_slice(&bytes[..n]);
            return Ok(n);
        }
        let clear = self.fragment(idx, Some(cancel))?;
        self.prefetch(idx + 1);
        let within = (pos - frags[idx].0) as usize;
        let n = out.len().min(clear.0.len() - within);
        out[..n].copy_from_slice(&clear.0[within..within + n]);
        Ok(n)
    }
}

/// SPS/PPS from an AVCDecoderConfigurationRecord as Annex B, plus the cdm::VideoCodecProfile.
pub use super::fmp4::param_sets;

/// Rewrites 4-byte NAL lengths to Annex B start codes in place (same size), refusing any length
/// field that is not in a clear subsample range.
pub use super::fmp4::to_annex_b;

type Fetched = Arc<(Clear, Vec<Sample>)>;

/// Encrypted video fragments fetched in the background, ahead of the decoder.
#[derive(Clone)]
struct Prefetcher {
    remote: Remote,
    fragments: Arc<Vec<(u64, u64)>>,
    iv_size: u8,
    ready: Arc<Mutex<HashMap<usize, Fetched>>>,
    inflight: Arc<Mutex<HashSet<usize>>>,
}

impl Prefetcher {
    fn fetch(&self, f: usize, cancel: Option<&Cancel>) -> Result<Fetched> {
        let (start, size) = self.fragments[f];
        let mut bytes = self.remote.range_blocking(start, start + size - 1, cancel)?;
        let samples = fmp4::plan_fragment(&mut bytes, self.iv_size)?;
        Ok(Arc::new((Clear(bytes), samples)))
    }

    fn ahead(&self, f: usize) {
        if f >= self.fragments.len() || self.ready.lock().map_or(true, |r| r.contains_key(&f)) || !self.inflight.lock().is_ok_and(|mut i| i.insert(f)) {
            return;
        }
        let me = self.clone();
        let _ = std::thread::Builder::new().name("izcr-prefetch".into()).spawn(move || {
            if let Ok(v) = me.fetch(f, None) {
                if let Ok(mut ready) = me.ready.lock() {
                    ready.insert(f, v);
                    // Keep only what is still ahead of (or at) the decoder.
                    while ready.len() > VIDEO_PREFETCH + 1 {
                        let Some(oldest) = ready.keys().min().copied() else { break };
                        ready.remove(&oldest);
                    }
                }
            }
            if let Ok(mut inflight) = me.inflight.lock() {
                inflight.remove(&f);
            }
        });
    }

    /// Fragment f, from the prefetch cache, an in-flight fetch, or a direct fetch.
    fn get(&self, f: usize, cancel: &Cancel) -> Result<Fetched> {
        loop {
            if let Some(v) = self.ready.lock().map_err(|_| anyhow!("prefetch lock poisoned"))?.remove(&f) {
                return Ok(v);
            }
            if !self.inflight.lock().map_err(|_| anyhow!("prefetch lock poisoned"))?.contains(&f) {
                return self.fetch(f, Some(cancel));
            }
            if cancel.is_cancelled() {
                bail!("cancelled");
            }
            std::thread::sleep(Duration::from_millis(5));
        }
    }
}

/// Recycled picture buffers: a 1080p I420 picture is 3 MB, so allocating, zero-filling and freeing
/// one per frame is real work. Buffers are zeroed when they leave the pool for good.
struct PicturePool(Mutex<Vec<Vec<u8>>>);
const POOL_MAX: usize = KEEP_PICTURES + 4;

impl PicturePool {
    fn take(&self, size: usize) -> Vec<u8> {
        match self.0.lock().ok().and_then(|mut p| p.pop()) {
            Some(buf) if buf.len() == size => buf,
            Some(mut other) => {
                other.fill(0);
                vec![0; size]
            }
            None => vec![0; size],
        }
    }
    fn give(&self, mut buf: Vec<u8>) {
        if buf.is_empty() {
            return;
        }
        if let Ok(mut free) = self.0.lock() {
            if free.len() < POOL_MAX {
                free.push(buf);
                return;
            }
        }
        buf.fill(0);
    }
}

impl Drop for PicturePool {
    fn drop(&mut self) {
        if let Ok(free) = self.0.get_mut() {
            for buf in free.iter_mut() {
                buf.fill(0);
            }
        }
    }
}

struct Pic {
    idx: u64,
    data: Vec<u8>,
    pool: Arc<PicturePool>,
}

impl Drop for Pic {
    fn drop(&mut self) {
        self.pool.give(std::mem::take(&mut self.data));
    }
}

struct State {
    frag: Option<(usize, Fetched)>,
    next: (usize, usize),
    fresh: bool,
    drained: bool,
    out: VecDeque<Arc<Pic>>,
    produced: Option<u64>,
}

pub struct RawVideo {
    cdm: Arc<Cdm>,
    head: Head,
    pub width: u32,
    pub height: u32,
    pub frame_size: u64,
    pub total: u64,
    /// Frame rate as timescale / frame duration, for `demuxer-rawvideo-fps`.
    pub fps: f64,
    frame_dur: u64,
    pts0: i64,
    frag_start_frame: Vec<u64>,
    param_sets: Vec<u8>,
    prefetch: Prefetcher,
    pool: Arc<PicturePool>,
    state: Mutex<State>,
    decoded: AtomicU64,
    decode_ns: AtomicU64,
}

impl RawVideo {
    /// `first` is the fragment playback opens in (index and its bytes, still encrypted), fetched while
    /// the licence was out; without one the stream opens on fragment 0. Its samples give the frame
    /// timing, and the decoder starts on it.
    pub async fn open(remote: Remote, head: Head, cdm: Arc<Cdm>, first: Option<(usize, Vec<u8>)>) -> Result<Arc<RawVideo>> {
        ensure!(&head.format == b"avc1" || &head.format == b"avc3", "the module decodes H.264 only; this video is {}", String::from_utf8_lossy(&head.format));
        let avcc = head.avcc.clone().context("video track has no avcC")?;
        let (profile, param_sets) = param_sets(&avcc)?;
        let (width, height) = (head.width, head.height);
        ensure!(width > 0 && height > 0 && head.timescale > 0, "missing video size or timescale");
        let prefetch = Prefetcher {
            remote: remote.clone(),
            fragments: Arc::new(head.fragments.clone()),
            iv_size: head.iv_size,
            ready: Arc::new(Mutex::new(HashMap::new())),
            inflight: Arc::new(Mutex::new(HashSet::new())),
        };
        let (index, mut bytes) = match first {
            Some((index, bytes)) if index < head.fragments.len() => (index, bytes),
            _ => {
                let (start, size) = head.fragments[0];
                (0, remote.range(start, start + size - 1).await?.0)
            }
        };
        let samples = fmp4::plan_fragment(&mut bytes, head.iv_size)?;
        let first: Fetched = Arc::new((Clear(bytes), samples));
        let frame_dur = first.1.first().map(|s| s.duration as u64).filter(|d| *d > 0).context("no sample duration")?;
        let mut frag_start_frame = Vec::with_capacity(head.fragment_durations.len());
        let mut cum = 0u64;
        for d in &head.fragment_durations {
            frag_start_frame.push((cum as f64 / frame_dur as f64).round() as u64);
            cum += d;
        }
        // Every fragment opens on an IDR, so the earliest picture of this one is its first frame.
        let pts0 = first.1.iter().map(|s| s.dts as i64 + s.cto).min().unwrap_or(0) - frag_start_frame[index] as i64 * frame_dur as i64;
        let frames = (cum as f64 / frame_dur as f64).round() as u64;
        let frame_size = width as u64 * height as u64 + 2 * (width as u64).div_ceil(2) * (height as u64).div_ceil(2);
        let init = {
            let cdm = cdm.clone();
            tauri::async_runtime::spawn_blocking(move || cdm.video_init(profile, width as i32, height as i32, avcc)).await.map_err(|e| anyhow!("{e}"))?
        };
        init?;
        Ok(Arc::new(RawVideo {
            fps: head.timescale as f64 / frame_dur as f64,
            cdm,
            width,
            height,
            frame_size,
            total: frames * frame_size,
            frame_dur,
            pts0,
            frag_start_frame,
            param_sets,
            state: Mutex::new(State { frag: Some((index, first)), next: (index, 0), fresh: true, drained: false, out: VecDeque::new(), produced: None }),
            prefetch,
            pool: Arc::new(PicturePool(Mutex::new(Vec::new()))),
            decoded: AtomicU64::new(0),
            decode_ns: AtomicU64::new(0),
            head,
        }))
    }

    pub fn read_at(&self, pos: u64, out: &mut [u8], cancel: &Cancel) -> Result<usize> {
        if pos >= self.total || out.is_empty() {
            return Ok(0);
        }
        let pic = self.picture(pos / self.frame_size, cancel)?;
        let within = (pos % self.frame_size) as usize;
        let n = out.len().min(pic.data.len() - within);
        out[..n].copy_from_slice(&pic.data[within..within + n]);
        Ok(n)
    }

    fn picture(&self, k: u64, cancel: &Cancel) -> Result<Arc<Pic>> {
        let mut st = self.state.lock().map_err(|_| anyhow!("video lock poisoned"))?;
        if let Some(p) = st.out.iter().find(|p| p.idx == k) {
            return Ok(p.clone());
        }
        let behind = st.out.front().is_some_and(|p| k < p.idx);
        let far = match st.produced {
            Some(p) => k > p + FORWARD_FRAMES,
            // Nothing decoded yet (a fresh stream opened at a resume point, or just after a reset):
            // start at the fragment that holds `k` unless the decoder already sits at its start.
            None => st.next != (self.fragment_of(k), 0),
        };
        if behind || far {
            self.reset(&mut st, k)?;
        }
        loop {
            // A picture at or past k (the first one when a frame index is skipped) ends the search.
            if let Some(p) = st.out.iter().find(|p| p.idx >= k) {
                return Ok(p.clone());
            }
            if cancel.is_cancelled() {
                bail!("cancelled");
            }
            self.feed_one(&mut st, cancel)?;
        }
    }

    /// `seconds`, moved back to the first frame of its fragment: opening there, the first picture
    /// needs one decode instead of every frame from the fragment's IDR up to `seconds`. A quarter
    /// frame in, so mpv's frame rounding cannot land on the fragment before.
    pub fn snap_to_fragment(&self, seconds: f64) -> f64 {
        let frame = (seconds * self.fps).max(0.0) as u64;
        (self.frag_start_frame[self.fragment_of(frame)] as f64 + 0.25) / self.fps
    }

    /// The fragment whose leading IDR starts the decode for picture `k`.
    fn fragment_of(&self, k: u64) -> usize {
        self.frag_start_frame.partition_point(|s| *s <= k).saturating_sub(1)
    }

    fn reset(&self, st: &mut State, k: u64) -> Result<()> {
        self.cdm.video_reset()?;
        st.out.clear();
        st.produced = None;
        st.fresh = true;
        st.drained = false;
        st.next = (self.fragment_of(k), 0);
        Ok(())
    }

    fn feed_one(&self, st: &mut State, cancel: &Cancel) -> Result<()> {
        let (f, i) = st.next;
        let frame_bytes = self.frame_size as usize;
        if f >= self.head.fragments.len() {
            ensure!(!st.drained, "end of video");
            let (buf, pic) = self.cdm.video_decode(self.head.default_kid, vec![0; 8], Vec::new(), None, 0, self.pool.take(frame_bytes));
            match pic? {
                Some(pic) => self.push(st, pic, buf)?,
                None => {
                    self.pool.give(buf);
                    st.drained = true;
                }
            }
            return Ok(());
        }
        if st.frag.as_ref().map(|(idx, _)| *idx) != Some(f) {
            st.frag = Some((f, self.prefetch.get(f, cancel)?));
        }
        if i == 0 {
            for ahead in 1..=VIDEO_PREFETCH {
                self.prefetch.ahead(f + ahead);
            }
        }
        let fetched = st.frag.as_ref().map(|(_, v)| v.clone()).context("no fragment")?;
        let (bytes, samples) = (&fetched.0 .0, &fetched.1);
        let sample = samples.get(i).cloned().ok_or_else(|| anyhow!("sample {i} missing in fragment {f}"))?;
        let next = if i + 1 < samples.len() { (f, i + 1) } else { (f + 1, 0) };
        let mut data = bytes.get(sample.offset..sample.offset + sample.size).context("sample outside its fragment")?.to_vec();
        let mut subsamples = sample.subsamples.clone();
        to_annex_b(&mut data, &subsamples)?;
        if st.fresh {
            // After a reset the decoder needs SPS/PPS before the IDR; they are clear bytes.
            let prefix = self.param_sets.len() as u32;
            data.splice(0..0, self.param_sets.iter().copied());
            if let Some(first) = subsamples.first_mut() {
                first.0 += prefix;
            }
            st.fresh = false;
        }
        let ts_us = ((sample.dts as i64 + sample.cto) as i128 * 1_000_000 / self.head.timescale as i128) as i64;
        let started = Instant::now();
        let (buf, pic) = self.cdm.video_decode(self.head.default_kid, sample.iv, subsamples, Some(data), ts_us, self.pool.take(frame_bytes));
        self.decode_ns.fetch_add(started.elapsed().as_nanos() as u64, Ordering::Relaxed);
        st.next = next;
        if next.0 != f {
            st.frag = None;
        }
        match pic? {
            Some(pic) => self.push(st, pic, buf)?,
            None => self.pool.give(buf),
        }
        Ok(())
    }

    fn push(&self, st: &mut State, pic: Picture, buf: Vec<u8>) -> Result<()> {
        // Built first so the buffer returns to the pool on every early exit.
        let mut picture = Pic { idx: 0, data: buf, pool: self.pool.clone() };
        ensure!(pic.width as u32 == self.width && pic.height as u32 == self.height, "decoder size changed to {}x{}", pic.width, pic.height);
        self.decoded.fetch_add(1, Ordering::Relaxed);
        let units = (pic.ts_us as i128 * self.head.timescale as i128 / 1_000_000) as i64;
        let idx = ((units - self.pts0) as f64 / self.frame_dur as f64).round();
        if idx < 0.0 {
            return Ok(());
        }
        picture.idx = idx as u64;
        st.produced = Some(st.produced.map_or(picture.idx, |p| p.max(picture.idx)));
        st.out.push_back(Arc::new(picture));
        while st.out.len() > KEEP_PICTURES {
            st.out.pop_front();
        }
        Ok(())
    }
}

impl Drop for RawVideo {
    fn drop(&mut self) {
        let n = self.decoded.load(Ordering::Relaxed);
        if n > 0 {
            let ms = self.decode_ns.load(Ordering::Relaxed) as f64 / 1e6 / n as f64;
            eprintln!("[widevine] module decoded {n} pictures, {ms:.1} ms each on its thread");
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn annex_b_rewrites_clear_lengths_only() {
        // Two NALs: a 3-byte NAL then a 6-byte slice; one subsample (13 clear, 4 cipher).
        let mut data = vec![0, 0, 0, 3, 9, 1, 2, 0, 0, 0, 6, 0x65, 7, 8, 9, 10, 11];
        to_annex_b(&mut data, &[(13, 4)]).unwrap();
        assert_eq!(&data[..4], &[0, 0, 0, 1]);
        assert_eq!(&data[7..11], &[0, 0, 0, 1]);
        let mut hidden = vec![0, 0, 0, 3, 9, 1, 2, 0, 0, 0, 6, 0x65, 7, 8, 9, 10, 11];
        assert!(to_annex_b(&mut hidden, &[(5, 12)]).is_err(), "second length is encrypted");
        let mut overrun = vec![0, 0, 0, 40, 9];
        assert!(to_annex_b(&mut overrun, &[(5, 0)]).is_err());
    }

    #[test]
    fn param_sets_become_annex_b() {
        let avcc = [1, 100, 0, 40, 0xff, 0xe1, 0, 3, 0x67, 1, 2, 1, 0, 2, 0x68, 3];
        let (profile, sets) = param_sets(&avcc).unwrap();
        assert_eq!(profile, 5);
        assert_eq!(sets, vec![0, 0, 0, 1, 0x67, 1, 2, 0, 0, 0, 1, 0x68, 3]);
        assert!(param_sets(&avcc[..9]).is_err());
    }

    #[test]
    fn picture_pool_recycles_matching_buffers_only() {
        let pool = PicturePool(Mutex::new(Vec::new()));
        assert_eq!(pool.take(16), vec![0; 16]);
        pool.give(vec![7; 16]);
        assert_eq!(pool.take(16), vec![7; 16], "a recycled buffer is reused as-is");
        pool.give(vec![7; 8]);
        assert_eq!(pool.take(16), vec![0; 16], "a buffer of another size is not handed out");
        for _ in 0..POOL_MAX + 3 {
            pool.give(vec![1; 4]);
        }
        assert_eq!(pool.0.lock().unwrap().len(), POOL_MAX);
    }
}
