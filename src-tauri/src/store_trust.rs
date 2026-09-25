//! Signature checks for store indexes (docs/superpowers/specs/2026-09-25-plugins-stores-packs-design.md
//! §6.3). A store that declares `publicKey: "ed25519:<base64 32 bytes>"` serves `index.json.sig`: a
//! base64 Ed25519 signature over the exact UTF-8 bytes of its index. The frontend pins the
//! fingerprint returned here the first time it sees a store's key.

use base64::Engine;
use ed25519_dalek::{Signature, Verifier, VerifyingKey};
use sha2::{Digest, Sha256};

/// Hex SHA-256 of a raw 32-byte Ed25519 public key. Package signer keys use the same fingerprint,
/// so a package can be matched to the store that published it.
pub fn key_fingerprint(key: &VerifyingKey) -> String {
    Sha256::digest(key.as_bytes())
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

pub fn verify_store_index(body: &str, signature: &str, public_key: &str) -> Result<String, String> {
    let encoded = public_key
        .strip_prefix("ed25519:")
        .ok_or("Store keys must start with ed25519:")?;
    let raw = base64::engine::general_purpose::STANDARD
        .decode(encoded)
        .map_err(|_| "Store key is not valid base64")?;
    let bytes: [u8; 32] = raw
        .as_slice()
        .try_into()
        .map_err(|_| "Store key must be 32 bytes")?;
    let key = VerifyingKey::from_bytes(&bytes).map_err(|_| "Store key is invalid")?;
    let signature_bytes = base64::engine::general_purpose::STANDARD
        .decode(signature.trim())
        .map_err(|_| "Store signature is not valid base64")?;
    let signature =
        Signature::from_slice(&signature_bytes).map_err(|_| "Store signature has the wrong length")?;
    key.verify(body.as_bytes(), &signature)
        .map_err(|_| "Store signature does not match its index")?;
    Ok(key_fingerprint(&key))
}

#[tauri::command]
pub fn store_verify_index(body: String, signature: String, public_key: String) -> Result<String, String> {
    verify_store_index(&body, &signature, &public_key)
}

#[cfg(test)]
mod tests {
    use super::*;
    use ed25519_dalek::{Signer, SigningKey};

    fn key_and_signature(body: &str) -> (String, String) {
        let key = SigningKey::from_bytes(&[9; 32]);
        let public = format!(
            "ed25519:{}",
            base64::engine::general_purpose::STANDARD.encode(key.verifying_key().as_bytes())
        );
        let signature =
            base64::engine::general_purpose::STANDARD.encode(key.sign(body.as_bytes()).to_bytes());
        (public, signature)
    }

    #[test]
    fn accepts_a_matching_signature_and_returns_the_fingerprint() {
        let body = r#"{"app":"izumi","kind":"store"}"#;
        let (public, signature) = key_and_signature(body);
        let fingerprint = verify_store_index(body, &format!("{signature}\n"), &public).unwrap();
        assert_eq!(fingerprint.len(), 64);
        assert!(fingerprint.chars().all(|c| c.is_ascii_hexdigit()));
        assert_eq!(
            fingerprint,
            key_fingerprint(&SigningKey::from_bytes(&[9; 32]).verifying_key())
        );
    }

    #[test]
    fn rejects_a_tampered_index_a_foreign_key_or_a_bad_prefix() {
        let body = r#"{"app":"izumi","kind":"store"}"#;
        let (public, signature) = key_and_signature(body);
        assert!(verify_store_index(r#"{"app":"izumi","kind":"store","x":1}"#, &signature, &public).is_err());
        let other = SigningKey::from_bytes(&[3; 32]);
        let foreign = format!(
            "ed25519:{}",
            base64::engine::general_purpose::STANDARD.encode(other.verifying_key().as_bytes())
        );
        assert!(verify_store_index(body, &signature, &foreign).is_err());
        assert!(verify_store_index(body, &signature, "rsa:abc").is_err());
    }
}
