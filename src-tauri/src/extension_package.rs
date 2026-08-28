use tauri::AppHandle;

#[derive(Clone, Debug, serde::Deserialize, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AniyomiInstallSource {
    pub id: String,
    pub name: String,
    pub language: Option<String>,
    pub base_url: Option<String>,
}

#[derive(Clone, Debug, serde::Deserialize, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AniyomiInstallMetadata {
    pub id: String,
    pub name: String,
    pub version: String,
    pub language: Option<String>,
    pub nsfw: bool,
    pub sources: Vec<AniyomiInstallSource>,
}

#[derive(Clone, Debug, serde::Deserialize, serde::Serialize)]
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
    pub service_entry: Option<String>,
}

mod package {
    use super::{AniyomiInstallMetadata, InstalledExtension};
    use base64::Engine;
    use ed25519_dalek::pkcs8::DecodePublicKey;
    use ed25519_dalek::{Signature, Verifier, VerifyingKey};
    use futures_util::StreamExt;
    use serde_json::Value;
    use sha2::{Digest, Sha256};
    use std::collections::{BTreeMap, BTreeSet};
    use std::io::{Cursor, Read, Write};
    use std::path::{Path, PathBuf};
    use tauri::{AppHandle, Manager};
    use zip::write::SimpleFileOptions;
    use zip::{CompressionMethod, ZipArchive, ZipWriter};

    // Native service packages can contain a self-contained runtime. The strict signed file list,
    // per-file hashes and package signature still apply; only the size ceiling differs from JS/JVM.
    const MAX_PACKAGE_BYTES: usize = 160 * 1024 * 1024;
    const MAX_ENTRY_BYTES: usize = 152 * 1024 * 1024;
    const MAX_ANIYOMI_APK_BYTES: usize = 32 * 1024 * 1024;
    // v2 rebuilds desktop Aniyomi runtime JARs with resources preserved from their signed APK.
    const PACKAGE_CACHE_VERSION: u8 = 2;

    #[derive(serde::Deserialize, serde::Serialize)]
    #[serde(rename_all = "camelCase")]
    struct PackageCache {
        version: u8,
        package_bytes: u64,
        modified_ns: u128,
        extension: InstalledExtension,
    }

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

