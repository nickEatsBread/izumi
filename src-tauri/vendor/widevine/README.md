# widevine-rs

[![Current crates.io version](https://img.shields.io/crates/v/widevine.svg)](https://crates.io/crates/widevine)
[![License](https://img.shields.io/badge/License-MIT-blue.svg?style=flat)](https://opensource.org/licenses/MIT)
[![Docs](https://img.shields.io/docsrs/widevine/latest?style=flat)](https://docs.rs/widevine)
[![CI status](https://codeberg.org/ThetaDev/widevine-rs/actions/workflows/ci.yaml/badge.svg?style=flat&label=CI)](https://codeberg.org/ThetaDev/widevine-rs/actions/?workflow=ci.yaml)

Rust implementation of Google's Widevine DRM CDM (Content Decryption Module). The CDM
allows you to build applications that can access DRM-protected media.

This is a port of the [pywidevine](https://github.com/devine-dl/pywidevine) library by
[rlaphoenix](https://github.com/rlaphoenix).

To use the CDM you need a valid Google-provisioned Private Key and Client Identification
blob (plain or bundled as a \*.wvd file).

### Example:

Bitmovin DRM demo video: <https://bitmovin.com/demos/drm>

```rust
use std::fs::File;
use std::io::BufReader;

use isahc::ReadResponseExt;
use hex_lit::hex;
use widevine::{Device, Cdm, Pssh, LicenseType};

# let wvd_path = match std::env::var("WIDEVINE_DEVICE") {
#   Ok(wvd_path) => wvd_path,
#   Err(_) => return,
# };

// Instantiate a new CDM
let device = Device::read_wvd(BufReader::new(File::open(&wvd_path).unwrap())).unwrap();
let cdm = Cdm::new(device);

/// Create a new CDM request
let pssh = Pssh::from_b64("AAAAW3Bzc2gAAAAA7e+LqXnWSs6jyCfc1R0h7QAAADsIARIQ62dqu8s0Xpa7z2FmMPGj2hoNd2lkZXZpbmVfdGVzdCIQZmtqM2xqYVNkZmFsa3IzaioCSEQyAA==").unwrap();
let request = cdm
    .open()
    .get_license_request(pssh, LicenseType::STREAMING)
    .unwrap();
let challenge = request.challenge().unwrap();

// Send the request to the license server
let mut resp = isahc::post("https://cwip-shaka-proxy.appspot.com/no_auth", challenge).unwrap();
let resp_data = resp.bytes().unwrap();

// Decrypt the received keys and select the key with the required ID
let keys = request.get_keys(&resp_data).unwrap();
let key = keys.content_key(&hex!("ccbf5fb4c2965be7aa130ffb3ba9fd73")).unwrap();

assert_eq!(key.key, hex!("9cc0c92044cb1d69433f5f5839a159df"));
```
