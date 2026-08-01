//! On-demand neural-upscale shader fetch. The client ships no shaders; the Anime video-quality
//! preset downloads the requested shader variant from a pinned upstream release and caches it under
//! the app config dir. The release endpoint is hardcoded — never a user-supplied URL.

use std::path::{Path, PathBuf};

use tauri::{AppHandle, Manager};

/// Pinned upstream release index. Hardcoded so a compromised/typo'd setting can never point the
/// downloader somewhere else; this is a wire value, not a credit.
const RELEASE_API: &str = "https://api.github.com/repos/Artoriuz/ArtCNN/releases/latest";
/// Upstream names its release assets `<prefix><variant>.glsl`. Only used to MATCH remote asset
/// names — the local cache file is named by [`cache_path`] instead.
const ASSET_PREFIX: &str = "ArtCNN_";

/// Filename-safety gate for `variant`, which is interpolated into a path by [`cache_path`].
/// Accepts exactly the shape real variant names have — ASCII alphanumerics plus `_` (`C4F16`,
/// `C4F16_Chroma`). That set contains no `.`, `/`, `\`, `:` or NUL and nothing non-ASCII, so
/// traversal (`..`), absolute/UNC paths, NTFS streams and unicode look-alikes are all rejected by
/// construction. The earlier alphanumeric-only rule silently killed every `_Chroma` variant.
pub(crate) fn is_valid_variant(variant: &str) -> bool {
    !variant.is_empty()
        && variant.len() <= 64
        && variant
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '_')
}

/// Local cache path for `variant` under `dir`. Split out of [`ensure`] so validation and the
/// filename it produces are testable without an `AppHandle` or the network.
pub(crate) fn cache_path(dir: &Path, variant: &str) -> Result<PathBuf, String> {
    if !is_valid_variant(variant) {
        return Err("invalid shader variant".to_string());
    }
    Ok(dir.join(format!("shader_{variant}.glsl")))
}

/// Pick the release asset download URL for `variant` (e.g. "C4F16") from a list of
/// `(asset_name, download_url)` pairs. Prefers the exact `<prefix><variant>.glsl` asset, else falls
/// back to the first `.glsl` whose name contains the variant token.
pub(crate) fn pick_asset<'a>(assets: &'a [(String, String)], variant: &str) -> Option<&'a str> {
    let want = variant.to_ascii_lowercase();
    let exact = format!("{}{want}.glsl", ASSET_PREFIX.to_ascii_lowercase());
    if let Some((_, url)) = assets.iter().find(|(n, _)| n.to_ascii_lowercase() == exact) {
        return Some(url.as_str());
    }
    // Fuzzy fallback, for the day upstream decorates its asset names. A luma token is a substring
    // of the matching chroma name (`C4F16` ⊂ `C4F16_Chroma`), so a luma request must skip chroma
    // assets — but ONLY a luma request: applied unconditionally that filter rejects every candidate
    // a chroma request could ever match, which is what made this branch dead for `_Chroma`.
    let want_chroma = want.contains("chroma");
    assets
        .iter()
        .find(|(n, _)| {
            let n = n.to_ascii_lowercase();
            n.ends_with(".glsl") && n.contains(&want) && (want_chroma || !n.contains("chroma"))
        })
        .map(|(_, url)| url.as_str())
}

