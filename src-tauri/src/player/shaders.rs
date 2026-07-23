//! On-demand ArtCNN shader fetch. The client ships no shaders; the Anime preset downloads the
//! requested ArtCNN variant from the pinned upstream repo (Artoriuz/ArtCNN) latest release and
//! caches it under the app config dir. Repo is hardcoded — never a user-supplied URL.

use std::path::PathBuf;

use tauri::{AppHandle, Manager};

/// Pick the release asset download URL for `variant` (e.g. "C4F16") from a list of
/// `(asset_name, download_url)` pairs. Prefers an exact `ArtCNN_<variant>.glsl`, else the first
/// `.glsl` whose name contains the variant token and is NOT a chroma variant (luma is the default).
pub(crate) fn pick_asset<'a>(assets: &'a [(String, String)], variant: &str) -> Option<&'a str> {
    let exact = format!("artcnn_{}.glsl", variant.to_ascii_lowercase());
    if let Some((_, url)) = assets.iter().find(|(n, _)| n.to_ascii_lowercase() == exact) {
        return Some(url.as_str());
    }
    assets
        .iter()
        .find(|(n, _)| {
            let n = n.to_ascii_lowercase();
            n.ends_with(".glsl") && n.contains(&variant.to_ascii_lowercase()) && !n.contains("chroma")
        })
        .map(|(_, url)| url.as_str())
}

/// Ensure the ArtCNN `variant` shader is present locally; download from the latest Artoriuz/ArtCNN
/// release if missing. Returns the absolute path (forward-slashed for mpv). Fails safe: any error
/// is returned as `Err` and the caller falls back to the shader-less High Quality chain.
pub async fn ensure(app: &AppHandle, variant: &str) -> Result<String, String> {
    // Defense-in-depth: `variant` is interpolated into a filesystem path below, so reject anything
    // that isn't a plain alphanumeric token (blocks path traversal if the caller is ever compromised).
    if variant.is_empty() || !variant.chars().all(|c| c.is_ascii_alphanumeric()) {
        return Err("invalid shader variant".to_string());
    }
    let dir = app.path().app_config_dir().map_err(|e| e.to_string())?.join("shaders");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let dest: PathBuf = dir.join(format!("ArtCNN_{variant}.glsl"));
    if dest.is_file() {
        return Ok(mpv_path(&dest));
    }
    let client = crate::http_client();
    let api = "https://api.github.com/repos/Artoriuz/ArtCNN/releases/latest";
    let resp = client
        .get(api)
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
    let text = resp.text().await.map_err(|_| "shader index read failed".to_string())?;
    let json: serde_json::Value = serde_json::from_str(&text).map_err(|_| "shader index parse failed".to_string())?;
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
    let url = pick_asset(&assets, variant).ok_or_else(|| format!("no ArtCNN_{variant} asset in latest release"))?;
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

    #[test]
    fn picks_exact_luma_variant_over_chroma() {
        let assets = vec![
            ("ArtCNN_C4F16_Chroma.glsl".to_string(), "u_chroma".to_string()),
            ("ArtCNN_C4F16.glsl".to_string(), "u_luma".to_string()),
            ("ArtCNN_C4F32.glsl".to_string(), "u_32".to_string()),
        ];
        assert_eq!(pick_asset(&assets, "C4F16"), Some("u_luma"));
        assert_eq!(pick_asset(&assets, "C4F32"), Some("u_32"));
        assert_eq!(pick_asset(&assets, "NOPE"), None);
    }
}
