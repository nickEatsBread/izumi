//! Signature checks for store indexes (docs/superpowers/specs/2026-09-25-plugins-stores-packs-design.md
//! §6.3). A store that declares `publicKey: "ed25519:<base64 32 bytes>"` serves `index.json.sig`: a
//! base64 Ed25519 signature over the domain tag `izumi-store-index-v1\n` followed by the exact UTF-8
//! bytes of its index, so a store signature can never be replayed as another kind of izumi signature.
//! The frontend pins the fingerprint returned here the first time it sees a store's key.

use base64::Engine;
use ed25519_dalek::{Signature, VerifyingKey};
use sha2::{Digest, Sha256};

/// Prepended to the index bytes before signing (domain separation).
pub const STORE_INDEX_DOMAIN: &[u8] = b"izumi-store-index-v1\n";

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
    if key.is_weak() {
        return Err("Store key is a weak key".into());
    }
    let signature_bytes = base64::engine::general_purpose::STANDARD
        .decode(signature.trim())
        .map_err(|_| "Store signature is not valid base64")?;
    let signature =
        Signature::from_slice(&signature_bytes).map_err(|_| "Store signature has the wrong length")?;
    let mut message = Vec::with_capacity(STORE_INDEX_DOMAIN.len() + body.len());
    message.extend_from_slice(STORE_INDEX_DOMAIN);
    message.extend_from_slice(body.as_bytes());
    key.verify_strict(&message, &signature)
        .map_err(|_| "Store signature does not match its index")?;
    Ok(key_fingerprint(&key))
}

// `async` runs this off the main thread: the index body can be up to 2 MB.
#[tauri::command(async)]
pub fn store_verify_index(body: String, signature: String, public_key: String) -> Result<String, String> {
    verify_store_index(&body, &signature, &public_key)
}

#[cfg(test)]
mod tests {
    use super::*;
    use ed25519_dalek::{Signer, SigningKey};

    fn public_key(key: &SigningKey) -> String {
        format!(
            "ed25519:{}",
            base64::engine::general_purpose::STANDARD.encode(key.verifying_key().as_bytes())
        )
    }

    fn sign(key: &SigningKey, message: &[u8]) -> String {
        base64::engine::general_purpose::STANDARD.encode(key.sign(message).to_bytes())
    }

    #[test]
    fn accepts_a_matching_signature_and_returns_the_fingerprint() {
        let key = SigningKey::from_bytes(&[9; 32]);
        let body = r#"{"app":"izumi","kind":"store"}"#;
        let signature = sign(&key, &[STORE_INDEX_DOMAIN, body.as_bytes()].concat());
        let fingerprint = verify_store_index(body, &format!("{signature}\n"), &public_key(&key)).unwrap();
        assert_eq!(fingerprint, key_fingerprint(&key.verifying_key()));
        assert_eq!(fingerprint.len(), 64);
    }

    #[test]
    fn rejects_a_weak_key_whose_forged_signature_matches_any_index() {
        // The identity point is a small-order key: (R = identity, s = 0) "verifies" everything
        // unless weak keys are refused.
        let mut identity = [0u8; 32];
        identity[0] = 1;
        let key = format!("ed25519:{}", base64::engine::general_purpose::STANDARD.encode(identity));
        let mut forged = [0u8; 64];
        forged[0] = 1;
        let signature = base64::engine::general_purpose::STANDARD.encode(forged);
        assert!(verify_store_index("{}", &signature, &key).unwrap_err().contains("weak"));
    }

    #[test]
    fn rejects_a_tampered_index_a_foreign_key_an_untagged_signature_or_a_bad_prefix() {
        let key = SigningKey::from_bytes(&[9; 32]);
        let body = r#"{"app":"izumi","kind":"store"}"#;
        let signature = sign(&key, &[STORE_INDEX_DOMAIN, body.as_bytes()].concat());
        assert!(verify_store_index(r#"{"app":"izumi","kind":"store","x":1}"#, &signature, &public_key(&key)).is_err());
        assert!(verify_store_index(body, &signature, &public_key(&SigningKey::from_bytes(&[3; 32]))).is_err());
        assert!(verify_store_index(body, &sign(&key, body.as_bytes()), &public_key(&key)).is_err());
        assert!(verify_store_index(body, &signature, "rsa:abc").is_err());
    }
}
