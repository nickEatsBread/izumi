//! Gets Google's Widevine module onto the user's device without ever bundling it. It asks Google's
//! component update service over HTTPS for the current Linux x64 build, downloads it from an HTTPS
//! mirror and checks the size and SHA-256 the update response gave. It then strips the CRX3 header
//! and keeps only `manifest.json`, `LICENSE` and `libwidevinecdm.so`.
//!
//! The first download is staged: the user reads the module's own LICENSE before [`accept`] moves it
//! to `<data>/widevine/<version>/`, where the player looks. After that, newer builds install in the
//! background and take effect on the next start. Integrity rests on the HTTPS-delivered hash; the
//! CRX3 signature itself is not verified.

use anyhow::{anyhow, bail, ensure, Context, Result};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::fs;
use std::io::{Cursor, Read, Write};
use std::path::{Path, PathBuf};

const APP_ID: &str = "oimompecagnajdejgnnjijobebaeigek";
const UPDATE_URL: &str = "https://update.googleapis.com/service/update2/json";
const SO_ENTRY: &str = "_platform_specific/linux_x64/libwidevinecdm.so";
pub const SO_NAME: &str = "libwidevinecdm.so";
const MAX_CRX_BYTES: u64 = 64 << 20;
/// CDM module version and host interfaces the izumi host speaks.
const MODULE_VERSION: &str = "4";
const HOST_INTERFACES: [&str; 2] = ["11", "10"];
const CONSENT_FILE: &str = "consent.json";
const CHECKED_FILE: &str = "last-update-check";
const UPDATE_EVERY: std::time::Duration = std::time::Duration::from_secs(24 * 60 * 60);

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Offer {
    pub version: String,
    pub size: u64,
    pub sha256: String,
    pub urls: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Installed {
    pub version: String,
    pub dir: PathBuf,
    pub library: PathBuf,
    /// Interface the module asks for in its manifest: 11 when listed, else 10.
    pub interface: i32,
}

pub fn update_request() -> Value {
    json!({ "request": {
        // The service answers "error-inexpressible" unless the full format list is advertised; we
        // still only ever take a plain download+crx3 pipeline (see parse_offer).
        "@os": "", "@updater": "", "acceptformat": "crx3,download,puff,run,xz,zucc",
        // A deliberately old version makes the service offer a full download rather than a diff.
        "apps": [{ "appid": APP_ID, "installsource": "ondemand", "updatecheck": {}, "version": "1.0.0.0" }],
        "dedup": "cr", "ismachine": false, "arch": "x64",
        "os": { "arch": "x64", "platform": "Linux" },
        "protocol": "4.0", "updaterversion": "151.0.7922.173"
    }})
}

/// Parses the update-service reply. Keeps HTTPS mirrors only; plain-HTTP mirrors are dropped.
pub fn parse_offer(body: &str) -> Result<Offer> {
    let json: Value = serde_json::from_str(body.trim_start_matches(")]}'").trim_start())
        .context("update service returned non-JSON")?;
    let check = &json["response"]["apps"][0]["updatecheck"];
    ensure!(check["status"].as_str() == Some("ok"), "update service status: {}", check["status"]);
    let version = check["nextversion"].as_str().ok_or_else(|| anyhow!("no nextversion"))?.to_owned();
    ensure!(valid_version(&version), "suspicious version string {version:?}");
    // Only a full download of the CRX: differential pipelines (puff/zucc/xz/run) need a base copy.
    let ops = check["pipelines"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|p| p["operations"].as_array())
        .find(|ops| ops.iter().all(|op| matches!(op["type"].as_str(), Some("download" | "crx3"))))
        .ok_or_else(|| anyhow!("no full-download pipeline offered"))?;
    let download = ops
        .iter()
        .find(|op| op["type"].as_str() == Some("download"))
        .ok_or_else(|| anyhow!("no download operation"))?;
    let size = download["size"].as_u64().ok_or_else(|| anyhow!("no size"))?;
    ensure!(size > 0 && size <= MAX_CRX_BYTES, "implausible module size {size}");
    let sha256 = download["out"]["sha256"].as_str().ok_or_else(|| anyhow!("no sha256"))?.to_ascii_lowercase();
    ensure!(sha256.len() == 64 && sha256.bytes().all(|b| b.is_ascii_hexdigit()), "bad sha256");
    let urls: Vec<String> = download["urls"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|u| u["url"].as_str())
        .filter(|u| u.starts_with("https://"))
        .map(str::to_owned)
        .collect();
    ensure!(!urls.is_empty(), "no HTTPS download URL offered");
    Ok(Offer { version, size, sha256, urls })
}

fn valid_version(v: &str) -> bool {
    !v.is_empty() && v.len() <= 32 && v.split('.').all(|p| !p.is_empty() && p.bytes().all(|b| b.is_ascii_digit()))
}

fn version_key(v: &str) -> Vec<u64> {
    v.split('.').map(|p| p.parse().unwrap_or(0)).collect()
}

/// Returns the ZIP payload of a CRX3 file ("Cr24", version 3, header length, header, zip).
pub fn crx3_zip(crx: &[u8]) -> Result<&[u8]> {
    ensure!(crx.len() >= 12 && &crx[..4] == b"Cr24", "not a CRX file");
    let version = u32::from_le_bytes(crx[4..8].try_into()?);
    ensure!(version == 3, "unsupported CRX version {version}");
    let header = u32::from_le_bytes(crx[8..12].try_into()?) as usize;
    let start = 12usize.checked_add(header).filter(|&s| s < crx.len()).ok_or_else(|| anyhow!("truncated CRX"))?;
    Ok(&crx[start..])
}

/// Accepts a manifest only when it targets CDM module 4 and one of our host interfaces; returns the
/// version and the interface to request.
pub fn check_manifest(manifest: &[u8]) -> Result<(String, i32)> {
    let json: Value = serde_json::from_slice(manifest).context("manifest.json is not JSON")?;
    let list = |key: &str| -> Vec<String> {
        json[key].as_str().unwrap_or("").split(',').map(|s| s.trim().to_owned()).collect()
    };
    ensure!(list("x-cdm-module-versions").iter().any(|v| v == MODULE_VERSION), "module version unsupported");
    let interfaces = list("x-cdm-interface-versions");
    let interface = HOST_INTERFACES
        .iter()
        .find(|i| interfaces.iter().any(|v| v == *i))
        .ok_or_else(|| anyhow!("module interfaces {interfaces:?} unsupported"))?;
    let version = json["version"].as_str().unwrap_or("").to_owned();
    ensure!(valid_version(&version), "manifest version {version:?} invalid");
    Ok((version, interface.parse()?))
}

fn check_elf_x86_64(so: &[u8]) -> Result<()> {
    // e_ident: ELF magic, 64-bit, little-endian; e_machine at 18 = 0x3E (x86-64).
    ensure!(so.len() > 20 && &so[..4] == b"\x7fELF" && so[4] == 2 && so[5] == 1, "not a 64-bit ELF library");
    ensure!(u16::from_le_bytes([so[18], so[19]]) == 0x3e, "module is not built for x86-64");
    Ok(())
}

fn sha256_hex(bytes: &[u8]) -> String {
    Sha256::digest(bytes).iter().map(|b| format!("{b:02x}")).collect()
}

fn read_entry(zip: &mut zip::ZipArchive<Cursor<&[u8]>>, name: &str) -> Result<Vec<u8>> {
    let mut entry = zip.by_name(name).with_context(|| format!("module package has no {name}"))?;
    ensure!(entry.size() <= MAX_CRX_BYTES, "{name} too large");
    let mut out = Vec::with_capacity(entry.size() as usize);
    entry.read_to_end(&mut out)?;
    Ok(out)
}

fn root(data_dir: &Path) -> PathBuf {
    data_dir.join("widevine")
}

fn staged_dir(data_dir: &Path, version: &str) -> PathBuf {
    root(data_dir).join(format!(".staged-{version}"))
}

/// Writes the files into a private temp dir and renames it to `dest`, so a crash never leaves a
/// half-written module where anything looks.
fn write_dir(dest: &Path, manifest: &[u8], license: Option<&[u8]>, so: &[u8]) -> Result<()> {
    let parent = dest.parent().ok_or_else(|| anyhow!("bad module dir"))?;
    fs::create_dir_all(parent)?;
    if dest.join(SO_NAME).exists() {
        return Ok(());
    }
    let tmp = parent.join(format!(".partial-{}", std::process::id()));
    let _ = fs::remove_dir_all(&tmp);
    fs::create_dir_all(&tmp)?;
    let write = |name: &str, bytes: &[u8]| -> Result<()> {
        let mut f = fs::File::create(tmp.join(name))?;
        f.write_all(bytes)?;
        f.sync_all()?;
        Ok(())
    };
    write("manifest.json", manifest)?;
    if let Some(license) = license {
        write("LICENSE", license)?;
    }
    write(SO_NAME, so)?;
    if let Err(e) = fs::rename(&tmp, dest) {
        let _ = fs::remove_dir_all(&tmp);
        // Another izumi process may have written the same version first.
        if !dest.join(SO_NAME).exists() {
            return Err(e).context("could not move the module into place");
        }
    }
    Ok(())
}

fn installed_at(dir: &Path) -> Result<Installed> {
    let (version, interface) = check_manifest(&fs::read(dir.join("manifest.json"))?)?;
    let library = dir.join(SO_NAME);
    let mut head = [0u8; 64];
    fs::File::open(&library)?.read_exact(&mut head)?;
    check_elf_x86_64(&head)?;
    Ok(Installed { version, dir: dir.to_owned(), library, interface })
}

/// Newest valid accepted module under `<data>/widevine/`, if any.
pub fn installed(data_dir: &Path) -> Option<Installed> {
    if !consented(data_dir) {
        return None;
    }
    let mut found: Vec<Installed> = fs::read_dir(root(data_dir))
        .ok()?
        .flatten()
        .filter(|e| !e.file_name().to_string_lossy().starts_with('.'))
        .filter(|e| e.path().is_dir())
        .filter_map(|e| installed_at(&e.path()).ok())
        .collect();
    found.sort_by_key(|i| version_key(&i.version));
    found.pop()
}

pub fn consented(data_dir: &Path) -> bool {
    root(data_dir).join(CONSENT_FILE).is_file()
}

/// Verifies a downloaded CRX against its offer and unpacks the three files we use.
fn unpack(offer: &Offer, crx: &[u8]) -> Result<(Vec<u8>, Option<Vec<u8>>, Vec<u8>)> {
    ensure!(crx.len() as u64 == offer.size, "download size {} != offered {}", crx.len(), offer.size);
    let got = sha256_hex(crx);
    ensure!(got == offer.sha256, "download hash mismatch (got {got})");
    let mut zip = zip::ZipArchive::new(Cursor::new(crx3_zip(crx)?)).context("module package is not a ZIP")?;
    let manifest = read_entry(&mut zip, "manifest.json")?;
    let (version, _) = check_manifest(&manifest)?;
    ensure!(version == offer.version, "package version {version} != offered {}", offer.version);
    let license = read_entry(&mut zip, "LICENSE").ok();
    let so = read_entry(&mut zip, SO_ENTRY)?;
    check_elf_x86_64(&so)?;
    Ok((manifest, license, so))
}

async fn query(client: &reqwest::Client) -> Result<Offer> {
    let body = client
        .post(UPDATE_URL)
        .json(&update_request())
        .send()
        .await?
        .error_for_status()?
        .text()
        .await?;
    parse_offer(&body)
}

/// Downloads from the offered HTTPS mirrors in order until one passes the size and hash check.
async fn download(client: &reqwest::Client, offer: &Offer, progress: &(dyn Fn(u64, u64) + Send + Sync)) -> Result<Vec<u8>> {
    let mut last = anyhow!("no mirror tried");
    for url in &offer.urls {
        let attempt = async {
            let mut res = client.get(url).send().await?.error_for_status()?;
            if res.content_length().is_some_and(|n| n != offer.size) {
                bail!("mirror size {:?} != offered {}", res.content_length(), offer.size);
            }
            let mut bytes = Vec::with_capacity(offer.size as usize);
            while let Some(chunk) = res.chunk().await? {
                bytes.extend_from_slice(&chunk);
                ensure!(bytes.len() as u64 <= offer.size, "mirror sent more than offered");
                progress(bytes.len() as u64, offer.size);
            }
            ensure!(bytes.len() as u64 == offer.size, "short download");
            ensure!(sha256_hex(&bytes) == offer.sha256, "hash mismatch from the mirror");
            Ok(bytes)
        };
        match attempt.await {
            Ok(bytes) => return Ok(bytes),
            Err(e) => last = e,
        }
    }
    Err(last)
}

/// A downloaded, verified module waiting for the user to accept its licence.
pub struct Staged {
    pub version: String,
    pub license: String,
}

fn staged_license(dir: &Path) -> String {
    let text = fs::read(dir.join("LICENSE")).unwrap_or_default();
    let text = String::from_utf8_lossy(&text[..text.len().min(64 * 1024)]).trim().to_string();
    if text.is_empty() {
        "The module package carries no LICENSE file. Google's terms for the Widevine module still apply.".into()
    } else {
        text
    }
}

/// Downloads and verifies the current module into a staging folder and returns its licence text.
pub async fn stage(client: &reqwest::Client, data_dir: &Path, progress: &(dyn Fn(u64, u64) + Send + Sync)) -> Result<Staged> {
    let offer = query(client).await?;
    let dest = staged_dir(data_dir, &offer.version);
    if !dest.join(SO_NAME).exists() {
        let crx = download(client, &offer, progress).await?;
        let (manifest, license, so) = unpack(&offer, &crx)?;
        write_dir(&dest, &manifest, license.as_deref(), &so)?;
    }
    Ok(Staged { license: staged_license(&dest), version: offer.version })
}

/// Records the user's acceptance and moves the staged module to where the player loads it.
pub fn accept(data_dir: &Path, version: &str) -> Result<Installed> {
    ensure!(valid_version(version), "bad version");
    let staged = staged_dir(data_dir, version);
    let dest = root(data_dir).join(version);
    if !dest.join(SO_NAME).exists() {
        ensure!(staged.join(SO_NAME).exists(), "that module download is gone; download it again");
        fs::rename(&staged, &dest).context("could not install the module")?;
    } else {
        let _ = fs::remove_dir_all(&staged);
    }
    let consent = json!({ "acceptedVersion": version, "acceptedAt": unix_now() });
    fs::write(root(data_dir).join(CONSENT_FILE), serde_json::to_vec_pretty(&consent)?)?;
    let found = installed_at(&dest)?;
    // Older versions stay until this one has loaded once (see prune_old).
    Ok(found)
}

/// Deletes the module, its staging folders and the recorded consent.
pub fn remove(data_dir: &Path) -> Result<()> {
    let dir = root(data_dir);
    if dir.exists() {
        fs::remove_dir_all(&dir).context("could not remove the module")?;
    }
    Ok(())
}

/// Keeps `keep` and drops every other installed version (called once `keep` has loaded).
pub fn prune_old(data_dir: &Path, keep: &str) {
    let Ok(entries) = fs::read_dir(root(data_dir)) else { return };
    for e in entries.flatten() {
        let name = e.file_name().to_string_lossy().into_owned();
        if e.path().is_dir() && name != keep && (valid_version(&name) || name.starts_with(".partial-")) {
            let _ = fs::remove_dir_all(e.path());
        }
    }
}

fn unix_now() -> u64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0)
}

