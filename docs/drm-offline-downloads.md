# Decrypting DRM offline downloads

## What this is

Some sources deliver episodes as protected adaptive video (Widevine-encrypted DASH). The default
way to keep such an episode offline stored the *encrypted* segments plus a persistent CDM licence
and re-acquired a licence over the network at playback time — so it was never truly offline, and on
some webview builds the persistent session is unavailable, leaving the item flagged "needs online
licence".

The decrypting downloader removes that dependency. While downloading it:

1. fetches the same segments it would stream (through the source's own proxy),
2. obtains the Widevine **content keys** for that session,
3. decrypts every fragment as it arrives, and
4. writes **one clear fragmented MP4** to disk.

Offline playback is then an ordinary local file opened by mpv — **no CDM, no licence, no network,
and no persistent licence stored anywhere**. All existing local-playback features (scrub thumbnails,
subtitle tracks, resume) work unchanged.

The flow is desktop-only. Android keeps the existing encrypted/Shaka offline path.

## Components

- **Source sidecar** exposes `GET /v/{id}/offline-plan`, which returns the segment URLs, byte
  ranges, and the Widevine `pssh` + key id for the session, plus the licence and release endpoints.
  The downloader talks only to this proxy, never to the upstream licence or CDN endpoints directly.
- **Client native engine** (`src-tauri/src/drm_download.rs`, commands `drm_download_start` /
  `drm_download_cancel`) fetches the plan, runs the licence exchange, downloads the protected
  tracks into encrypted staging files, decrypts and muxes them into the clear output, and writes
  sidecar subtitles beside it.
- **Client wiring** resolves a protected source with a plan URL to a `kind: 'drm'` download
  (desktop), falling back to the encrypted `kind: 'shaka'` path when there is no plan, on Android,
  or when the licence server refuses the device (see below).

## Threat model and decisions

### CDM device material

The downloader needs a Widevine **L3 device**: an RSA private key plus a client-id blob. It is
shipped as a Tauri resource at `src-tauri/resources/widevine/device.wvd`, resolved at runtime next
to the existing capture-ffmpeg resource resolution. An explicit `IZUMI_WVD_PATH` environment
variable overrides it, and a configured build prefers a cached device from the pool (see "Device
supply"); the bundled file stays as the seed.

- **What it is.** A software (L3) Widevine device. It lets its holder run the Widevine licence
  handshake and obtain **content keys** for content the account is entitled to.
- **Shared, not per-user.** Every install ships the same device; it is not derived from or tied to
  the user's account. This is the same class of secret every third-party downloader ships. It
  carries **no user account data** — not the user's credentials, token, or profile.
- **What an attacker with it can do.** Request L3 content keys for arbitrary Widevine content they
  can already reach a licence server for (subject to that server's own auth). That is the same
  capability any shipped L3 device grants.
- **What it cannot do.** It cannot read the user's account, tokens, library, or any other user
  data; it is not an account credential. L3 is also the lowest robustness level, so services may
  refuse it (see "Device rejection" below).

### Content keys

Content keys are obtained per job and held **in memory only** for the duration of that job. They
are **never written to the database, to disk, or to logs**. If logging is enabled, only the **key
id (KID) hex** is logged — never key material.

### Licence is streaming, not persistent

The licence request uses `LicenseType::STREAMING`. Nothing persistent is created: no CDM state, no
IndexedDB licence, no stored offline licence that can expire into a "needs network" state. Once the
keys have decrypted the file, they are discarded. The finished item is a plain local file.

The licence request carries a **plain `client_id`** — no Privacy Mode, no service certificate. An
encrypted client id bound to the service's certificate *looks* more correct, but the server refuses
it for these devices; a browser CDM and `pywidevine` both send the plain form, and the plain form is
what is accepted.

`LicenseRequest.request_id` must be the OEMCrypto form for an Android-class device: sixteen bytes
arranged as four random bytes, four zero bytes, then the session counter little-endian, carried as an
**uppercase hex string** (32 bytes on the wire) rather than the raw bytes. `widevine` 0.1.0 writes the
raw bytes, so the crate is vendored in `src-tauri/vendor/widevine` with that one change (see its
`README.vendor.md`); the challenge is signed over the serialised request, so it cannot be patched
afterwards.

### Device blob

The shipped `resources/widevine/device.wvd` is a Widevine L3 identity (an RSA key plus client-id
blob) extracted from an Android Chrome build, with the certificate token and client-info verbatim.
It is **shared, not per-install** — the same class of secret every downloader ships — so anyone with
the app can request L3 keys for anything they can authenticate for. It carries no account data;
a user's own Crunchyroll session is what decides entitlement.

`IZUMI_WVD_PATH` overrides it for a user-supplied device. Device blobs differ in what servers accept,
so a replacement is the first thing to try if a licence is refused.

The blob is a key pair plus a client-id token — **not** a certificate chain and not a licence, so it
has no expiry date baked in; what can happen is the serial or key being revoked or blocked, which
shows up as a refused licence. Provenance: taken from the `device.wvd` shipped by
`WVGuesserExtension-NextGen` (`FoxRefire/wvg`, AGPL-3.0 — the same licence family as this client),
which is itself an Appetize.io Android-emulator Chrome identity. Nothing else is bundled: no CDM
binary (our own AES-CTR code does the decryption), no licence file, no keys.

### Device rejection (403) and fallback

If a licence is refused with `403 Forbidden` at the licence step (or keeps answering `429` after the
backoff), the native engine first retries **once** with the next device (see "Device supply"). If
that one is refused too — or there is no device at all — it returns an error prefixed
`licence-forbidden:` and the client **falls back to the existing Shaka offline path** for the same
source — the download still succeeds (as encrypted segments plus a licence) instead of failing the
job. That path is also what Android, a source with no plan URL, and an HLS stream use.

### Cleartext at rest

The stored file is a **decrypted, DRM-free MP4**. This is stated plainly: once a decrypting
download completes, the episode is no longer protected on disk. That is the point of the feature —
offline playback with no CDM — and the tradeoff is that the on-disk file is cleartext. Users who
prefer encrypted-at-rest storage keep the Shaka path (no plan URL, Android, or a rejected device).

### Temporary data

Encrypted downloads are staged in the **download directory** as `<name>.mp4.part` (video) and
`<name>.mp4.apart` (audio), never in the system temp directory, and **no decrypted content is ever
written to the system temp directory**. On success both staging files are deleted; on cancel they
are destroyed; on failure they are kept so a later resume can continue. The clear output is written
only after a successful full decrypt.

### Failure hygiene

If any sample fails to decrypt, or the content key for a track's KID is missing, the job **fails**
instead of silently writing a corrupt file, and the half-written clear output is deleted. The
encrypted staging files are kept for resume.

### Token / slot hygiene

The licence header set is per profile and goes through the sidecar proxy — the client never talks
to the upstream licence endpoint directly. The scarce play slot is released with a single
`DELETE releaseUrl`, guarded so it fires **exactly once on every exit path** (success, cancel, or
failure).

### Playback surface

The finished `kind: 'drm'` item carries **no `offlineUri` and no `drmKeySystem`**. Offline playback
sees only a local `path` and plays it as an ordinary file, so nothing can be tempted to re-acquire a
licence or treat the file as protected. (The sample-entry 4CCs are rewritten from their protected
form, `encv`→`avc1` and `enca`→`mp4a`, so a player never treats the clear file as encrypted.)

## Device supply

`src-tauri/src/widevine_device.rs` picks the device for each licence exchange, first hit wins:

1. `IZUMI_WVD_PATH` — an explicit device; never rotated away from.
2. A **cached pool member** in `<app data>/widevine/devices/<id>.wvd`, fewest refusals first, then
   newest `verifiedAt`.
3. A **fresh pool member**, fetched and cached when the pool is configured and nothing usable is
   cached.
4. The bundled `resources/widevine/device.wvd` — the seed for first run, offline use, and builds
   without a pool.

**The pool.** A separate provisioning job publishes Android-class L3 identities behind a gate:
`GET <base>/api/index` returns `index.json` (`schema: 1`, `cdmVersion`, and per device an `id`,
`platform`, SHA-256 and byte size of `client_id.bin` and `private_key.pem`, `verifiedAt`), and
`GET <base>/api/device/<id>/{client_id.bin,private_key.pem}` returns the pair. Every request carries
`X-Izumi-Key: <secret>` plus `exp` (now + 120 s) and `sig`, the lowercase hex HMAC-SHA256 of
`<id or "index">.<exp>` under the same secret. Requests use the shared HTTP client with a 10 s
timeout.

**Build values.** The base URL and the secret are baked in at compile time from
`IZUMI_CDM_BASE_URL` and `IZUMI_CDM_KEY` (`option_env!`); runtime env vars of the same names
override them for development. A build without both has **no pool** and behaves exactly as before:
override, then the bundled seed.

**The cache.** At most two members, 64 KB each. An index entry is used only if its id is 16 hex
digits, its platform starts with `linux` or `win`, and its hashes and sizes are present and sane
(the pair may not declare more than 64 KB). The pair is checked against the index hashes and
assembled into a `.wvd` **in memory**; only the assembled device is written, via a temp file and
rename. `state.json` holds `{id, cdmVersion, fetchedAt, lastUsedAt, failures, verifiedAt}` per
member and when the index was last read — no keys, no secret. When that read is older than 24 h the
index is re-read (at most once per process) and members it no longer lists are dropped. Any index
failure — network, `401`, malformed or empty — means "pool unavailable": the cache and the seed stay
in play and the download carries on.

**Rotation on refusal.** A refused licence (above) adds one to the member's `failures` and the same
job retries once with the next device — another cached member, a fresh one, or the seed — so a dead
member costs one extra licence round trip. A member is deleted at two refusals; an accepted licence
resets its count, so only consecutive refusals count. A second refusal in the job is terminal and
goes to the Shaka path.

## Scheme support

Only the CENC scheme (AES-CTR, `cenc`) is supported, which is what the target manifests use. A
non-CENC scheme such as `cbcs` is rejected loudly rather than producing a garbage file.

## Verification

Unit coverage: the box walker, sample decryption against a committed ground-truth fixture, the
subsample keystream rule, 8-vs-16-byte IV handling, `default-base-is-moof` normalisation, `moov`
construction with both tracks, and loud rejection of `cbcs`.

Live runs against the real service through the sidecar, from the downloader's own functions
(`fetch_keys_with_device` → download → `build_clear_mp4`):

| Run | Result |
| --- | --- |
| TV session, 720p | 213,200,190-byte clear MP4, h264 1280x720 + aac, 23:49, four content keys |
| Web session, 480p | 130,572,952-byte clear MP4, h264 854x480 + aac, 23:49, four content keys |

Both files play end to end: `ffmpeg -f null` decodes them with **zero** errors and a frame grab
renders real picture, on both audio and video, with sample-entry 4CCs already rewritten.

The wrapper `run_drm_download` on a `tauri::test::mock_app()` (ignored
`live_command_writes_a_clear_file`, web session, 480p): 130,572,952-byte clear file plus both
subtitle sidecars, no `.mp4.part`/`.mp4.apart` left, an empty release URL falling back to the
plan's own, and the session answering 404 afterwards (slot released).

Not yet exercised: the `drm_download_start` in-flight map and `download-error` path.

The queue was then driven through the running app itself (enqueue from the series page →
`download-progress` → `download-done`): the item finished `kind: 'drm'` with a 209,847,358-byte local
file and fifteen subtitle sidecars, carrying **no** `offlineUri` and **no** `drmKeySystem`, and it
decodes with zero errors.

Device supply (2026-11-15): unit tests in `widevine_device.rs` cover resolution order, the disabled
pool, atomic writes, the SHA-256 and 64 KB checks, the two-member cap, index validation, the `sig`
vector, a `401`/malformed index keeping the cache, refusal counting and deletion, and the single
rotation retry. The real pool was not published yet, so the HTTP path was proved against a local
stub enforcing the same gate (wrong key or signature → `401`) and serving a pair split from the seed:
the ignored `live_pool_fetch_caches_a_member` fetched, verified and cached it, and
`live_command_writes_a_clear_file` with no `IZUMI_WVD_PATH` downloaded a real episode through the
sidecar using that pool member — 986,191,192-byte clear MP4, four content keys, nine subtitle
sidecars, no staging files left, session `404` afterwards.

`docs/drm-device-provisioning.md` records where a device identity could come from if this one is ever
revoked.