    pub fn validate_aniyomi_metadata(metadata: &AniyomiInstallMetadata) -> Result<(), String> {
        if !safe_id(&metadata.id)
            || !metadata
                .id
                .starts_with("eu.kanade.tachiyomi.animeextension.")
        {
            return Err("Aniyomi extension id is invalid".into());
        }
        if metadata.name.trim().is_empty()
            || metadata.name.len() > 512
            || metadata.version.trim().is_empty()
            || metadata.version.len() > 128
            || metadata
                .language
                .as_ref()
                .is_some_and(|value| value.len() > 32)
            || metadata.sources.is_empty()
            || metadata.sources.len() > 100
        {
            return Err("Aniyomi extension metadata is invalid".into());
        }
        for source in &metadata.sources {
            if source.id.trim().is_empty()
                || source.id.len() > 200
                || source.name.trim().is_empty()
                || source.name.len() > 512
                || source
                    .language
                    .as_ref()
                    .is_some_and(|value| value.len() > 32)
                || source
                    .base_url
                    .as_ref()
                    .is_some_and(|value| value.len() > 2048)
            {
                return Err("Aniyomi source metadata is invalid".into());
            }
        }
        Ok(())
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

    /// The desktop runtime loads the converted JAR, while many Aniyomi extensions load scripts
    /// and configuration with `Class.getResource("/assets/…")`. Some published conversions lost
    /// those APK resources even though the signed package still carries the original APK. Rebuild
    /// the runtime copy after signature verification, preserving every converted class and adding
    /// only the missing classpath resources. The signed `.izumi-ext` itself is never modified.
    #[cfg(not(target_os = "android"))]
    fn repair_aniyomi_jar_resources(jar_bytes: &[u8], apk_bytes: &[u8]) -> Result<Vec<u8>, String> {
        let mut jar = ZipArchive::new(Cursor::new(jar_bytes))
            .map_err(|_| "Aniyomi extension JAR is invalid")?;
        let mut apk = ZipArchive::new(Cursor::new(apk_bytes))
            .map_err(|_| "Aniyomi extension APK is invalid")?;
        let mut written = BTreeSet::new();
        let mut uncompressed_bytes = 0_u64;
        let mut output = ZipWriter::new(Cursor::new(Vec::new()));
        let options = SimpleFileOptions::default().compression_method(CompressionMethod::Deflated);

        for index in 0..jar.len() {
            let mut entry = jar.by_index(index).map_err(|error| error.to_string())?;
            if entry.is_dir() || !written.insert(entry.name().to_string()) {
                continue;
            }
            if entry.size() as usize > MAX_ENTRY_BYTES {
                return Err("Aniyomi extension JAR entry is too large".into());
            }
            uncompressed_bytes = uncompressed_bytes.saturating_add(entry.size());
            if uncompressed_bytes > MAX_ENTRY_BYTES as u64 {
                return Err("Aniyomi extension JAR expands beyond the safety limit".into());
            }
            output
                .start_file(entry.name(), options)
                .map_err(|error| error.to_string())?;
            std::io::copy(&mut entry, &mut output).map_err(|error| error.to_string())?;
        }

        for index in 0..apk.len() {
            let mut entry = apk.by_index(index).map_err(|error| error.to_string())?;
            let name = entry.name().replace('\\', "/");
            let is_classpath_resource = name == "manifest.json" || name.starts_with("assets/");
            if entry.is_dir() || !is_classpath_resource || !written.insert(name.clone()) {
                continue;
            }
            if entry.size() as usize > MAX_ENTRY_BYTES {
                return Err("Aniyomi extension APK resource is too large".into());
            }
            uncompressed_bytes = uncompressed_bytes.saturating_add(entry.size());
            if uncompressed_bytes > MAX_ENTRY_BYTES as u64 {
                return Err("Aniyomi extension resources expand beyond the safety limit".into());
            }
            output
                .start_file(name, options)
                .map_err(|error| error.to_string())?;
            std::io::copy(&mut entry, &mut output).map_err(|error| error.to_string())?;
        }

        output
            .finish()
            .map(|cursor| cursor.into_inner())
            .map_err(|error| error.to_string())
    }

    fn service_filename() -> &'static str {
        if cfg!(windows) {
            "service.exe"
        } else {
            "service"
        }
    }

