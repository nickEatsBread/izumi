//! Minimal ISO-BMFF walker for CENC ('cenc', AES-CTR) on-demand DASH files: ftyp, moov, sidx, then
//! moof+mdat fragments. Decryption keeps every byte offset: samples are decrypted in place and the
//! encryption boxes are renamed (encv→avc1, enca→mp4a, sinf/pssh/senc/saiz/saio/PIFF uuid → free),
//! so the original sidx and trun offsets stay valid and mpv sees an ordinary clear fMP4.
//! Every read is bounds-checked: the input comes from the network.
use anyhow::{anyhow, bail, ensure, Result};

const PIFF_SENC: [u8; 16] = [
    0xa2, 0x39, 0x4f, 0x52, 0x5a, 0x9b, 0x4f, 0x14, 0xa2, 0x44, 0x6c, 0x42, 0x7c, 0x64, 0x8d, 0xf4,
];
const WIDEVINE_SYSTEM_ID: [u8; 16] = [
    0xed, 0xef, 0x8b, 0xa9, 0x79, 0xd6, 0x4a, 0xce, 0xa3, 0xc8, 0x27, 0xdc, 0xd5, 0x1d, 0x21, 0xed,
];

fn bytes<const N: usize>(b: &[u8], o: usize) -> Result<[u8; N]> {
    o.checked_add(N)
        .and_then(|end| b.get(o..end))
        .and_then(|s| s.try_into().ok())
        .ok_or_else(|| anyhow!("truncated box data at {o}"))
}
fn u8at(b: &[u8], o: usize) -> Result<u8> {
    Ok(bytes::<1>(b, o)?[0])
}
fn u16be(b: &[u8], o: usize) -> Result<u16> {
    Ok(u16::from_be_bytes(bytes(b, o)?))
}
fn u32be(b: &[u8], o: usize) -> Result<u32> {
    Ok(u32::from_be_bytes(bytes(b, o)?))
}
fn i32be(b: &[u8], o: usize) -> Result<i32> {
    Ok(i32::from_be_bytes(bytes(b, o)?))
}
fn u64be(b: &[u8], o: usize) -> Result<u64> {
    Ok(u64::from_be_bytes(bytes(b, o)?))
}

#[derive(Clone, Copy, Debug)]
struct Bx {
    start: usize,
    size: usize,
    hdr: usize,
    kind: [u8; 4],
}
impl Bx {
    fn payload(&self) -> usize {
        self.start + self.hdr
    }
    fn end(&self) -> usize {
        self.start + self.size
    }
}

fn boxes(buf: &[u8], start: usize, end: usize) -> Result<Vec<Bx>> {
    walk(buf, start, end, true)
}

/// `strict = false` stops at a box cut off by the end of the buffer instead of failing; used for
/// the file head, whose range read always ends inside the first fragment.
fn walk(buf: &[u8], start: usize, end: usize, strict: bool) -> Result<Vec<Bx>> {
    let end = end.min(buf.len());
    let mut out = Vec::new();
    let mut o = start;
    while o + 8 <= end {
        let mut size = u32be(buf, o)? as usize;
        let kind: [u8; 4] = bytes(buf, o + 4)?;
        let mut hdr = 8;
        if size == 1 {
            ensure!(o + 16 <= end, "truncated large box");
            size = usize::try_from(u64be(buf, o + 8)?).map_err(|_| anyhow!("box too large"))?;
            hdr = 16;
        } else if size == 0 {
            size = end - o;
        }
        if size < hdr || o.checked_add(size).is_none_or(|e| e > end) {
            ensure!(!strict, "box {} at {o} overruns", String::from_utf8_lossy(&kind));
            break;
        }
        out.push(Bx { start: o, size, hdr, kind });
        o += size;
    }
    Ok(out)
}

fn rename(buf: &mut [u8], b: &Bx, to: &[u8; 4]) {
    buf[b.start + 4..b.start + 8].copy_from_slice(to);
}

