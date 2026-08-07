use tauri::AppHandle;

#[derive(Clone, Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InstalledExtension {
    pub id: String,
    pub name: String,
    pub version: String,
    pub lang: Option<String>,
    pub description: Option<String>,
    pub code: Option<String>,
    pub backend: String,
    pub source_id: String,
    pub source_ids: Vec<String>,
    pub signed: bool,
}

mod package {
    use super::InstalledExtension;
    use base64::Engine;
    use ed25519_dalek::pkcs8::DecodePublicKey;
    use ed25519_dalek::{Signature, Verifier, VerifyingKey};
    use futures_util::StreamExt;
    use serde_json::Value;
    use sha2::{Digest, Sha256};
    use std::collections::{BTreeMap, BTreeSet};
    use std::io::{Cursor, Read};
    use std::path::{Path, PathBuf};
    use tauri::{AppHandle, Manager};
    use zip::ZipArchive;

    const MAX_PACKAGE_BYTES: usize = 8 * 1024 * 1024;
    const MAX_ENTRY_BYTES: usize = 6 * 1024 * 1024;

    fn read_entry<R: std::io::Read + std::io::Seek>(
        archive: &mut ZipArchive<R>,
        name: &str,
    ) -> Result<Vec<u8>, String> {
        let file = archive
            .by_name(name)
            .map_err(|_| format!("Package is missing {name}"))?;
        if file.is_dir() || file.size() as usize > MAX_ENTRY_BYTES {
            return Err(format!("Package entry is invalid or too large: {name}"));
        }
        let mut bytes = Vec::with_capacity(file.size() as usize);
        file.take((MAX_ENTRY_BYTES + 1) as u64)
            .read_to_end(&mut bytes)
            .map_err(|e| e.to_string())?;
        if bytes.len() > MAX_ENTRY_BYTES {
            return Err(format!("Package entry is too large: {name}"));
        }
        Ok(bytes)
    }

    fn json(bytes: &[u8], name: &str) -> Result<Value, String> {
        serde_json::from_slice(bytes).map_err(|_| format!("{name} is not valid JSON"))
    }

