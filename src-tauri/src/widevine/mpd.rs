//! Reads the parts of a static, on-demand DASH manifest that protected playback needs: one file per
//! representation (`SegmentBase`), its resolved URL, size and codec, plus the Widevine `pssh` and
//! default KID. `SegmentTemplate` manifests are reported as unsupported rather than guessed at.
use anyhow::{anyhow, bail, Context, Result};
use base64::Engine;
use quick_xml::{events::Event, Reader};

pub const WIDEVINE_SYSTEM_ID: &str = "edef8ba9-79d6-4ace-a3c8-27dcd51d21ed";

#[derive(Debug, Default, Clone)]
struct El {
    name: String,
    attrs: Vec<(String, String)>,
    children: Vec<El>,
    text: String,
}

impl El {
    fn attr(&self, name: &str) -> Option<&str> {
        self.attrs.iter().find(|(k, _)| k == name).map(|(_, v)| v.as_str())
    }
    fn kids<'a>(&'a self, name: &'a str) -> impl Iterator<Item = &'a El> + 'a {
        self.children.iter().filter(move |c| c.name == name)
    }
    fn kid(&self, name: &str) -> Option<&El> {
        self.children.iter().find(|c| c.name == name)
    }
}

fn parse_tree(xml: &str) -> Result<El> {
    let mut reader = Reader::from_str(xml);
    reader.config_mut().trim_text(true);
    let mut stack: Vec<El> = vec![El::default()];
    let element = |e: &quick_xml::events::BytesStart| -> Result<El> {
        let mut el = El { name: String::from_utf8_lossy(e.local_name().as_ref()).into_owned(), ..El::default() };
        for attr in e.attributes() {
            let attr = attr?;
            let key = String::from_utf8_lossy(attr.key.local_name().as_ref()).into_owned();
            el.attrs.push((key, attr.unescape_value()?.into_owned()));
        }
        Ok(el)
    };
    loop {
        match reader.read_event()? {
            Event::Start(e) => stack.push(element(&e)?),
            Event::Empty(e) => {
                let el = element(&e)?;
                stack.last_mut().context("unbalanced manifest")?.children.push(el);
            }
            Event::End(_) => {
                let done = stack.pop().context("unbalanced manifest")?;
                stack.last_mut().context("unbalanced manifest")?.children.push(done);
            }
            Event::Text(t) => {
                let text = t.xml_content()?;
                stack.last_mut().context("unbalanced manifest")?.text.push_str(&text);
            }
            Event::CData(t) => {
                let text = t.decode()?;
                stack.last_mut().context("unbalanced manifest")?.text.push_str(&text);
            }
            // `&amp;` in a BaseURL arrives as its own event since quick-xml 0.38.
            Event::GeneralRef(r) => {
                let resolved = match r.resolve_char_ref()? {
                    Some(c) => c.to_string(),
                    None => {
                        let name = r.decode()?;
                        quick_xml::escape::resolve_predefined_entity(&name)
                            .ok_or_else(|| anyhow!("unknown entity &{name};"))?
                            .to_string()
                    }
                };
                stack.last_mut().context("unbalanced manifest")?.text.push_str(&resolved);
            }
            Event::Eof => break,
            _ => {}
        }
    }
    let root = stack.pop().context("empty manifest")?;
    root.children.into_iter().find(|c| c.name == "MPD").context("not a DASH manifest")
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Kind {
    Video,
    Audio,
}

#[derive(Debug, Clone)]
pub struct Representation {
    pub kind: Kind,
    pub id: String,
    pub url: String,
    pub bandwidth: u64,
    pub width: u32,
    pub height: u32,
    pub codecs: String,
    pub lang: Option<String>,
}

#[derive(Debug, Clone)]
pub struct Manifest {
    pub representations: Vec<Representation>,
    /// Widevine pssh box(es) from the manifest, if it carries them (else they are read from the
    /// init segment).
    pub pssh: Option<Vec<u8>>,
}

fn join(base: &url::Url, el: &El) -> Result<url::Url> {
    match el.kid("BaseURL").map(|b| b.text.trim()).filter(|t| !t.is_empty()) {
        Some(text) => base.join(text).with_context(|| format!("bad BaseURL {text:?}")),
        None => Ok(base.clone()),
    }
}

fn kind_of(set: &El, rep: &El) -> Option<Kind> {
    let content = set.attr("contentType").unwrap_or("");
    let mime = rep.attr("mimeType").or(set.attr("mimeType")).unwrap_or("");
    if content == "video" || mime.starts_with("video/") {
        Some(Kind::Video)
    } else if content == "audio" || mime.starts_with("audio/") {
        Some(Kind::Audio)
    } else {
        None
    }
}

fn widevine_pssh(el: &El) -> Option<Vec<u8>> {
    el.kids("ContentProtection")
        .filter(|cp| cp.attr("schemeIdUri").is_some_and(|s| s.to_ascii_lowercase().contains(WIDEVINE_SYSTEM_ID)))
        .filter_map(|cp| cp.kid("pssh"))
        .find_map(|p| base64::engine::general_purpose::STANDARD.decode(p.text.trim()).ok())
}

pub fn parse(xml: &str, manifest_url: &str) -> Result<Manifest> {
    let mpd = parse_tree(xml)?;
    if mpd.attr("type") == Some("dynamic") {
        bail!("live streams are not supported for protected playback");
    }
    let periods: Vec<&El> = mpd.kids("Period").collect();
    match periods.len() {
        0 => bail!("manifest has no Period"),
        1 => {}
        _ => bail!("multi-period manifests are not supported for protected playback"),
    }
    let period = periods[0];
    let root = url::Url::parse(manifest_url).context("bad manifest URL")?;
    let base = join(&join(&root, &mpd)?, period)?;
    let mut representations = Vec::new();
    let mut pssh = None;
    for set in period.kids("AdaptationSet") {
        let set_base = join(&base, set)?;
        if pssh.is_none() {
            pssh = widevine_pssh(set);
        }
        for rep in set.kids("Representation") {
            let Some(kind) = kind_of(set, rep) else { continue };
            if rep.kid("SegmentTemplate").is_some() || set.kid("SegmentTemplate").is_some() || rep.kid("SegmentList").is_some() {
                bail!("segmented (SegmentTemplate) manifests are not supported for protected playback yet");
            }
            if pssh.is_none() {
                pssh = widevine_pssh(rep);
            }
            let num = |name: &str| rep.attr(name).or(set.attr(name)).and_then(|v| v.parse::<u64>().ok()).unwrap_or(0);
            representations.push(Representation {
                kind,
                id: rep.attr("id").unwrap_or("").to_string(),
                url: join(&set_base, rep)?.to_string(),
                bandwidth: num("bandwidth"),
                width: num("width") as u32,
                height: num("height") as u32,
                codecs: rep.attr("codecs").or(set.attr("codecs")).unwrap_or("").to_string(),
                lang: set.attr("lang").or(rep.attr("lang")).map(str::to_string),
            });
        }
    }
    Ok(Manifest { representations, pssh })
}

impl Manifest {
    /// Highest video rung at or below `max_height` (the lowest rung when none fits); ties go to the
    /// higher bitrate. `codec` restricts the codec family (e.g. "avc1" when the module decodes).
    pub fn video(&self, max_height: Option<u32>, codec: Option<&str>) -> Option<&Representation> {
        let pool: Vec<&Representation> = self
            .representations
            .iter()
            .filter(|r| r.kind == Kind::Video)
            .filter(|r| codec.map_or(true, |c| r.codecs.starts_with(c) || (c == "avc1" && r.codecs.starts_with("avc3"))))
            .collect();
        let fits = pool.iter().copied().filter(|r| max_height.map_or(true, |m| r.height <= m));
        fits.max_by_key(|r| (r.height, r.bandwidth))
            .or_else(|| pool.iter().copied().min_by_key(|r| (r.height, std::cmp::Reverse(r.bandwidth))))
    }

    /// Every distinct video height, highest first.
    pub fn heights(&self, codec: Option<&str>) -> Vec<u32> {
        let mut h: Vec<u32> = self
            .representations
            .iter()
            .filter(|r| r.kind == Kind::Video && r.height > 0)
            .filter(|r| codec.map_or(true, |c| r.codecs.starts_with(c) || (c == "avc1" && r.codecs.starts_with("avc3"))))
            .map(|r| r.height)
            .collect();
        h.sort_unstable_by(|a, b| b.cmp(a));
        h.dedup();
        h
    }

    /// The audio representation in the preferred language when there is one, highest bitrate first.
    pub fn audio(&self, lang: Option<&str>) -> Option<&Representation> {
        let audio = || self.representations.iter().filter(|r| r.kind == Kind::Audio);
        let wanted = lang.map(|l| l.to_ascii_lowercase());
        let matches = |r: &&Representation| {
            let Some(w) = wanted.as_deref() else { return false };
            r.lang.as_deref().is_some_and(|l| {
                let l = l.to_ascii_lowercase();
                l == w || l.split(['-', '_']).next() == w.split(['-', '_']).next() || crate::widevine::lang_matches(&l, w)
            })
        };
        audio().filter(matches).max_by_key(|r| r.bandwidth).or_else(|| audio().max_by_key(|r| r.bandwidth))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const MPD: &str = r#"<?xml version="1.0" encoding="UTF-8"?>
<MPD xmlns="urn:mpeg:dash:schema:mpd:2011" xmlns:cenc="urn:mpeg:cenc:2013" type="static" mediaPresentationDuration="PT23M40S">
  <BaseURL>http://127.0.0.1:8080/v/abc/</BaseURL>
  <Period>
    <AdaptationSet contentType="video" mimeType="video/mp4">
      <ContentProtection schemeIdUri="urn:mpeg:dash:mp4protection:2011" value="cenc" cenc:default_KID="01234567-89ab-cdef-0123-456789abcdef"/>
      <ContentProtection schemeIdUri="urn:uuid:EDEF8BA9-79D6-4ACE-A3C8-27DCD51D21ED"><cenc:pssh>AAAAKHBzc2gAAAAA7e+LqXnWSs6jyCfc1R0h7QAAAAgSBmFiYzEyMw==</cenc:pssh></ContentProtection>
      <Representation id="v1" bandwidth="11733349" width="1920" height="1080" codecs="avc1.640028"><BaseURL>cdn/v1.mp4?a=1&amp;b=2</BaseURL><SegmentBase indexRange="1810-6521"><Initialization range="0-1809"/></SegmentBase></Representation>
      <Representation id="v2" bandwidth="4000000" width="1280" height="720" codecs="avc1.64001f"><BaseURL>cdn/v2.mp4</BaseURL><SegmentBase indexRange="1-2"/></Representation>
      <Representation id="v3" bandwidth="1138836" width="1280" height="720" codecs="avc1.64001f"><BaseURL>cdn/v3.mp4</BaseURL><SegmentBase indexRange="1-2"/></Representation>
    </AdaptationSet>
    <AdaptationSet contentType="audio" mimeType="audio/mp4" lang="ja-JP">
      <Representation id="a1" bandwidth="128000" codecs="mp4a.40.2"><BaseURL>cdn/a1.mp4</BaseURL><SegmentBase indexRange="1-2"/></Representation>
    </AdaptationSet>
  </Period>
</MPD>"#;

    #[test]
    fn reads_on_demand_representations_and_pssh() {
        let m = parse(MPD, "http://127.0.0.1:8080/v/abc/manifest.mpd").unwrap();
        assert_eq!(m.representations.len(), 4);
        let best = m.video(None, Some("avc1")).unwrap();
        assert_eq!(best.id, "v1");
        assert_eq!(best.url, "http://127.0.0.1:8080/v/abc/cdn/v1.mp4?a=1&b=2");
        assert_eq!(m.video(Some(720), Some("avc1")).unwrap().id, "v2", "higher bitrate wins a tie");
        assert_eq!(m.video(Some(360), Some("avc1")).unwrap().id, "v2", "smallest height, best bitrate, when nothing fits");
        assert_eq!(m.heights(Some("avc1")), vec![1080, 720]);
        assert_eq!(m.audio(Some("jpn")).unwrap().id, "a1");
        assert_eq!(m.audio(Some("en")).unwrap().id, "a1", "falls back to any audio");
        let pssh = m.pssh.unwrap();
        assert_eq!(&pssh[4..8], b"pssh");
    }

    #[test]
    fn refuses_layouts_it_cannot_play() {
        let template = MPD.replace("<SegmentBase indexRange=\"1-2\"/>", "<SegmentTemplate media=\"$Number$.m4s\"/>");
        assert!(parse(&template, "http://x/m.mpd").unwrap_err().to_string().contains("SegmentTemplate"));
        let live = MPD.replace("type=\"static\"", "type=\"dynamic\"");
        assert!(parse(&live, "http://x/m.mpd").is_err());
    }
}