    fn service_platform() -> &'static str {
        #[cfg(all(windows, target_arch = "x86_64"))]
        return "windows-x86_64";
        #[cfg(all(windows, target_arch = "aarch64"))]
        return "windows-aarch64";
        #[cfg(all(target_os = "linux", target_arch = "x86_64"))]
        return "linux-x86_64";
        #[cfg(all(target_os = "linux", target_arch = "aarch64"))]
        return "linux-aarch64";
        #[cfg(all(target_os = "macos", target_arch = "x86_64"))]
        return "macos-x86_64";
        #[cfg(all(target_os = "macos", target_arch = "aarch64"))]
        return "macos-aarch64";
        #[allow(unreachable_code)]
        "unsupported"
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
            "izumi-service" => service_filename(),
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
        let expected_runtime = match backend {
            "aniyomi-jvm" => "izumi-aniyomi-jvm-v1",
            "izumi-service" => "izumi-local-service-v1",
            _ => "izumi-anime-extension-v1",
        };
        if compatibility_runtime != Some(expected_runtime) {
            return Err("Extension compatibility runtime is unsupported".into());
        }
        if backend == "izumi-service"
            && compatibility.get("platform").and_then(Value::as_str) != Some(service_platform())
        {
            return Err(format!(
                "Extension service is not built for {}",
                service_platform()
            ));
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
        if backend == "izumi-service" && !signed {
            return Err("Native extension services must be signed".into());
        }
        let code = match backend {
            "izumi-js" => Some(
                String::from_utf8(entry_bytes.clone())
                    .map_err(|_| "Extension module is not UTF-8")?,
            ),
            "aniyomi-jvm" => {
                if !entry_bytes.starts_with(b"PK") {
                    return Err("Aniyomi extension entry is not an APK/JAR archive".into());
                }
                None
            }
            _ => None,
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
            service_entry: (backend == "izumi-service").then(|| entry.to_string()),
        };
        let runtime_entry = if backend == "aniyomi-jvm" {
            #[cfg(target_os = "android")]
            {
                android_entry_bytes
            }
            #[cfg(not(target_os = "android"))]
            {
                match android_entry_bytes.as_deref() {
                    Some(apk) => Some(repair_aniyomi_jar_resources(&entry_bytes, apk)?),
                    None => Some(entry_bytes),
                }
            }
        } else if backend == "izumi-service" {
            Some(entry_bytes)
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

    fn cache_path(app: &AppHandle, id: &str) -> Result<PathBuf, String> {
        if !safe_id(id) {
            return Err("Extension id is unsafe".into());
        }
        Ok(extension_dir(app)?
            .join("metadata")
            .join(format!("{id}.json")))
    }

    fn package_stamp(path: &Path) -> Result<(u64, u128), String> {
        let metadata = std::fs::metadata(path).map_err(|e| e.to_string())?;
        let modified_ns = metadata
            .modified()
            .map_err(|e| e.to_string())?
            .duration_since(std::time::UNIX_EPOCH)
            .map_err(|e| e.to_string())?
            .as_nanos();
        Ok((metadata.len(), modified_ns))
    }

    fn cached_extension(
        app: &AppHandle,
        package: &Path,
        id: &str,
    ) -> Result<InstalledExtension, String> {
        let cache: PackageCache = serde_json::from_slice(
            &std::fs::read(cache_path(app, id)?).map_err(|e| e.to_string())?,
        )
        .map_err(|e| e.to_string())?;
        let (package_bytes, modified_ns) = package_stamp(package)?;
        if cache.version != PACKAGE_CACHE_VERSION
            || cache.package_bytes != package_bytes
            || cache.modified_ns != modified_ns
            || cache.extension.id != id
        {
            return Err("Extension package cache is stale".into());
        }
        Ok(cache.extension)
    }

    fn store_cache(
        app: &AppHandle,
        package: &Path,
        extension: &InstalledExtension,
    ) -> Result<(), String> {
        let (package_bytes, modified_ns) = package_stamp(package)?;
        let destination = cache_path(app, &extension.id)?;
        if let Some(parent) = destination.parent() {
            std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        let temporary = destination.with_extension("json.part");
        let cache = PackageCache {
            version: PACKAGE_CACHE_VERSION,
            package_bytes,
            modified_ns,
            extension: extension.clone(),
        };
        std::fs::write(
            &temporary,
            serde_json::to_vec(&cache).map_err(|e| e.to_string())?,
        )
        .map_err(|e| e.to_string())?;
        if destination.exists() {
            std::fs::remove_file(&destination).map_err(|e| e.to_string())?;
        }
        std::fs::rename(temporary, destination).map_err(|e| e.to_string())
    }

    fn runtime_present(app: &AppHandle, extension: &InstalledExtension) -> bool {
        match extension.backend.as_str() {
            "aniyomi-jvm" => jvm_path(app, &extension.id).is_ok_and(|path| path.is_file()),
            "izumi-service" => service_path(app, &extension.id).is_ok_and(|path| path.is_file()),
            _ => true,
        }
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

    fn service_dir(app: &AppHandle, id: &str) -> Result<PathBuf, String> {
        if !safe_id(id) {
            return Err("Extension id is unsafe".into());
        }
        Ok(extension_dir(app)?.join("services").join(id))
    }

    fn service_path(app: &AppHandle, id: &str) -> Result<PathBuf, String> {
        Ok(service_dir(app, id)?.join(service_filename()))
    }

    #[cfg(target_os = "android")]
    pub fn android_runtime_root(app: &AppHandle) -> Result<PathBuf, String> {
        Ok(extension_dir(app)?.join("android"))
    }

    fn store_runtime_entry(
        app: &AppHandle,
        extension: &InstalledExtension,
        payload: Option<&[u8]>,
    ) -> Result<(), String> {
        let Some(payload) = payload else {
            return Ok(());
        };
        let service = extension.backend == "izumi-service";
        let dir = if service {
            service_dir(app, &extension.id)?
        } else {
            jvm_dir(app)?
        };
        std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
        let destination = if service {
            service_path(app, &extension.id)?
        } else {
            jvm_path(app, &extension.id)?
        };
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
        std::fs::rename(temporary, &destination).map_err(|e| e.to_string())?;
        #[cfg(not(target_os = "android"))]
        if extension.backend == "aniyomi-jvm" {
            let marker = jvm_dir(app)?.join(format!("{}.multidex.sha256", extension.id));
            match std::fs::remove_file(marker) {
                Ok(()) => {}
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
                Err(error) => return Err(error.to_string()),
            }
        }
        #[cfg(unix)]
        if service {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(&destination, std::fs::Permissions::from_mode(0o700))
                .map_err(|e| e.to_string())?;
        }
        Ok(())
    }

    #[cfg(not(target_os = "android"))]
    pub fn multidex_packages(app: &AppHandle) -> Result<Vec<(String, Vec<u8>, String)>, String> {
        let dir = extension_dir(app)?;
        let entries = match std::fs::read_dir(dir) {
            Ok(entries) => entries,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
            Err(error) => return Err(error.to_string()),
        };
        let mut result = Vec::new();
        for entry in entries.flatten() {
            let path = entry.path();
            if path.extension().and_then(|value| value.to_str()) != Some("izumi-ext") {
                continue;
            }
            let package_bytes = std::fs::read(&path).map_err(|error| error.to_string())?;
            let (extension, _) = parse_package(&package_bytes)?;
            if extension.backend != "aniyomi-jvm" {
                continue;
            }
            let mut package = ZipArchive::new(Cursor::new(package_bytes))
                .map_err(|_| "Extension package is not a ZIP")?;
            if package.by_name("extension.apk").is_err() {
                continue;
            }
            let apk = read_entry(&mut package, "extension.apk")?;
            let mut apk_archive = ZipArchive::new(Cursor::new(&apk))
                .map_err(|_| "Aniyomi extension APK is invalid")?;
            let dex_files = (0..apk_archive.len())
                .filter_map(|index| {
                    apk_archive
                        .by_index(index)
                        .ok()
                        .map(|entry| entry.name().to_string())
                })
                .filter(|name| {
                    name == "classes.dex"
                        || name
                            .strip_prefix("classes")
                            .and_then(|rest| rest.strip_suffix(".dex"))
                            .is_some_and(|number| {
                                !number.is_empty()
                                    && number.bytes().all(|byte| byte.is_ascii_digit())
                            })
                })
                .count();
            if dex_files > 1 {
                let digest = sha256(&apk);
                result.push((extension.id, apk, digest));
            }
        }
        Ok(result)
    }

    #[cfg(not(target_os = "android"))]
    pub fn store_converted_jvm_jar(
        app: &AppHandle,
        id: &str,
        converted_jar: &[u8],
        apk: &[u8],
    ) -> Result<(), String> {
        if !safe_id(id) {
            return Err("Extension id is unsafe".into());
        }
        let repaired = repair_aniyomi_jar_resources(converted_jar, apk)?;
        let destination = jvm_path(app, id)?;
        let parent = destination
            .parent()
            .ok_or("Aniyomi runtime path has no parent")?;
        std::fs::create_dir_all(parent).map_err(|error| error.to_string())?;
        let temporary = destination.with_extension("jar.part");
        std::fs::write(&temporary, repaired).map_err(|error| error.to_string())?;
        if destination.exists() {
            std::fs::remove_file(&destination).map_err(|error| error.to_string())?;
        }
        std::fs::rename(temporary, destination).map_err(|error| error.to_string())
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
        store_runtime_entry(app, &extension, jar.as_deref())?;
        store_cache(app, &destination, &extension)?;
        Ok(extension)
    }

    pub fn install(app: &AppHandle, path: &Path) -> Result<InstalledExtension, String> {
        if path.extension().and_then(|value| value.to_str()) != Some("izumi-ext") {
            return Err("Choose an .izumi-ext package".into());
        }
        install_bytes(app, std::fs::read(path).map_err(|e| e.to_string())?)
    }

    async fn download_https(
        url: &str,
        expected_sha256: Option<&str>,
        max_bytes: usize,
        label: &str,
    ) -> Result<Vec<u8>, String> {
        let parsed = reqwest::Url::parse(url).map_err(|_| format!("{label} URL is invalid"))?;
        if parsed.scheme() != "https" {
            return Err(format!("{label}s must use HTTPS"));
        }
        if expected_sha256.is_some_and(|expected| {
            expected.len() != 64 || !expected.bytes().all(|byte| byte.is_ascii_hexdigit())
        }) {
            return Err(format!("{label} SHA-256 is invalid"));
        }
        let response = reqwest::get(parsed)
            .await
            .map_err(|error| format!("Could not download {label}: {error}"))?
            .error_for_status()
            .map_err(|error| format!("Could not download {label}: {error}"))?;
        if response
            .content_length()
            .is_some_and(|length| length > max_bytes as u64)
        {
            return Err(format!("{label} is too large"));
        }
        let mut bytes = Vec::new();
        let mut stream = response.bytes_stream();
        while let Some(chunk) = stream.next().await {
            let chunk = chunk.map_err(|error| format!("Could not read {label}: {error}"))?;
            if bytes.len().saturating_add(chunk.len()) > max_bytes {
                return Err(format!("{label} is too large"));
            }
            bytes.extend_from_slice(&chunk);
        }
        if expected_sha256.is_some_and(|expected| sha256(&bytes) != expected.to_ascii_lowercase()) {
            return Err(format!("Downloaded {label} failed its SHA-256 check"));
        }
        Ok(bytes)
    }

    pub async fn install_url(
        app: &AppHandle,
        url: &str,
        expected_sha256: &str,
    ) -> Result<InstalledExtension, String> {
        let bytes = download_https(
            url,
            Some(expected_sha256),
            MAX_PACKAGE_BYTES,
            "extension package",
        )
        .await?;
        install_bytes(app, bytes)
    }

    pub async fn download_aniyomi_apk(
        url: &str,
        expected_sha256: Option<&str>,
    ) -> Result<Vec<u8>, String> {
        let bytes = download_https(
            url,
            expected_sha256,
            MAX_ANIYOMI_APK_BYTES,
            "Aniyomi extension APK",
        )
        .await?;
        if !is_android_apk(&bytes) {
            return Err("Downloaded file is not a valid Aniyomi extension APK".into());
        }
        Ok(bytes)
    }

    fn build_aniyomi_package(
        metadata: &AniyomiInstallMetadata,
        apk: &[u8],
        converted_jar: &[u8],
    ) -> Result<Vec<u8>, String> {
        validate_aniyomi_metadata(metadata)?;
        if !is_android_apk(apk) {
            return Err("Aniyomi Android entry is not a valid extension APK".into());
        }
        if converted_jar.is_empty()
            || converted_jar.len() > MAX_ENTRY_BYTES
            || !converted_jar.starts_with(b"PK")
        {
            return Err("Converted Aniyomi extension JAR is invalid or too large".into());
        }

        let manifest = serde_json::to_vec(&serde_json::json!({
            "formatVersion": 1,
            "runtimeAbi": 1,
            "id": metadata.id,
            "name": metadata.name,
            "version": metadata.version,
            "entry": "extension.jar",
            "nsfw": metadata.nsfw,
            "execution": { "backend": "aniyomi-jvm", "status": "compatible" },
            "sources": metadata.sources,
        }))
        .map_err(|error| error.to_string())?;
        let compatibility = br#"{"runtime":"izumi-aniyomi-jvm-v1"}"#.to_vec();
        let integrity = serde_json::to_vec(&serde_json::json!({
            "algorithm": "SHA-256",
            "files": {
                "manifest.json": sha256(&manifest),
                "compatibility.json": sha256(&compatibility),
                "extension.jar": sha256(converted_jar),
                "extension.apk": sha256(apk),
            }
        }))
        .map_err(|error| error.to_string())?;
        let signature = br#"{"algorithm":"none","signed":false,"signature":null}"#;
        let mut writer = ZipWriter::new(Cursor::new(Vec::new()));
        let options = SimpleFileOptions::default().compression_method(CompressionMethod::Stored);
        for (name, bytes) in [
            ("manifest.json", manifest.as_slice()),
            ("compatibility.json", compatibility.as_slice()),
            ("extension.jar", converted_jar),
            ("extension.apk", apk),
            ("integrity.json", integrity.as_slice()),
            ("signature.json", signature.as_slice()),
        ] {
            writer
                .start_file(name, options)
                .map_err(|error| error.to_string())?;
            writer.write_all(bytes).map_err(|error| error.to_string())?;
        }
        let package = writer
            .finish()
            .map_err(|error| error.to_string())?
            .into_inner();
        if package.len() > MAX_PACKAGE_BYTES {
            return Err("Generated extension package is too large".into());
        }
        Ok(package)
    }

    pub fn install_aniyomi(
        app: &AppHandle,
        metadata: &AniyomiInstallMetadata,
        apk: &[u8],
        converted_jar: &[u8],
    ) -> Result<InstalledExtension, String> {
        install_bytes(app, build_aniyomi_package(metadata, apk, converted_jar)?)
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
            let Some(id) = path.file_stem().and_then(|value| value.to_str()) else {
                continue;
            };
            if let Ok(extension) = cached_extension(app, &path, id) {
                if runtime_present(app, &extension) {
                    extensions.push(extension);
                    continue;
                }
            }
            if let Ok(bytes) = std::fs::read(&path) {
                if let Ok((extension, jar)) = parse_package(&bytes) {
                    let _ = store_runtime_entry(app, &extension, jar.as_deref());
                    let _ = store_cache(app, &path, &extension);
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
        let service_result = match std::fs::remove_dir_all(service_dir(app, id)?) {
            Ok(()) => Ok(()),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
            Err(error) => Err(error.to_string()),
        };
        let cache_result = match std::fs::remove_file(cache_path(app, id)?) {
            Ok(()) => Ok(()),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
            Err(error) => Err(error.to_string()),
        };
        #[cfg(not(target_os = "android"))]
        let marker_result =
            match std::fs::remove_file(jvm_dir(app)?.join(format!("{id}.multidex.sha256"))) {
                Ok(()) => Ok(()),
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
                Err(error) => Err(error.to_string()),
            };
        #[cfg(target_os = "android")]
        let marker_result: Result<(), String> = Ok(());
        package_result
            .and(jar_result)
            .and(service_result)
            .and(cache_result)
            .and(marker_result)
    }

    pub fn service_entry(app: &AppHandle, id: &str) -> Result<PathBuf, String> {
        let package = package_path(app, id)?;
        if let Ok(extension) = cached_extension(app, &package, id) {
            if extension.backend == "izumi-service"
                && extension.signed
                && runtime_present(app, &extension)
            {
                return service_path(app, id);
            }
        }
        let bytes = std::fs::read(&package).map_err(|e| e.to_string())?;
        let (extension, payload) = parse_package(&bytes)?;
        if extension.backend != "izumi-service" || !extension.signed {
            return Err("Extension is not a signed local service".into());
        }
        store_runtime_entry(app, &extension, payload.as_deref())?;
        store_cache(app, &package, &extension)?;
        service_path(app, id)
    }

    #[cfg(test)]
    mod tests {
        use super::*;
        use base64::Engine;
        use ed25519_dalek::pkcs8::EncodePublicKey;
        use ed25519_dalek::{Signer, SigningKey};
        use std::io::Write;
        use zip::write::SimpleFileOptions;

        #[cfg(not(target_os = "android"))]
        fn zip_entries(entries: &[(&str, &[u8])]) -> Vec<u8> {
            let mut writer = zip::ZipWriter::new(Cursor::new(Vec::new()));
            for (name, bytes) in entries {
                writer
                    .start_file(*name, SimpleFileOptions::default())
                    .unwrap();
                writer.write_all(bytes).unwrap();
            }
            writer.finish().unwrap().into_inner()
        }

        #[cfg(not(target_os = "android"))]
        #[test]
        fn wraps_a_repository_apk_as_a_valid_izumi_extension() {
            let apk = zip_entries(&[
                ("AndroidManifest.xml", b"android"),
                ("classes.dex", b"dex"),
                ("assets/config.json", b"{}"),
            ]);
            let jar = zip_entries(&[("example/Source.class", b"converted")]);
            let metadata = AniyomiInstallMetadata {
                id: "eu.kanade.tachiyomi.animeextension.en.example".into(),
                name: "Aniyomi: Example".into(),
                version: "14.2".into(),
                language: Some("en".into()),
                nsfw: false,
                sources: vec![super::super::AniyomiInstallSource {
                    id: "123".into(),
                    name: "Example".into(),
                    language: Some("en".into()),
                    base_url: Some("https://example.test".into()),
                }],
            };

            let package = build_aniyomi_package(&metadata, &apk, &jar).unwrap();
            let (installed, runtime) = parse_package(&package).unwrap();
            assert_eq!(installed.id, metadata.id);
            assert_eq!(installed.name, "Example");
            assert_eq!(installed.source_ids, vec!["123"]);
            assert!(!installed.signed);
            let mut runtime = ZipArchive::new(Cursor::new(runtime.unwrap())).unwrap();
            assert!(runtime.by_name("example/Source.class").is_ok());
            assert!(runtime.by_name("assets/config.json").is_ok());
        }

        #[cfg(not(target_os = "android"))]
        #[test]
        fn repairs_missing_aniyomi_classpath_resources_without_replacing_classes() {
            let jar = zip_entries(&[
                ("example/Source.class", b"converted"),
                ("assets/kept.js", b"jar"),
            ]);
            let apk = zip_entries(&[
                ("AndroidManifest.xml", b"android"),
                ("classes.dex", b"dex"),
                ("assets/kept.js", b"apk"),
                ("assets/missing.js", b"restored"),
                ("manifest.json", b"{}"),
            ]);

            let repaired = repair_aniyomi_jar_resources(&jar, &apk).unwrap();
            let mut archive = ZipArchive::new(Cursor::new(repaired)).unwrap();
            let mut read = |name: &str| {
                let mut value = Vec::new();
                archive
                    .by_name(name)
                    .unwrap()
                    .read_to_end(&mut value)
                    .unwrap();
                value
            };
            assert_eq!(read("example/Source.class"), b"converted");
            assert_eq!(read("assets/kept.js"), b"jar");
            assert_eq!(read("assets/missing.js"), b"restored");
            assert_eq!(read("manifest.json"), b"{}");
            assert!(archive.by_name("classes.dex").is_err());
        }

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

        fn service_fixture(signed: bool, platform: &str) -> Vec<u8> {
            let entry = service_filename();
            let manifest = serde_json::to_vec(&serde_json::json!({
                "formatVersion": 1,
                "runtimeAbi": 1,
                "id": "example.local-service",
                "name": "Example local service",
                "version": "1.0.0",
                "entry": entry,
                "execution": { "backend": "izumi-service", "status": "compatible" },
                "sources": [{
                    "id": "example.provider",
                    "name": "Example provider",
                    "language": "en",
                    "baseUrl": "https://example.test"
                }]
            }))
            .unwrap();
            let compatibility = serde_json::to_vec(&serde_json::json!({
                "runtime": "izumi-local-service-v1",
                "platform": platform,
            }))
            .unwrap();
            let executable = b"service-binary";
            let integrity = serde_json::json!({
                "algorithm": "SHA-256",
                "files": {
                    "manifest.json": sha256(&manifest),
                    "compatibility.json": sha256(&compatibility),
                    (entry): sha256(executable),
                }
            });
            let integrity_bytes = serde_json::to_vec(&integrity).unwrap();
            let signature = if signed {
                let key = SigningKey::from_bytes(&[9; 32]);
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
                (entry, executable.as_slice()),
                ("integrity.json", integrity_bytes.as_slice()),
                ("signature.json", signature.as_slice()),
            ] {
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
        fn accepts_a_signed_service_for_the_current_platform() {
            let (parsed, executable) =
                parse_package(&service_fixture(true, service_platform())).unwrap();
            assert_eq!(parsed.backend, "izumi-service");
            assert_eq!(parsed.service_entry.as_deref(), Some(service_filename()));
            assert_eq!(executable.as_deref(), Some(b"service-binary".as_slice()));
        }

        #[test]
        fn rejects_unsigned_or_wrong_platform_services() {
            assert!(parse_package(&service_fixture(false, service_platform()))
                .unwrap_err()
                .contains("must be signed"));
            assert!(parse_package(&service_fixture(true, "not-this-platform"))
                .unwrap_err()
                .contains("not built for"));
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
pub async fn extension_install_aniyomi_url(
    app: AppHandle,
    url: String,
    expected_sha256: Option<String>,
    metadata: AniyomiInstallMetadata,
) -> Result<InstalledExtension, String> {
    package::validate_aniyomi_metadata(&metadata)?;
    let apk = package::download_aniyomi_apk(&url, expected_sha256.as_deref()).await?;
    #[cfg(not(target_os = "android"))]
    let converted_jar =
        crate::jvm_extensions::convert_aniyomi_apk(&app, &metadata.id, &apk).await?;
    // Android executes the original APK from `extension.apk`; `extension.jar` is retained only to
    // keep the cross-platform package layout valid and is never handed to the Android bridge.
    #[cfg(target_os = "android")]
    let converted_jar = apk.clone();
    tauri::async_runtime::spawn_blocking(move || {
        package::install_aniyomi(&app, &metadata, &apk, &converted_jar)
    })
    .await
    .map_err(|error| error.to_string())?
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

#[cfg(not(target_os = "android"))]
pub(crate) fn extension_service_entry(
    app: &AppHandle,
    id: &str,
) -> Result<std::path::PathBuf, String> {
    package::service_entry(app, id)
}

#[cfg(not(target_os = "android"))]
pub(crate) fn aniyomi_multidex_packages(
    app: &AppHandle,
) -> Result<Vec<(String, Vec<u8>, String)>, String> {
    package::multidex_packages(app)
}

#[cfg(not(target_os = "android"))]
pub(crate) fn store_converted_aniyomi_jar(
    app: &AppHandle,
    id: &str,
    converted_jar: &[u8],
    apk: &[u8],
) -> Result<(), String> {
    package::store_converted_jvm_jar(app, id, converted_jar, apk)
}

#[cfg(target_os = "android")]
pub fn android_runtime_root(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    package::android_runtime_root(app)
}