/// After the user has accepted the module once, installs a newer build in the background at most
/// once a day. The newer build is used from the next start; the loaded one is never replaced.
pub async fn update_if_due(client: &reqwest::Client, data_dir: &Path) -> Result<Option<String>> {
    if !consented(data_dir) {
        return Ok(None);
    }
    let stamp = root(data_dir).join(CHECKED_FILE);
    let due = fs::metadata(&stamp)
        .and_then(|m| m.modified())
        .map(|t| t.elapsed().map_or(true, |age| age >= UPDATE_EVERY))
        .unwrap_or(true);
    if !due {
        return Ok(None);
    }
    let _ = fs::write(&stamp, unix_now().to_string());
    let offer = query(client).await?;
    if installed(data_dir).is_some_and(|i| version_key(&i.version) >= version_key(&offer.version)) {
        return Ok(None);
    }
    let crx = download(client, &offer, &|_, _| {}).await?;
    let (manifest, license, so) = unpack(&offer, &crx)?;
    write_dir(&root(data_dir).join(&offer.version), &manifest, license.as_deref(), &so)?;
    Ok(Some(offer.version))
}

#[cfg(test)]
mod tests {
    use super::*;

    const REPLY: &str = r#")]}'
{"response":{"apps":[{"appid":"oimompecagnajdejgnnjijobebaeigek","status":"ok","updatecheck":{"status":"ok","nextversion":"4.10.3112.0","pipelines":[{"operations":[{"type":"download","size":5,"out":{"sha256":"00"},"urls":[{"url":"https://diff"}]},{"type":"puff"}]},{"operations":[{"type":"download","size":21970001,"out":{"sha256":"1BF1F200DCCCD461B2D029D000D0FCF800F0571C932DB31467B9D5D301E0A98F"},"urls":[{"url":"http://edgedl.me.gvt1.com/x.crx3"},{"url":"https://edgedl.me.gvt1.com/x.crx3"},{"url":"https://dl.google.com/x.crx3"}]},{"type":"crx3"}]}]}}]}}"#;

