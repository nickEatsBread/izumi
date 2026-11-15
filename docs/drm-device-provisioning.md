# Where a Widevine device identity could come from

Notes only — nothing here is wired up yet. The question was whether the `.wvd` we ship could be
derived from the CDM that Firefox pins in
[`toolkit/content/gmp-sources/widevinecdm.json`](https://github.com/mozilla-firefox/firefox/blob/main/toolkit/content/gmp-sources/widevinecdm.json)
instead of a device blob copied out of a browser extension.

## Short answer

That manifest gets you the **CDM library**, hash-pinned, from Google's own CDN. It does **not** get
you an identity: a `.wvd` is a *per-install, runtime-provisioned* key pair plus client-id blob, and
the component ships no identity. So the manifest is a supply-chain improvement for a provisioning
job, not a source of a device on its own. Extraction is possible, but it needs a run that provisions
the CDM once and then copies two files.

## What the manifest actually is

Firefox's GMP source descriptor for the Widevine CDM component, currently `Widevine-4.10.3112.0`:

- per-platform `fileUrl` on `https://edgedl.me.gvt1.com/edgedl/release2/chrome_component/…` (CRX3),
- a `mirrorUrls` entry on `google.com`,
- `filesize` plus a SHA-512 `hashValue` for each platform.

It is the same component Chrome and Edge pull through their component updaters — this machine's
WebView2 profile even carries `WidevineCdm\4.10.3112.0\` with `widevinecdm.dll` (22.9 MB),
`manifest.json`, `verified_contents.json` and `LICENSE`. Nothing in that directory is an identity.

## Why the component has no identity in it

Provisioning happens on first EME use: the CDM generates an RSA key, asks its *host* for a
provisioning request, the host posts it to Google, and the host persists the two results. A
Chromium host stores them as plain files named `certificate` and `private_key` under
`<user data>/WidevineCdm/<version>/`; that pair plus the client-id blob is exactly what
`pywidevine create-device` turns into a `.wvd`.

Confirmed on this machine:

- `C:\Program Files (x86)\Microsoft\EdgeWebView\Application\<ver>\WidevineCdm\_platform_specific\win_x64\widevinecdm.dll`
  — CDM present, 4.10.3112.0, same version as the manifest.
- `%LOCALAPPDATA%\com.nicho.izumi\EBWebView\WidevineCdm\4.10.3112.0\` — component files only, no
  `certificate` / `private_key`, and still none after a full DRM **download** (the downloader does
  its own licence exchange in Rust, so the browser CDM is never exercised).
- Chrome here uses the MediaFoundation Widevine CDM instead
  (`MediaFoundationCdmStore\…\com.widevine.alpha\*.msprhw.hds`), a different store from the file pair
  above — so a Chrome-profile copy is not the route either.

## What a CI job would have to do

1. Read the manifest, pick the platform entry (`WINNT_x86_64-msvc`, `Linux_x86_64-gcc3`,
   `Darwin_*`), download the CRX3, verify `filesize` and the SHA-512 before unpacking.
2. Run it once under a **throwaway profile** so the CDM provisions: either a headless
   Chromium/WebView2/Firefox with that profile plus a throwaway licence endpoint to answer the
   certificate request, or a small host harness implementing the CDM `Host_10` callbacks and a
   `CdmStorage`-style file sink (that harness is the real work — it is why the blob we ship today
   came from an extension that already contains one).
3. Copy `certificate` and `private_key` out of the profile, build the client-id blob from the same
   profile, and run `pywidevine create-device -t ANDROID -l 3` (or `-t CHROME`) to emit the `.wvd`.
4. Publish it to `miaou.si` keyed by **CDM version + SHA-256 of the file**, e.g.
   `/widevine/4.10.3112.0-<hash>.wvd`, together with the version the client should expect.

Client side later: on start, when online, fetch the entry for the CDM version the host reports,
verify the hash, store it beside the bundled device and prefer it; keep the bundled file as the
offline fallback. Identity is tied to a CDM version, so a refresh only needs to happen when the
component version changes.

## Caveats

- Each provisioning run mints a **new device**; serials accumulate and Google's provisioning endpoint
  may rate-limit, so a job should be deliberate (on version bump), not per build.
- The CDM binary is proprietary; what gets redistributed is the *identity* it produced, which is what
  every downloader already does.
- Component CDMs are L3. L1 identities only come from hardware-backed devices (phones, TVs), so the
  manifest does not help there.
- WebView2 needs a writable user-data folder. Under this harness that had to be pointed inside the
  workspace (`WEBVIEW2_USER_DATA_FOLDER`); without it WebView2 never starts a browser process and
  you get `[startup] first page load did not finish within 10s`.

## In-client extraction — measured on this machine (Windows, WebView2)

Possible in principle, but not the easy path:

- **The persisted pair is not a file here.** `%LOCALAPPDATA%\com.nicho.izumi\EBWebView` contains the
  `WidevineCdm` component but no `certificate`, no `private_key`, and no `MediaFoundationCdmStore`
  `.hds` either — even though this app has played DRM before. Chrome's profile, by contrast, has the
  MF store. So on Windows the identity is held below the profile, in a store neither documented nor
  stable, rather than the two plain files Linux/macOS Chromium writes.
- **The CDM rejects the certificate flow our downloader's sibling path uses.** In a fresh page inside
  the app's own WebView2: `requestMediaKeySystemAccess` → `generateRequest` did produce the 2-byte
  certificate request, the sidecar answered `200` with Crunchyroll's 715-byte certificate, and
  `MediaKeys.setServerCertificate` then failed with `system code 17`, with no licence message
  following. The same bytes are accepted by Chrome here.
- The app profile's `WidevineCdm` component directory also stayed empty in a workspace-hosted
  profile, so a provisioning run needs an unsandboxed app to be representative at all.

So: in-client extraction would be a platform-specific job (fine on Linux/macOS: read the two files
after a hidden EME run; awkward on Windows: parse an undocumented store), and it needs a licence
server reachable during provisioning, i.e. network plus a signed-in session on first use. It should
always degrade to the bundled device.

Licence-wise there is no obstacle: an L3 identity is a software identity, proved by a plain RSA key,
and exporting it is exactly what every downloader already does. What stays Google's is the CDM
binary.

## Self-provisioning: protocol facts (probed 2026-11-15)

Minting an identity from Google's provisioning service is specified, not guesswork. Shapes recovered
from the FileDescriptorSet that openwv vendors
(`third-party/widevine_protos.pb`, decode with `protobufjs/ext/descriptor`):

```
SignedProvisioningMessage { message = 1, signature = 2, protocol_version = 3 }
ProvisioningRequest       { client_id = 1, nonce = 2, options = 3, stable_id = 4,
                            encrypted_client_id = 5, provider_id = 6, spoid = 7 }
ProvisioningResponse      { device_rsa_key = 1, device_rsa_key_iv = 2,
                            device_certificate = 3, nonce = 4, wrapping_key = 5 }
ProvisioningOptions.CertificateType { WIDEVINE_DRM = 0, X509 = 1 }
SignedProvisioningMessage.ProtocolVersion { VERSION_2 = 2, VERSION_3 = 3 }
ClientIdentification.TokenType      { KEYBOX = 0, DRM_DEVICE_CERTIFICATE = 1, ... }
DrmDeviceCertificate.CertificateType { ROOT = 0, DRM_INTERMEDIATE = 1, DRM_USER_DEVICE = 2, ... }
```

`ClientIdentification.token` is a serialised `DrmDeviceCertificate` carrying `type = DRM_USER_DEVICE`,
a random `serial_number`, `creation_time_seconds` and `public_key` (PKCS#1 DER). Sign the serialised
`ProvisioningRequest` with RSA-PSS/SHA-1 — the same scheme the root verifies a service certificate
with. A request built this way is 571 bytes inside an 835-byte signed message with a 546-byte client
id, which is the right order of magnitude.

**The endpoint wants a Google API key.** `POST .../certificateprovisioning/v1/devicecertificates/create`
takes the signed message as the **body** and the key as `?key=<AIza…>`; sending the payload as `key`
returns `400 API key not valid`. Without a key the call fails the same way.

Dead ends so far:

- `widevineprovisioning.grapheneos.org` (a public reverse proxy for the same path) answers
  `403 Permission denied on the service` to third-party callers, with and without
  `Origin`/`Referer: https://grapheneos.org`. It likely binds its key to its own client.
- Chromium's default keys are not plain strings in the Chrome 157 binary, nor in its `.pak` files,
  and `google_apis/internal/google_chrome_api_keys.h` is not in the public tree.

So the remaining dependency is one API key, from any of: an app that ships one, a Chromium build's
generated `default_api_keys-inc.cc`, or a device extractor. Everything downstream — building the
pair into a `.wvd`, licence-testing it, publishing — already works.

### Keys are not the problem — project authorisation is

Tested with four Google API keys lifted from the installed Chrome binary (39-char `AIza…` literals,
all four validate as keys):

| Request | Result |
| --- | --- |
| No key | `400 API key not valid` |
| Wrong key string | `400 API key not valid` |
| Chrome key, valid 835-byte signed body | `403 Permission denied on the service` |
| Chrome key, garbage body | `403` |
| Chrome key, no body at all | `403` |
| Chrome key, `x-goog-api-key` header instead of `?key` | `403` |
| Chrome key + Chrome user agent + `Origin: https://www.google.com` | `403` |
| `GET` instead of `POST` | `404` |

So: the key is accepted, the *project* is not. The service is allow-listed per project and evaluated
before the body is looked at — which is also why GrapheneOS's reverse proxy 403s an outside caller
even though its own devices work. Chrome's embedded keys are for its other Google APIs, not this one.

Consequence: **a key of your own is not guaranteed to work either**, so a self-provisioned mint needs
either an allow-listed project or a borrowed key from one. The paths that need no key at all are the
ones that go through an actual CDM: a rooted Android phone with KeyDive, or publishing an identity
obtained from one.

The spike itself is done and reusable: `.probe/provision-spike/` builds the client id, the request
and the signed message (835 bytes, correct shape) and is a one-line change away from working the
moment an authorised key exists.

## Browser-profile extraction, tested (2026-11-15)

Both current browsers were driven in throwaway Linux profiles, with real licence responses.

**Chrome 157** (Linux, component CDM):

| Probe | Result |
| --- | --- |
| `persistentState: 'required'` | accepted |
| `sessionTypes: ['persistent-license']` | **rejected** — Linux CDM has no persistent licences |
| EME with persistent state | CDM answers with a 1704-byte licence request, no certificate request |
| After a `200` | no `certificate`, no `private_key`, `ClientCertificates` empty, `WidevineCdm/` holds one version marker, no PEM in 186 files |

**Firefox 160** (same treatment):

| Probe | Result |
| --- | --- |
| EME with defaults | off — needs `media.eme.enabled` and `media.gmp-widevinecdm.enabled` |
| With prefs, persistent state | CDM loads, also answers with a licence request straight away |
| After a `200` (970-byte licence) | no `gmp-widevinecdm` origin under `storage/permanent`, no PEM |

Both keep the identity inside the CDM's own store. The "copy `certificate` + `private_key`" recipe
is obsolete on current builds; that is why every current guide points at phones instead.

Two instrument bugs worth remembering: the MPD lists the **PlayReady** `<cenc:pssh>` first (1120
chars), so selecting the first pssh silently feeds PlayReady init data to a Widevine CDM and
`generateRequest` fails with a bare `TypeError`; and `keyStatuses` is empty immediately after
`update`, so success must be read from the HTTP status and body size, not the status map.

The one store that *is* a file is Windows' `MediaFoundationCdmStore/**/*.hds`. Whether those blobs
carry a parseable device certificate and key is the next question.