pub struct Head {
    /// Clear copy of bytes 0..header_end (ftyp, moov with encryption removed, sidx).
    pub header: Vec<u8>,
    /// (file offset, size) of each fragment, from the sidx.
    pub fragments: Vec<(u64, u64)>,
    pub default_kid: [u8; 16],
    pub iv_size: u8,
    /// Media timescale (mdhd) and each fragment's duration in it (from the sidx).
    #[cfg_attr(not(target_os = "linux"), allow(dead_code))]
    pub timescale: u32,
    #[cfg_attr(not(target_os = "linux"), allow(dead_code))]
    pub fragment_durations: Vec<u64>,
    /// AVCDecoderConfigurationRecord and coded size, for video tracks (the Linux module decoder).
    #[cfg_attr(not(target_os = "linux"), allow(dead_code))]
    pub avcc: Option<Vec<u8>>,
    #[cfg_attr(not(target_os = "linux"), allow(dead_code))]
    pub width: u32,
    #[cfg_attr(not(target_os = "linux"), allow(dead_code))]
    pub height: u32,
    /// The protected sample entry's original format (`avc1`, `hev1`, `mp4a`, ...).
    #[cfg_attr(not(target_os = "linux"), allow(dead_code))]
    pub format: [u8; 4],
    /// Widevine pssh boxes found in moov (licence init data when the manifest carries none).
    pub pssh: Vec<u8>,
}

#[derive(Default)]
struct MoovInfo {
    kid: Option<([u8; 16], u8)>,
    timescale: u32,
    avcc: Option<Vec<u8>>,
    width: u32,
    height: u32,
    format: [u8; 4],
    pssh: Vec<u8>,
}

/// Parses the file start (it must reach past the sidx). Box sizes are trusted over any manifest
/// byte ranges, which are off by one on some streams.
pub fn parse_head(buf: &[u8]) -> Result<Head> {
    let mut header = None;
    let mut info = MoovInfo::default();
    let mut fragments = Vec::new();
    let mut fragment_durations = Vec::new();
    let mut work = buf.to_vec();
    for b in walk(buf, 0, buf.len(), false)? {
        match &b.kind {
            b"moov" => info = clear_moov(&mut work, &b)?,
            b"sidx" => {
                let p = b.payload();
                let (first_offset, q) = if u8at(buf, p)? == 0 {
                    (u32be(buf, p + 16)? as u64, p + 20)
                } else {
                    (u64be(buf, p + 20)?, p + 28)
                };
                let count = u16be(buf, q + 2)? as usize;
                let mut at = b.end() as u64 + first_offset;
                for i in 0..count {
                    let e = q + 4 + i * 12;
                    let word = u32be(buf, e)?;
                    ensure!(word >> 31 == 0, "hierarchical sidx is not supported");
                    let size = (word & 0x7fff_ffff) as u64;
                    ensure!(size > 0, "empty sidx reference");
                    fragments.push((at, size));
                    fragment_durations.push(u32be(buf, e + 4)? as u64);
                    at += size;
                }
                header = Some(b.end());
                break;
            }
            _ => {}
        }
    }
    let end = header.ok_or_else(|| anyhow!("no sidx in the first {} bytes", buf.len()))?;
    let (default_kid, iv_size) = info.kid.ok_or_else(|| anyhow!("no encrypted sample entry in moov"))?;
    ensure!(!fragments.is_empty(), "the sidx lists no fragments");
    work.truncate(end);
    Ok(Head {
        header: work,
        fragments,
        default_kid,
        iv_size,
        timescale: info.timescale,
        fragment_durations,
        avcc: info.avcc,
        width: info.width,
        height: info.height,
        format: info.format,
        pssh: info.pssh,
    })
}