/// Ensure the `variant` shader is present locally; download it from the latest pinned upstream
/// release if missing. Returns the absolute path (forward-slashed for mpv). Fails safe: any error
/// is returned as `Err` and the caller falls back to the shader-less High Quality chain.
pub async fn ensure(app: &AppHandle, variant: &str) -> Result<String, String> {
    let dir = app
        .path()
        .app_config_dir()
        .map_err(|e| e.to_string())?
        .join("shaders");
    // Validate before touching the filesystem, so a bad variant can't even create a directory.
    let dest: PathBuf = cache_path(&dir, variant)?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    if dest.is_file() {
        return Ok(mpv_path(&dest));
    }
    let client = crate::http_client();
    let resp = client
        .get(RELEASE_API)
        .header("User-Agent", "izumi")
        .header("Accept", "application/vnd.github+json")
        .send()
        .await
        .map_err(|_| "shader index request failed".to_string())?;
    if !resp.status().is_success() {
        return Err(format!("shader index HTTP {}", resp.status().as_u16()));
    }
    // reqwest is built without the `json` feature (Cargo.toml: default-features = false), so parse the
    // body text ourselves — the same pattern the rest of the crate uses (`.text()` + serde_json).
    let text = resp
        .text()
        .await
        .map_err(|_| "shader index read failed".to_string())?;
    let json: serde_json::Value =
        serde_json::from_str(&text).map_err(|_| "shader index parse failed".to_string())?;
    let assets: Vec<(String, String)> = json["assets"]
        .as_array()
        .map(|a| {
            a.iter()
                .filter_map(|x| {
                    Some((
                        x["name"].as_str()?.to_string(),
                        x["browser_download_url"].as_str()?.to_string(),
                    ))
                })
                .collect()
        })
        .unwrap_or_default();
    let url = pick_asset(&assets, variant)
        .ok_or_else(|| format!("no {variant} shader asset in latest release"))?;
    let bytes = client
        .get(url)
        .header("User-Agent", "izumi")
        .send()
        .await
        .map_err(|_| "shader download failed".to_string())?
        .bytes()
        .await
        .map_err(|_| "shader read failed".to_string())?;
    if bytes.is_empty() {
        return Err("shader download empty".to_string());
    }
    let tmp = dest.with_extension("part");
    std::fs::write(&tmp, &bytes).map_err(|e| e.to_string())?;
    std::fs::rename(&tmp, &dest).map_err(|e| e.to_string())?;
    Ok(mpv_path(&dest))
}