    #[test]
    fn offer_keeps_https_only_and_lowercases_hash() {
        let offer = parse_offer(REPLY).unwrap();
        assert_eq!(offer.version, "4.10.3112.0");
        assert_eq!(offer.size, 21_970_001);
        assert_eq!(offer.sha256, "1bf1f200dcccd461b2d029d000d0fcf800f0571c932db31467b9d5d301e0a98f");
        assert_eq!(offer.urls, vec!["https://edgedl.me.gvt1.com/x.crx3", "https://dl.google.com/x.crx3"]);
    }

    #[test]
    fn offer_rejects_path_like_versions() {
        assert!(parse_offer(&REPLY.replace("4.10.3112.0", "../../evil")).is_err());
    }

    fn manifest(interfaces: &str) -> Vec<u8> {
        format!(r#"{{"version":"4.10.3112.0","x-cdm-module-versions":"4","x-cdm-interface-versions":"{interfaces}"}}"#).into_bytes()
    }

    #[test]
    fn manifest_picks_an_interface_we_speak() {
        assert_eq!(check_manifest(&manifest("10")).unwrap(), ("4.10.3112.0".into(), 10));
        assert_eq!(check_manifest(&manifest("10,11")).unwrap().1, 11);
        assert!(check_manifest(&manifest("12")).is_err());
    }

    fn fake_elf() -> Vec<u8> {
        let mut so = vec![0u8; 64];
        so[..4].copy_from_slice(b"\x7fELF");
        so[4] = 2;
        so[5] = 1;
        so[18] = 0x3e;
        so
    }

    fn fake_crx(entries: &[(&str, Vec<u8>)]) -> Vec<u8> {
        let mut zip_bytes = Vec::new();
        {
            let mut w = zip::ZipWriter::new(Cursor::new(&mut zip_bytes));
            for (name, data) in entries {
                w.start_file(*name, zip::write::SimpleFileOptions::default()).unwrap();
                w.write_all(data).unwrap();
            }
            w.finish().unwrap();
        }
        let header = b"signed-header-bytes";
        let mut crx = b"Cr24".to_vec();
        crx.extend(3u32.to_le_bytes());
        crx.extend((header.len() as u32).to_le_bytes());
        crx.extend(header);
        crx.extend(zip_bytes);
        crx
    }

    #[test]
    fn stages_only_named_files_and_installs_after_acceptance() {
        let crx = fake_crx(&[
            ("manifest.json", manifest("10,11")),
            ("LICENSE", b"module licence text".to_vec()),
            (SO_ENTRY, fake_elf()),
            ("../escape.txt", b"ignored".to_vec()),
        ]);
        let offer = Offer { version: "4.10.3112.0".into(), size: crx.len() as u64, sha256: sha256_hex(&crx), urls: vec!["https://x".into()] };
        let data = std::env::temp_dir().join(format!("izumi-widevine-test-{}", std::process::id()));
        let _ = fs::remove_dir_all(&data);
        let (m, l, so) = unpack(&offer, &crx).unwrap();
        write_dir(&staged_dir(&data, "4.10.3112.0"), &m, l.as_deref(), &so).unwrap();
        assert!(installed(&data).is_none(), "nothing is usable before the licence is accepted");
        assert_eq!(staged_license(&staged_dir(&data, "4.10.3112.0")), "module licence text");

        let got = accept(&data, "4.10.3112.0").unwrap();
        assert_eq!(got.version, "4.10.3112.0");
        assert_eq!(got.interface, 11);
        assert!(got.library.ends_with("widevine/4.10.3112.0/libwidevinecdm.so"));
        let names: Vec<_> = fs::read_dir(&got.dir).unwrap().flatten().map(|e| e.file_name()).collect();
        assert_eq!(names.len(), 3, "manifest.json, LICENSE and the library only: {names:?}");
        assert!(!data.join("escape.txt").exists() && !data.join("widevine/escape.txt").exists());
        assert_eq!(installed(&data).unwrap(), got);

        let mut tampered = crx.clone();
        *tampered.last_mut().unwrap() ^= 1;
        assert!(unpack(&offer, &tampered).is_err(), "hash mismatch must be refused");

        remove(&data).unwrap();
        assert!(installed(&data).is_none());
        let _ = fs::remove_dir_all(&data);
    }
}
