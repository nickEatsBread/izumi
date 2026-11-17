# Vendored `widevine`

Upstream: `widevine` 0.1.0 (crates.io), a Rust port of `pywidevine`.

Local change: **one** behavioural fix in `src/cdm.rs`.

## Why

The licence request the crate builds is refused by Crunchyroll with `403 Forbidden` although an
identical request from a browser CDM, or from upstream `pywidevine` with the same device, is
accepted. Two differences mattered:

1. `LicenseRequest.request_id` — for an `ANDROID` device the real CDM (OEMCrypto) stores the request
   id as an **uppercase hex string** (32 bytes) rather than the 16 raw bytes the crate wrote. The
   licence server rejects the raw form.
2. **Privacy Mode** — sending an encrypted client id to the service certificate is refused for these
   devices, so the downloader requests a plain `client_id`.

`request_id` has to be fixed inside the request builder because the challenge is signed over the
serialised request, so it cannot be patched afterwards and still verify. The plain-client-id part is
caller-side (the downloader simply does not set a service certificate) and needs no patch.

`pywidevine` does both the same way (`pywidevine/cdm.py`, "OEMCrypto's request_id seems to be in AES
CTR Counter block form").

## Updating

Re-copy the crate from `~/.cargo/registry/src/*/widevine-<version>/`, re-apply the block marked
`OEMCrypto stores the Android request id ...` in `src/cdm.rs`, and keep the version equal to the
`widevine` requirement in `src-tauri/Cargo.toml` so `[patch.crates-io]` matches.