    fn string<'a>(value: &'a Value, key: &str) -> Result<&'a str, String> {
        value
            .get(key)
            .and_then(Value::as_str)
            .filter(|value| !value.is_empty())
            .ok_or_else(|| format!("Manifest field {key} is missing"))
    }

    fn safe_id(value: &str) -> bool {
        !value.is_empty()
            && value.len() <= 200
            && value
                .bytes()
                .all(|byte| byte.is_ascii_alphanumeric() || b"._-".contains(&byte))
    }

    fn sha256(bytes: &[u8]) -> String {
        format!("{:x}", Sha256::digest(bytes))
    }

    fn canonical_json(value: &Value) -> String {
        match value {
            Value::Null => "null".into(),
            Value::Bool(value) => value.to_string(),
            Value::Number(value) => value.to_string(),
            Value::String(value) => serde_json::to_string(value).unwrap_or_default(),
            Value::Array(values) => format!(
                "[{}]",
                values
                    .iter()
                    .map(canonical_json)
                    .collect::<Vec<_>>()
                    .join(",")
            ),
            Value::Object(values) => {
                let sorted = values.iter().collect::<BTreeMap<_, _>>();
                format!(
                    "{{{}}}",
                    sorted
                        .into_iter()
                        .map(|(key, value)| format!(
                            "{}:{}",
                            serde_json::to_string(key).unwrap_or_default(),
                            canonical_json(value)
                        ))
                        .collect::<Vec<_>>()
                        .join(",")
                )
            }
        }
    }

    fn verify_signature(signature: &Value, integrity: &Value) -> Result<bool, String> {
        let signed = signature
            .get("signed")
            .and_then(Value::as_bool)
            .unwrap_or(false);
        if !signed {
            if signature.get("algorithm").and_then(Value::as_str) != Some("none") {
                return Err("Unsigned package has an invalid signature marker".into());
            }
            return Ok(false);
        }
        if signature.get("algorithm").and_then(Value::as_str) != Some("Ed25519") {
            return Err("Unsupported extension signature algorithm".into());
        }
        let public_key = signature
            .get("publicKey")
            .and_then(Value::as_str)
            .ok_or("Signed package has no public key")?;
        let encoded = signature
            .get("signature")
            .and_then(Value::as_str)
            .ok_or("Signed package has no signature")?;
        let public_key_der = base64::engine::general_purpose::STANDARD
            .decode(
                public_key
                    .lines()
                    .filter(|line| !line.starts_with("-----"))
                    .collect::<String>(),
            )
            .map_err(|_| "Extension public key PEM is invalid")?;
        let key = VerifyingKey::from_public_key_der(&public_key_der)
            .map_err(|_| "Extension public key is invalid")?;
        let signature_bytes = base64::engine::general_purpose::STANDARD
            .decode(encoded)
            .map_err(|_| "Extension signature is not valid base64")?;
        let signature = Signature::from_slice(&signature_bytes)
            .map_err(|_| "Extension signature has the wrong length")?;
        key.verify(canonical_json(integrity).as_bytes(), &signature)
            .map_err(|_| "Extension signature verification failed")?;
        Ok(true)
    }

    fn is_android_apk(bytes: &[u8]) -> bool {
        let Ok(mut archive) = ZipArchive::new(Cursor::new(bytes)) else {
            return false;
        };
        archive.by_name("AndroidManifest.xml").is_ok() && archive.by_name("classes.dex").is_ok()
    }

    // Finder and some macOS ZIP tools add bookkeeping entries without changing the packaged
    // payload. They are never read or extracted by Izumi, so exclude only those well-known
    // metadata names (and directory markers) from the strict signed-file allowlist below.
    fn is_ignorable_package_entry(name: &str, is_dir: bool) -> bool {
        if is_dir {
            return true;
        }
        let normalized = name.replace('\\', "/");
        let basename = normalized.rsplit('/').next().unwrap_or(&normalized);
        normalized.starts_with("__MACOSX/") || basename == ".DS_Store" || basename.starts_with("._")
    }

    fn parse_package(bytes: &[u8]) -> Result<(InstalledExtension, Option<Vec<u8>>), String> {
        if bytes.is_empty() || bytes.len() > MAX_PACKAGE_BYTES {
            return Err("Extension package is empty or too large".into());
        }
        let mut archive =
            ZipArchive::new(Cursor::new(bytes)).map_err(|_| "Extension package is not a ZIP")?;
        let manifest_bytes = read_entry(&mut archive, "manifest.json")?;
        let manifest = json(&manifest_bytes, "manifest.json")?;
        let backend = manifest
            .pointer("/execution/backend")
            .and_then(Value::as_str)
            .ok_or("Extension package has no execution backend")?;
        let entry = match backend {
            "izumi-js" => "extension.js",
            "aniyomi-jvm" => "extension.jar",
            _ => return Err("Extension package uses an unsupported backend".into()),
        };
        let required = [
            "compatibility.json",
            entry,
            "integrity.json",
            "manifest.json",
            "signature.json",
        ];
        let actual_entries = (0..archive.len())
            .map(|index| {
                archive
                    .by_index(index)
                    .map(|file| {
                        let name = file.name().to_string();
                        (!is_ignorable_package_entry(&name, file.is_dir())).then_some(name)
                    })
                    .map_err(|e| e.to_string())
            })
            .collect::<Result<Vec<_>, _>>()?
            .into_iter()
            .flatten()
            .collect::<Vec<_>>();
        let actual = actual_entries.iter().cloned().collect::<BTreeSet<_>>();
        let mut expected = required
            .into_iter()
            .map(ToOwned::to_owned)
            .collect::<BTreeSet<_>>();
        let has_android_entry = backend == "aniyomi-jvm" && actual.contains("extension.apk");
        if has_android_entry {
            expected.insert("extension.apk".to_string());
        }
        // Compare both the set and count: a duplicate manifest/payload is still rejected, since
        // ZipArchive::by_name would otherwise make duplicate-name precedence ambiguous.
        if actual_entries.len() != expected.len() || actual != expected {
            return Err("Extension package contains unexpected files".into());
        }

        let integrity_bytes = read_entry(&mut archive, "integrity.json")?;
        let signature_bytes = read_entry(&mut archive, "signature.json")?;
        let entry_bytes = read_entry(&mut archive, entry)?;
        let android_entry_bytes = has_android_entry
            .then(|| read_entry(&mut archive, "extension.apk"))
            .transpose()?;
        let compatibility_bytes = read_entry(&mut archive, "compatibility.json")?;
        let integrity = json(&integrity_bytes, "integrity.json")?;
        let signature = json(&signature_bytes, "signature.json")?;
        let compatibility = json(&compatibility_bytes, "compatibility.json")?;

        if manifest.get("formatVersion").and_then(Value::as_u64) != Some(1)
            || manifest.get("runtimeAbi").and_then(Value::as_u64) != Some(1)
        {
            return Err("Extension package requires an unsupported ABI".into());
        }
        if manifest
            .pointer("/execution/status")
            .and_then(Value::as_str)
            != Some("compatible")
        {
            return Err("Extension package is not marked compatible".into());
        }
        if string(&manifest, "entry")? != entry {
            return Err(format!("Extension package entry must be {entry}"));
        }
        let compatibility_runtime = compatibility.get("runtime").and_then(Value::as_str);
        let expected_runtime = if backend == "aniyomi-jvm" {
            "izumi-aniyomi-jvm-v1"
        } else {
            "izumi-anime-extension-v1"
        };
        if compatibility_runtime != Some(expected_runtime) {
            return Err("Extension compatibility runtime is unsupported".into());
        }
        let id = string(&manifest, "id")?.to_string();
        if !safe_id(&id) {
            return Err("Extension id is unsafe".into());
        }

        let integrity_files = integrity
            .get("files")
            .and_then(Value::as_object)
            .ok_or("Extension integrity file is invalid")?;
        let mut expected_hashes = vec![
            ("manifest.json", &manifest_bytes),
            ("compatibility.json", &compatibility_bytes),
            (entry, &entry_bytes),
        ];
        if let Some(android_entry) = android_entry_bytes.as_ref() {
            expected_hashes.push(("extension.apk", android_entry));
        }
        if integrity.get("algorithm").and_then(Value::as_str) != Some("SHA-256")
            || integrity_files.len() != expected_hashes.len()
        {
            return Err("Extension integrity algorithm or file list is invalid".into());
        }
        for (name, contents) in expected_hashes {
            let expected = integrity_files
                .get(name)
                .and_then(Value::as_str)
                .ok_or_else(|| format!("Integrity list is missing {name}"))?;
            if sha256(contents) != expected {
                return Err(format!("Extension integrity check failed for {name}"));
            }
        }
        let signed = verify_signature(&signature, &integrity)?;
        let code = if backend == "izumi-js" {
            Some(
                String::from_utf8(entry_bytes.clone())
                    .map_err(|_| "Extension module is not UTF-8")?,
            )
        } else {
            if !entry_bytes.starts_with(b"PK") {
                return Err("Aniyomi extension entry is not an APK/JAR archive".into());
            }
            None
        };
        if let Some(android_entry) = android_entry_bytes.as_ref() {
            if !is_android_apk(android_entry) {
                return Err("Aniyomi Android entry is not a valid extension APK".into());
            }
        }
        #[cfg(target_os = "android")]
        if backend == "aniyomi-jvm" && android_entry_bytes.is_none() {
            return Err(
                "This extension package predates Android support; update it from the store".into(),
            );
        }
        let sources = manifest
            .get("sources")
            .and_then(Value::as_array)
            .ok_or("Extension manifest has no anime sources")?;
        let source = sources
            .first()
            .ok_or("Extension manifest has no anime source")?;
        let source_ids = sources
            .iter()
            .map(|source| {
                source
                    .get("id")
                    .and_then(Value::as_str)
                    .filter(|id| !id.is_empty())
                    .map(ToOwned::to_owned)
                    .ok_or_else(|| "Extension manifest source has no id".to_string())
            })
            .collect::<Result<Vec<_>, _>>()?;

        let installed = InstalledExtension {
            id,
            name: source
                .get("name")
                .and_then(Value::as_str)
                .unwrap_or(string(&manifest, "name")?)
                .to_string(),
            version: string(&manifest, "version")?.to_string(),
            lang: source
                .get("language")
                .and_then(Value::as_str)
                .map(ToOwned::to_owned),
            description: Some(format!(
                "Anime HTTP source imported from {}",
                source
                    .get("baseUrl")
                    .and_then(Value::as_str)
                    .unwrap_or("its upstream extension")
            )),
            code,
            backend: backend.to_string(),
            source_id: source
                .get("id")
                .and_then(Value::as_str)
                .ok_or("Extension manifest source has no id")?
                .to_string(),
            source_ids,
            signed,
        };
        let runtime_entry = if backend == "aniyomi-jvm" {
            #[cfg(target_os = "android")]
            {
                android_entry_bytes
            }
            #[cfg(not(target_os = "android"))]
            {
                Some(entry_bytes)
            }
        } else {
            None
        };
        Ok((installed, runtime_entry))
    }

    fn extension_dir(app: &AppHandle) -> Result<PathBuf, String> {
        app.path()
            .app_data_dir()
            .map_err(|e| e.to_string())
            .map(|path| path.join("extensions"))
    }

    fn package_path(app: &AppHandle, id: &str) -> Result<PathBuf, String> {
        if !safe_id(id) {
            return Err("Extension id is unsafe".into());
        }
        Ok(extension_dir(app)?.join(format!("{id}.izumi-ext")))
    }

    fn jvm_dir(app: &AppHandle) -> Result<PathBuf, String> {
        #[cfg(target_os = "android")]
        return Ok(android_runtime_root(app)?.join("exts"));
        #[cfg(not(target_os = "android"))]
        Ok(extension_dir(app)?.join("jvm"))
    }

    fn jvm_path(app: &AppHandle, id: &str) -> Result<PathBuf, String> {
        if !safe_id(id) {
            return Err("Extension id is unsafe".into());
        }
        #[cfg(target_os = "android")]
        return Ok(jvm_dir(app)?.join(format!("{id}.apk")));
        #[cfg(not(target_os = "android"))]
        Ok(jvm_dir(app)?.join(format!("{id}.jar")))
    }

    #[cfg(target_os = "android")]
    pub fn android_runtime_root(app: &AppHandle) -> Result<PathBuf, String> {
        Ok(extension_dir(app)?.join("android"))
    }

    fn store_jvm_entry(app: &AppHandle, id: &str, payload: Option<&[u8]>) -> Result<(), String> {
        let Some(payload) = payload else {
            return Ok(());
        };
        let dir = jvm_dir(app)?;
        std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
        let destination = jvm_path(app, id)?;
        if std::fs::read(&destination)
            .map(|existing| sha256(&existing) == sha256(payload))
            .unwrap_or(false)
        {
            return Ok(());
        }
        let temporary = destination.with_extension("part");
        std::fs::write(&temporary, payload).map_err(|e| e.to_string())?;
        if destination.exists() {
            std::fs::remove_file(&destination).map_err(|e| e.to_string())?;
        }
        std::fs::rename(temporary, destination).map_err(|e| e.to_string())
    }

    fn install_bytes(app: &AppHandle, bytes: Vec<u8>) -> Result<InstalledExtension, String> {
        let (extension, jar) = parse_package(&bytes)?;
        let dir = extension_dir(app)?;
        std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
        let destination = package_path(app, &extension.id)?;
        let temporary = destination.with_extension("izumi-ext.part");
        std::fs::write(&temporary, bytes).map_err(|e| e.to_string())?;
        if destination.exists() {
            std::fs::remove_file(&destination).map_err(|e| e.to_string())?;
        }
        std::fs::rename(&temporary, &destination).map_err(|e| e.to_string())?;
        store_jvm_entry(app, &extension.id, jar.as_deref())?;
        Ok(extension)
    }

    pub fn install(app: &AppHandle, path: &Path) -> Result<InstalledExtension, String> {
        if path.extension().and_then(|value| value.to_str()) != Some("izumi-ext") {
            return Err("Choose an .izumi-ext package".into());
        }
        install_bytes(app, std::fs::read(path).map_err(|e| e.to_string())?)
    }

    pub async fn install_url(
        app: &AppHandle,
        url: &str,
        expected_sha256: &str,
    ) -> Result<InstalledExtension, String> {
        let parsed = reqwest::Url::parse(url).map_err(|_| "Extension package URL is invalid")?;
        if parsed.scheme() != "https" {
            return Err("Extension packages must use HTTPS".into());
        }
        if expected_sha256.len() != 64
            || !expected_sha256.bytes().all(|byte| byte.is_ascii_hexdigit())
        {
            return Err("Extension package SHA-256 is invalid".into());
        }
        let response = reqwest::get(parsed)
            .await
            .map_err(|error| format!("Could not download extension package: {error}"))?
            .error_for_status()
            .map_err(|error| format!("Could not download extension package: {error}"))?;
        if response
            .content_length()
            .is_some_and(|length| length > MAX_PACKAGE_BYTES as u64)
        {
            return Err("Extension package is too large".into());
        }
        let mut bytes = Vec::new();
        let mut stream = response.bytes_stream();
        while let Some(chunk) = stream.next().await {
            let chunk =
                chunk.map_err(|error| format!("Could not read extension package: {error}"))?;
            if bytes.len().saturating_add(chunk.len()) > MAX_PACKAGE_BYTES {
                return Err("Extension package is too large".into());
            }
            bytes.extend_from_slice(&chunk);
        }
        if sha256(&bytes) != expected_sha256.to_ascii_lowercase() {
            return Err("Downloaded extension package failed its SHA-256 check".into());
        }
        install_bytes(app, bytes)
    }

    pub fn list(app: &AppHandle) -> Result<Vec<InstalledExtension>, String> {
        let dir = extension_dir(app)?;
        let mut extensions = Vec::new();
        let entries = match std::fs::read_dir(dir) {
            Ok(entries) => entries,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(extensions),
            Err(error) => return Err(error.to_string()),
        };
        for entry in entries.flatten() {
            let path = entry.path();
            if path.extension().and_then(|value| value.to_str()) != Some("izumi-ext") {
                continue;
            }
            if let Ok(bytes) = std::fs::read(path) {
                if let Ok((extension, jar)) = parse_package(&bytes) {
                    let _ = store_jvm_entry(app, &extension.id, jar.as_deref());
                    extensions.push(extension);
                }
            }
        }
        extensions.sort_by(|left, right| left.name.cmp(&right.name));
        Ok(extensions)
    }

    pub fn remove(app: &AppHandle, id: &str) -> Result<(), String> {
        let path = package_path(app, id)?;
        let package_result = match std::fs::remove_file(path) {
            Ok(()) => Ok(()),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
            Err(error) => Err(error.to_string()),
        };
        let jar_result = match std::fs::remove_file(jvm_path(app, id)?) {
            Ok(()) => Ok(()),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
            Err(error) => Err(error.to_string()),
        };
        package_result.and(jar_result)
    }

    #[cfg(test)]
    mod tests {
        use super::*;
        use base64::Engine;
        use ed25519_dalek::pkcs8::EncodePublicKey;
        use ed25519_dalek::{Signer, SigningKey};
        use std::io::Write;
        use zip::write::SimpleFileOptions;

        fn fixture(tamper_code: bool, signed: bool, extra: Option<(&str, &[u8])>) -> Vec<u8> {
            let manifest = br#"{
              "formatVersion":1,
              "runtimeAbi":1,
              "id":"example.allanime",
              "name":"AllAnime package",
              "version":"1.0.0",
              "entry":"extension.js",
              "execution":{"backend":"izumi-js","status":"compatible"},
              "sources":[
                {"id":"1","name":"AllAnime","language":"en","baseUrl":"https://example.test"},
                {"id":"2","name":"AllAnime Alt","language":"en","baseUrl":"https://alt.example.test"}
              ]
            }"#;
            let compatibility = br#"{"runtime":"izumi-anime-extension-v1"}"#;
            let code = b"export default { search() {}, findEpisodes() {}, findEpisodeServer() {}, getSettings() {} };";
            let integrity = serde_json::json!({
                "algorithm": "SHA-256",
                "files": {
                    "manifest.json": sha256(manifest),
                    "compatibility.json": sha256(compatibility),
                    "extension.js": sha256(code),
                }
            });
            let integrity_bytes = serde_json::to_vec(&integrity).unwrap();
            let signature = if signed {
                let key = SigningKey::from_bytes(&[7; 32]);
                let signed_bytes = key.sign(canonical_json(&integrity).as_bytes());
                let public_key_der = key.verifying_key().to_public_key_der().unwrap();
                let public_key = format!(
                    "-----BEGIN PUBLIC KEY-----\n{}\n-----END PUBLIC KEY-----\n",
                    base64::engine::general_purpose::STANDARD.encode(public_key_der.as_bytes())
                );
                serde_json::to_vec(&serde_json::json!({
                    "algorithm": "Ed25519",
                    "signed": true,
                    "publicKey": public_key,
                    "signature": base64::engine::general_purpose::STANDARD
                        .encode(signed_bytes.to_bytes()),
                }))
                .unwrap()
            } else {
                br#"{"algorithm":"none","signed":false,"signature":null}"#.to_vec()
            };
            let cursor = Cursor::new(Vec::new());
            let mut writer = zip::ZipWriter::new(cursor);
            let options =
                SimpleFileOptions::default().compression_method(zip::CompressionMethod::Stored);
            for (name, bytes) in [
                ("manifest.json", manifest.as_slice()),
                ("compatibility.json", compatibility.as_slice()),
                (
                    "extension.js",
                    if tamper_code {
                        b"export default {};".as_slice()
                    } else {
                        code.as_slice()
                    },
                ),
                ("integrity.json", integrity_bytes.as_slice()),
                ("signature.json", signature.as_slice()),
            ] {
                writer.start_file(name, options).unwrap();
                writer.write_all(bytes).unwrap();
            }
            if let Some((name, bytes)) = extra {
                writer.start_file(name, options).unwrap();
                writer.write_all(bytes).unwrap();
            }
            writer.finish().unwrap().into_inner()
        }

        #[test]
        fn accepts_a_valid_native_package() {
            let (parsed, jar) = parse_package(&fixture(false, false, None)).unwrap();
            assert_eq!(parsed.id, "example.allanime");
            assert_eq!(parsed.name, "AllAnime");
            assert_eq!(parsed.source_ids, ["1", "2"]);
            assert!(!parsed.signed);
            assert!(jar.is_none());
        }

        #[test]
        fn accepts_a_valid_signed_package() {
            assert!(parse_package(&fixture(false, true, None)).unwrap().0.signed);
        }

        #[test]
        fn rejects_tampered_extension_code() {
            assert!(parse_package(&fixture(true, false, None))
                .unwrap_err()
                .contains("integrity check failed"));
        }

        #[test]
        fn accepts_macos_zip_metadata_but_not_other_extra_files() {
            assert!(parse_package(&fixture(
                false,
                false,
                Some(("__MACOSX/._manifest.json", b"finder metadata")),
            ))
            .is_ok());
            assert!(
                parse_package(&fixture(false, false, Some(("extra.txt", b"nope"))))
                    .unwrap_err()
                    .contains("unexpected files")
            );
        }

        #[test]
        fn accepts_external_package_fixture_when_requested() {
            let Ok(path) = std::env::var("IZUMI_EXT_FIXTURE") else {
                return;
            };
            let bytes = std::fs::read(path).unwrap();
            let (parsed, _) = parse_package(&bytes).unwrap();
            assert_eq!(parsed.id, "eu.kanade.tachiyomi.animeextension.en.allanime");
            assert_eq!(parsed.name, "AllAnime");
        }
    }
}

#[tauri::command]
pub fn extension_install(app: AppHandle, path: String) -> Result<InstalledExtension, String> {
    package::install(&app, std::path::Path::new(&path))
}

#[tauri::command]
pub async fn extension_install_url(
    app: AppHandle,
    url: String,
    expected_sha256: String,
) -> Result<InstalledExtension, String> {
    package::install_url(&app, &url, &expected_sha256).await
}

#[tauri::command]
pub async fn extension_list(app: AppHandle) -> Result<Vec<InstalledExtension>, String> {
    // `async` matters: tauri-macros only picks `ExecutionContext::Async` when the fn is async, so
    // the sync version re-read, unzipped, SHA-256'd and signature-verified every installed package
    // inline on the event-loop thread — hundreds of milliseconds of frozen UI for a handful of
    // packages, paid several times per episode click.
    tauri::async_runtime::spawn_blocking(move || package::list(&app))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub fn extension_remove(app: AppHandle, id: String) -> Result<(), String> {
    package::remove(&app, &id)
}

#[cfg(target_os = "android")]
pub fn android_runtime_root(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    package::android_runtime_root(app)
}