/// Renames the protected sample entry back to its original format, hides sinf and pssh, and
/// returns the default KID and per-sample IV size from tenc.
fn clear_moov(buf: &mut [u8], moov: &Bx) -> Result<MoovInfo> {
    let mut info = MoovInfo::default();
    let mut stack = vec![*moov];
    while let Some(b) = stack.pop() {
        for c in boxes(buf, b.payload(), b.end())? {
            match &c.kind {
                b"trak" | b"mdia" | b"minf" | b"stbl" => stack.push(c),
                b"mdhd" => {
                    let p = c.payload();
                    info.timescale = u32be(buf, p + if u8at(buf, p)? == 1 { 20 } else { 12 })?;
                }
                b"pssh" => {
                    if bytes::<16>(buf, c.payload() + 4)? == WIDEVINE_SYSTEM_ID {
                        info.pssh.extend_from_slice(&buf[c.start..c.end()]);
                    }
                    rename(buf, &c, b"free");
                }
                b"stsd" => {
                    for entry in boxes(buf, c.payload() + 8, c.end())? {
                        let skip = match &entry.kind {
                            b"encv" => 78,
                            b"enca" => 28,
                            _ => continue,
                        };
                        if skip == 78 {
                            info.width = u16be(buf, entry.payload() + 24)? as u32;
                            info.height = u16be(buf, entry.payload() + 26)? as u32;
                        }
                        for s in boxes(buf, entry.payload() + skip, entry.end())? {
                            if &s.kind == b"avcC" {
                                info.avcc = Some(buf[s.payload()..s.end()].to_vec());
                            }
                            if &s.kind != b"sinf" {
                                continue;
                            }
                            let mut original = None;
                            let mut tenc = None;
                            for i in boxes(buf, s.payload(), s.end())? {
                                match &i.kind {
                                    b"frma" => original = Some(bytes::<4>(buf, i.payload())?),
                                    b"schm" => ensure!(&bytes::<4>(buf, i.payload() + 4)? == b"cenc", "only the cenc scheme is supported"),
                                    b"schi" => tenc = boxes(buf, i.payload(), i.end())?.into_iter().find(|t| &t.kind == b"tenc"),
                                    _ => {}
                                }
                            }
                            let original = original.ok_or_else(|| anyhow!("sinf without frma"))?;
                            let tenc = tenc.ok_or_else(|| anyhow!("sinf without tenc"))?;
                            let p = tenc.payload();
                            let iv_size = u8at(buf, p + 7)?;
                            ensure!(iv_size == 8 || iv_size == 16, "constant-IV streams are not supported");
                            info.kid = Some((bytes::<16>(buf, p + 8)?, iv_size));
                            info.format = original;
                            rename(buf, &entry, &original);
                            rename(buf, &s, b"free");
                        }
                    }
                }
                _ => {}
            }
        }
    }
    ensure!(info.kid.is_some(), "no protected sample entry");
    Ok(info)
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Sample {
    pub offset: usize,
    pub size: usize,
    pub iv: Vec<u8>,
    /// (clear, cipher) pairs; empty means the whole sample is encrypted.
    pub subsamples: Vec<(u32, u32)>,
    /// Decode time, duration and composition offset, in the media timescale.
    pub dts: u64,
    pub duration: u32,
    pub cto: i64,
}

/// Finds every encrypted sample in one fragment (moof + mdat, offsets relative to the fragment
/// start) and hides the per-fragment encryption boxes. The caller decrypts the samples in place.
pub fn plan_fragment(frag: &mut [u8], iv_size: u8) -> Result<Vec<Sample>> {
    let mut samples = Vec::new();
    let top = boxes(frag, 0, frag.len())?;
    let moof = *top.iter().find(|b| &b.kind == b"moof").ok_or_else(|| anyhow!("fragment without moof"))?;
    for traf in boxes(frag, moof.payload(), moof.end())?.into_iter().filter(|b| &b.kind == b"traf") {
        let base = moof.start;
        let mut default_size = None;
        let mut default_duration = 0u32;
        let mut base_time = 0u64;
        let mut sizes: Vec<usize> = Vec::new();
        let mut timing: Vec<(u32, i64)> = Vec::new();
        let mut data_offset = 0i64;
        let mut ivs: Vec<(Vec<u8>, Vec<(u32, u32)>)> = Vec::new();
        for c in boxes(frag, traf.payload(), traf.end())? {
            let p = c.payload();
            match &c.kind {
                b"tfhd" => {
                    let flags = u32be(frag, p)? & 0xff_ffff;
                    ensure!(flags & 0x1 == 0, "absolute base-data-offset is not supported");
                    let mut q = p + 8;
                    if flags & 0x2 != 0 {
                        q += 4;
                    }
                    if flags & 0x8 != 0 {
                        default_duration = u32be(frag, q)?;
                        q += 4;
                    }
                    if flags & 0x10 != 0 {
                        default_size = Some(u32be(frag, q)? as usize);
                    }
                }
                b"tfdt" => base_time = if u8at(frag, p)? == 1 { u64be(frag, p + 4)? } else { u32be(frag, p + 4)? as u64 },
                b"trun" => {
                    let flags = u32be(frag, p)? & 0xff_ffff;
                    let count = u32be(frag, p + 4)? as usize;
                    ensure!(count <= c.size, "implausible trun sample count {count}");
                    let mut q = p + 8;
                    if flags & 0x1 != 0 {
                        data_offset = i32be(frag, q)? as i64;
                        q += 4;
                    }
                    if flags & 0x4 != 0 {
                        q += 4;
                    }
                    let per = [0x100, 0x200, 0x400, 0x800].iter().filter(|f| flags & **f != 0).count() * 4;
                    let size_at = if flags & 0x100 != 0 { 4 } else { 0 };
                    let cto_at = [0x100, 0x200, 0x400].iter().filter(|f| flags & **f != 0).count() * 4;
                    for i in 0..count {
                        let row = q + i * per;
                        let duration = if flags & 0x100 != 0 { u32be(frag, row)? } else { default_duration };
                        let cto = if flags & 0x800 != 0 { i32be(frag, row + cto_at)? as i64 } else { 0 };
                        timing.push((duration, cto));
                        sizes.push(if flags & 0x200 != 0 {
                            u32be(frag, row + size_at)? as usize
                        } else {
                            default_size.ok_or_else(|| anyhow!("no sample size"))?
                        });
                    }
                }
                b"senc" => {
                    ivs = read_senc(frag, p, iv_size)?;
                    rename(frag, &c, b"free");
                }
                b"saiz" | b"saio" => rename(frag, &c, b"free"),
                b"uuid" if bytes::<16>(frag, p).is_ok_and(|id| id == PIFF_SENC) => rename(frag, &c, b"free"),
                b"sbgp" | b"sgpd" => bail!("sample-group key rotation is not supported"),
                _ => {}
            }
        }
        ensure!(ivs.len() == sizes.len(), "senc covers {} samples, trun has {}", ivs.len(), sizes.len());
        let mut at = usize::try_from(base as i64 + data_offset).map_err(|_| anyhow!("negative data offset"))?;
        let mut dts = base_time;
        for ((size, (iv, subsamples)), (duration, cto)) in sizes.into_iter().zip(ivs).zip(timing) {
            ensure!(at.checked_add(size).is_some_and(|e| e <= frag.len()), "sample overruns fragment");
            if !subsamples.is_empty() {
                let total: u64 = subsamples.iter().map(|(c, e)| *c as u64 + *e as u64).sum();
                ensure!(total == size as u64, "subsamples cover {total} of {size} bytes");
            }
            samples.push(Sample { offset: at, size, iv, subsamples, dts, duration, cto });
            at += size;
            dts += duration as u64;
        }
    }
    Ok(samples)
}

/// SPS/PPS from an AVCDecoderConfigurationRecord as Annex B, plus the cdm::VideoCodecProfile. Used
/// to initialise the module's H.264 decoder (Linux playback, and the Windows decrypt-only unlock).
pub fn param_sets(avcc: &[u8]) -> Result<(u32, Vec<u8>)> {
    use anyhow::Context;
    ensure!(avcc.len() >= 7 && avcc[0] == 1, "bad avcC");
    ensure!(avcc[4] & 3 == 3, "only 4-byte NAL lengths are supported");
    let profile = match avcc[1] {
        66 => 2,
        77 => 3,
        88 => 4,
        100 => 5,
        110 => 6,
        122 => 7,
        244 => 8,
        other => bail!("unsupported H.264 profile_idc {other}"),
    };
    let mut out = Vec::new();
    let mut p = 5;
    for mask in [0x1f, 0xff] {
        let count = (avcc.get(p).copied().context("truncated avcC")? & mask) as usize;
        p += 1;
        for _ in 0..count {
            let len = u16::from_be_bytes([*avcc.get(p).context("truncated avcC")?, *avcc.get(p + 1).context("truncated avcC")?]) as usize;
            p += 2;
            ensure!(p + len <= avcc.len(), "truncated avcC");
            out.extend([0, 0, 0, 1]);
            out.extend(&avcc[p..p + len]);
            p += len;
        }
    }
    Ok((profile, out))
}

/// Rewrites 4-byte NAL lengths to Annex B start codes in place (same size), refusing any length
/// field that is not in a clear subsample range. Prepares a decrypted sample for the module's decoder.
pub fn to_annex_b(data: &mut [u8], subsamples: &[(u32, u32)]) -> Result<()> {
    use anyhow::Context;
    let mut clear = Vec::new();
    let mut at = 0usize;
    for (c, e) in subsamples {
        clear.push((at, at + *c as usize));
        at += (*c + *e) as usize;
    }
    if subsamples.is_empty() {
        bail!("fully encrypted video samples cannot be rewritten for the module's decoder");
    }
    let mut off = 0usize;
    while off < data.len() {
        ensure!(off + 4 <= data.len(), "truncated NAL length at {off}");
        ensure!(clear.iter().any(|(a, b)| off >= *a && off + 4 <= *b), "NAL length at {off} is inside encrypted data");
        let len = u32::from_be_bytes(data[off..off + 4].try_into().unwrap()) as usize;
        data[off..off + 4].copy_from_slice(&[0, 0, 0, 1]);
        off = off.checked_add(4 + len).context("NAL length overflow")?;
    }
    ensure!(off == data.len(), "NAL lengths overrun the sample");
    Ok(())
}

fn read_senc(frag: &[u8], p: usize, iv_size: u8) -> Result<Vec<(Vec<u8>, Vec<(u32, u32)>)>> {
    let flags = u32be(frag, p)? & 0xff_ffff;
    let count = u32be(frag, p + 4)? as usize;
    ensure!(count <= frag.len(), "implausible senc sample count {count}");
    let iv = iv_size as usize;
    let mut q = p + 8;
    let mut out = Vec::with_capacity(count);
    for _ in 0..count {
        let v = frag.get(q..q + iv).ok_or_else(|| anyhow!("truncated senc"))?.to_vec();
        q += iv;
        let mut subs = Vec::new();
        if flags & 0x2 != 0 {
            let n = u16be(frag, q)? as usize;
            q += 2;
            for _ in 0..n {
                subs.push((u16be(frag, q)? as u32, u32be(frag, q + 2)?));
                q += 6;
            }
        }
        out.push((v, subs));
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn bx(kind: &[u8; 4], payload: &[u8]) -> Vec<u8> {
        let mut v = ((8 + payload.len()) as u32).to_be_bytes().to_vec();
        v.extend(kind);
        v.extend(payload);
        v
    }
    fn full(kind: &[u8; 4], flags: u32, body: &[u8]) -> Vec<u8> {
        let mut p = flags.to_be_bytes().to_vec();
        p.extend(body);
        bx(kind, &p)
    }

    fn init() -> Vec<u8> {
        let mut tenc = vec![0, 0, 1, 8];
        tenc.extend([7u8; 16]);
        let sinf = bx(b"sinf", &[bx(b"frma", b"avc1"), full(b"schm", 0, b"cenc\x00\x01\x00\x00"), bx(b"schi", &full(b"tenc", 0, &tenc))].concat());
        let mut encv = vec![0u8; 78];
        encv.extend(bx(b"avcC", &[1, 2, 3]));
        encv.extend(sinf);
        let stsd = full(b"stsd", 0, &[1u32.to_be_bytes().to_vec(), bx(b"encv", &encv)].concat());
        let mut widevine = WIDEVINE_SYSTEM_ID.to_vec();
        widevine.extend(0u32.to_be_bytes());
        let moov = bx(
            b"moov",
            &[bx(b"trak", &bx(b"mdia", &bx(b"minf", &bx(b"stbl", &stsd)))), full(b"pssh", 0, &[0; 20]), full(b"pssh", 0, &widevine)].concat(),
        );
        let mut sidx = vec![0u8; 4]; // reference id
        sidx.extend(1000u32.to_be_bytes()); // timescale
        sidx.extend(0u32.to_be_bytes()); // earliest presentation time
        sidx.extend(0u32.to_be_bytes()); // first offset
        sidx.extend([0, 0, 0, 2]); // reserved, count
        for size in [100u32, 200] {
            sidx.extend(size.to_be_bytes());
            sidx.extend(4000u32.to_be_bytes());
            sidx.extend(0x9000_0000u32.to_be_bytes());
        }
        [bx(b"ftyp", b"isom"), moov, full(b"sidx", 0, &sidx)].concat()
    }

    #[test]
    fn head_clears_encryption_and_maps_fragments() {
        let buf = init();
        let head = parse_head(&[buf.clone(), vec![0xee; 50]].concat()).unwrap();
        assert_eq!(head.header.len(), buf.len());
        assert_eq!(head.iv_size, 8);
        assert_eq!(head.default_kid, [7u8; 16]);
        assert_eq!(head.fragments, vec![(buf.len() as u64, 100), (buf.len() as u64 + 100, 200)]);
        assert_eq!(head.fragment_durations, vec![4000, 4000]);
        let h = &head.header;
        assert!(h.windows(4).any(|w| w == b"avc1") && !h.windows(4).any(|w| w == b"encv"));
        assert!(!h.windows(4).any(|w| w == b"sinf") && !h.windows(4).any(|w| w == b"pssh"));
        assert_eq!(&head.format, b"avc1");
        assert_eq!(head.pssh.len(), 32, "only the Widevine pssh is kept");
        assert_eq!(&head.pssh[12..28], &WIDEVINE_SYSTEM_ID);
    }

    #[test]
    fn fragment_plan_finds_samples_and_hides_boxes() {
        let tfhd = full(b"tfhd", 0x020000, &1u32.to_be_bytes());
        let mut trun = 2u32.to_be_bytes().to_vec();
        trun.extend(0i32.to_be_bytes()); // data offset, patched below
        trun.extend(10u32.to_be_bytes());
        trun.extend(6u32.to_be_bytes());
        let mut senc = 2u32.to_be_bytes().to_vec();
        senc.extend([1u8; 8]);
        senc.extend([0, 1, 0, 4, 0, 0, 0, 6]); // 1 subsample: 4 clear + 6 cipher
        senc.extend([2u8; 8]);
        senc.extend([0, 1, 0, 6, 0, 0, 0, 0]); // fully clear sample
        let mut uuid = PIFF_SENC.to_vec();
        uuid.extend([0; 8]);
        let traf = bx(b"traf", &[tfhd, full(b"trun", 0x201, &trun), full(b"saiz", 0, &[0; 5]), full(b"saio", 0, &[0; 8]), full(b"senc", 2, &senc), bx(b"uuid", &uuid)].concat());
        let moof = bx(b"moof", &[full(b"mfhd", 0, &[0, 0, 0, 1]), traf].concat());
        let data_offset = (moof.len() + 8) as i32;
        let mut frag = [moof, bx(b"mdat", &[9u8; 16])].concat();
        let pos = frag.windows(4).position(|w| w == b"trun").unwrap() + 4 + 8;
        frag[pos..pos + 4].copy_from_slice(&data_offset.to_be_bytes());
        let len = frag.len();
        let plan = plan_fragment(&mut frag, 8).unwrap();
        assert_eq!(frag.len(), len);
        assert_eq!(plan.len(), 2);
        assert_eq!(plan[0], Sample { offset: data_offset as usize, size: 10, iv: vec![1; 8], subsamples: vec![(4, 6)], dts: 0, duration: 0, cto: 0 });
        assert_eq!(plan[1].offset, data_offset as usize + 10);
        for name in [b"senc", b"saiz", b"saio", b"uuid"] {
            assert!(!frag.windows(4).any(|w| w == name), "{} still visible", String::from_utf8_lossy(name));
        }
    }

    #[test]
    fn truncated_input_errors_instead_of_panicking() {
        let buf = init();
        for cut in [10, 40, buf.len() - 30] {
            assert!(parse_head(&buf[..cut]).is_err());
        }
        let mut frag = bx(b"moof", &bx(b"traf", &full(b"trun", 0x201, &[0, 0, 0, 9])));
        assert!(plan_fragment(&mut frag, 8).is_err());
    }
}