/// mpv accepts forward slashes on Windows and the drive `:` is fine (path-list separator is `;` on
/// Windows), so a forward-slashed absolute path is safe to hand to `glsl-shaders`.
fn mpv_path(p: &std::path::Path) -> String {
    p.to_string_lossy().replace('\\', "/")
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The exact variant strings the frontend sends (`ANIME_SHADER_VARIANTS` in
    /// src/lib/player/quality.ts). Both must survive validation or the Anime preset silently
    /// downloads nothing.
    const SHIPPED_VARIANTS: [&str; 2] = ["C4F16", "C4F16_Chroma"];

    fn assets() -> Vec<(String, String)> {
        vec![
            (
                format!("{ASSET_PREFIX}C4F16_Chroma.glsl"),
                "u_chroma".to_string(),
            ),
            (format!("{ASSET_PREFIX}C4F16.glsl"), "u_luma".to_string()),
            (format!("{ASSET_PREFIX}C4F32.glsl"), "u_32".to_string()),
        ]
    }

    #[test]
    fn accepts_every_shipped_variant() {
        // Regression: an alphanumeric-only rule rejected the underscore in the chroma variant, and
        // because the frontend resolves the pair as a group the whole preset became a no-op.
        for v in SHIPPED_VARIANTS {
            assert!(is_valid_variant(v), "{v} must pass validation");
        }
    }

    #[test]
    fn rejects_unsafe_variants() {
        for bad in [
            "",
            "..",
            "../etc",
            "..\\win",
            "a/b",
            "a\\b",
            "C:/abs",
            "/abs",
            "dot.dot",
            "nul\0byte",
            "tab\there",
            "sp ace",
            "ｆｕｌｌｗｉｄｔｈ",
            "é",
            "x;y",
            "x*y",
            "~/x",
        ] {
            assert!(!is_valid_variant(bad), "{bad:?} must be rejected");
        }
        assert!(
            !is_valid_variant(&"a".repeat(65)),
            "over-long variant must be rejected"
        );
    }

    #[test]
    fn cache_path_stays_inside_the_shader_dir() {
        let dir = Path::new("/cfg/shaders");
        for v in SHIPPED_VARIANTS {
            let p = cache_path(dir, v).expect("shipped variant resolves");
            assert_eq!(p.parent(), Some(dir));
            assert!(p.file_name().unwrap().to_string_lossy().ends_with(".glsl"));
        }
        // distinct variants must not collide on one cache file
        assert_ne!(
            cache_path(dir, "C4F16").unwrap(),
            cache_path(dir, "C4F16_Chroma").unwrap()
        );
        assert!(cache_path(dir, "../../evil").is_err());
    }

    #[test]
    fn both_variants_resolve_to_a_real_file_for_mpv() {
        // The half of `ensure` that doesn't need the network: once the bytes are on disk, the same
        // path computation must hand mpv an existing, forward-slashed absolute file per variant.
        let dir = std::env::temp_dir().join(format!("izumi-shader-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let mut paths = Vec::new();
        for v in SHIPPED_VARIANTS {
            let dest = cache_path(&dir, v).expect("shipped variant resolves");
            std::fs::write(&dest, b"//!hook\n").unwrap();
            assert!(dest.is_file());
            let p = mpv_path(&dest);
            assert!(!p.contains('\\'), "mpv path must be forward-slashed: {p}");
            assert!(Path::new(&p).is_file(), "mpv path must exist: {p}");
            paths.push(p);
        }
        assert_ne!(paths[0], paths[1]);
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn picks_exact_luma_variant_over_chroma() {
        assert_eq!(pick_asset(&assets(), "C4F16"), Some("u_luma"));
        assert_eq!(pick_asset(&assets(), "C4F32"), Some("u_32"));
        assert_eq!(pick_asset(&assets(), "NOPE"), None);
    }

    #[test]
    fn picks_exact_chroma_variant() {
        assert_eq!(pick_asset(&assets(), "C4F16_Chroma"), Some("u_chroma"));
    }

    #[test]
    fn resolves_against_the_real_upstream_asset_list() {
        // Asset names captured from the live release index (v1.6.2, 2026-08-01). Upstream ships
        // `.glsl` only for the luma models; every chroma model is `.onnx`, which mpv can't load —
        // so the chroma pass legitimately resolves to None and must stay OPTIONAL in the frontend.
        // If this test starts failing on the chroma line, upstream shipped one: wire it up.
        let live: Vec<(String, String)> = [
            "C4F16.glsl",
            "C4F16.onnx",
            "C4F16_DN.glsl",
            "C4F16_DN.onnx",
            "C4F16_DS.glsl",
            "C4F16_DS.onnx",
            "C4F32.glsl",
            "C4F32.onnx",
            "C4F32_DN.glsl",
            "C4F32_DN.onnx",
            "C4F32_DS.glsl",
            "C4F32_DS.onnx",
            "R16F96.onnx",
            "R8F64.onnx",
            "R8F64_Chroma.onnx",
            "R8F64_Chroma_DN.onnx",
            "R8F64_JPEG420.onnx",
            "R8F64_JPEG444.onnx",
        ]
        .iter()
        .map(|n| (format!("{ASSET_PREFIX}{n}"), format!("url/{n}")))
        .collect();

        assert_eq!(pick_asset(&live, "C4F16"), Some("url/C4F16.glsl"));
        assert_eq!(pick_asset(&live, "C4F32"), Some("url/C4F32.glsl"));
        assert_eq!(pick_asset(&live, "C4F16_DS"), Some("url/C4F16_DS.glsl"));
        assert_eq!(pick_asset(&live, "C4F16_Chroma"), None);
    }

    #[test]
    fn fuzzy_fallback_still_separates_luma_from_chroma() {
        // Simulate an upstream rename so the exact match misses and the fallback has to decide.
        let renamed = vec![
            (
                format!("{ASSET_PREFIX}C4F16_Chroma_v2.glsl"),
                "u_chroma".to_string(),
            ),
            (format!("{ASSET_PREFIX}C4F16_v2.glsl"), "u_luma".to_string()),
        ];
        assert_eq!(pick_asset(&renamed, "C4F16"), Some("u_luma"));
        assert_eq!(pick_asset(&renamed, "C4F16_Chroma"), Some("u_chroma"));
    }
}
