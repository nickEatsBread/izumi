# Izumi self-hosted sync

This isolated Cloudflare Worker stores Izumi's end-to-end encrypted device-sync records in your own D1 database. It also provides the optional private Web Push path used when a paired Samsung TV needs to reach Android while Izumi is closed. Cloudflare receives ciphertext, device identifiers, push-subscription details, and access timestamps; it never receives the sync or companion encryption keys.

## Deploy

1. In Izumi, open **Settings → Device sync** and select **My Cloudflare**.
2. Accept Cloudflare's Terms of Service and Privacy Policy, then select **Create my private Worker**.
3. Izumi creates a temporary Cloudflare account, a D1 database, and the Worker, then opens its private claim link.
4. Sign in to Cloudflare or create an account, complete the claim within 60 minutes, return to Izumi, and select **I claimed it — connect**.

This path needs no GitHub/GitLab account, repository, command line, API token, account ID, database
ID, or Worker settings. Izumi solves Cloudflare's required proof-of-work in its native process. The
temporary API credential never enters the web view, is not saved or synced, and is discarded after
the initial upload. The claim URL is a bearer credential and is opened only for the user who started
setup. If the claim is not completed within 60 minutes, Cloudflare deletes the temporary account and
its resources.

The advanced setup section can instead deploy directly into an existing Cloudflare account using a
pre-scoped deployment token. The installer stores it as an encrypted secret in your private Worker for future automatic updates; it is never included in device sync or returned to the TV. The older
repository-based **Deploy to Cloudflare** flow is also retained as an optional manual route; it needs
a public GitHub/GitLab repository because that is how Cloudflare deploy buttons work.

Never share the setup secret or an Izumi invite ticket publicly. Invites are single-use and expire after ten minutes.

## Updating

Worker runtime tests live in `tests/` and run with the root `npm test` command, alongside
the client tests. Keeping server-only tests here prevents the Svelte application type checker
from treating the Worker's D1 bindings and JavaScript runtime as browser application code.

Version 1.9 adds encrypted multipart library records (`0006_record_chunks.sql`). Update the
Worker and each desktop/mobile Izumi client to sync libraries larger than the old single-record
limit. Small records retain the original wire format. This does not change Samsung TV snapshot
or playback protocols.

Large libraries are divided into content-addressed encrypted chunks. Each request stays below
512 KiB; a snapshot may contain up to 32 MiB of plaintext. Only changed chunks upload again, and
the Worker switches the current snapshot only after all referenced chunks exist. Interrupted
uploads leave the last complete snapshot readable. Unreferenced chunks expire after ten minutes
when another upload runs; the active snapshot is retained. The Worker bounds staged ciphertext
to 96 MiB per device/category. Chunk contents and manifests remain end-to-end encrypted.

Worker 1.13 installs stable updates automatically after a normal authorized Worker update from
Izumi. There is no separate automatic-update setup, repository connection, deploy hook, or TV
setup button. The installer provisions deployment access and the six-hour schedule during the
same operation. **Update now** on the TV or **Update Worker** in Izumi checks sooner; devices
can be switched off between updates.

The private Worker downloads releases from the main Izumi repository, verifies the package's
SHA-256 checksum, applies pending migrations, and updates its existing script. It keeps the same
D1 database, address, pairing credentials, and secrets. An update remains pending until the running
Worker reports the new version. Concurrent requests share one deployment attempt.

Deployment access is stored in Cloudflare as an encrypted `WORKER_UPDATE_AUTH` secret, scoped
by the installer to the existing account, Worker, and database. The supplied token retains its
Cloudflare permissions; Izumi does not create a broader token or transmit it to paired devices.
Keep that token valid: revoking it or setting an expiry prevents subsequent deployments. Temporary
preview-account credentials are discarded and cannot provide durable deployment access. An older
or claimed preview Worker receives durable access when it is next updated normally from Izumi.

Worker releases publish independently of desktop releases through `.github/workflows/worker-release.yml`.
The stable feed is `worker-updates/stable.json` in the main repository and points to a versioned
`worker-vX.Y.Z` release. CI publishes the feed only after both release assets are available. No
Cloudflare account credentials are stored in the main repository or required by its CI.

Set `WORKER_AUTO_UPDATE` to `false` to pause scheduled installation. Remove `WORKER_UPDATE_AUTH`
to revoke the Worker's deployment access. Failures retry with a six-hour backoff and never report
an unconfirmed deployment as installed. Existing private deploy-hook installations remain compatible.
This uses the Free-compatible Worker and D1 APIs; it does not require Workers Builds or a paid runtime.

Database migrations are applied by the deploy command before the Worker update. Version 1.1 adds the companion pairing, short-lived request, browser enrollment, and Web Push subscription tables. Version 1.2 adds the optional direct-source resolver profile to the same private D1 database. Version 1.3 adds the explicit Cloudflare-only versus Cloudflare-plus-device playback policy. Version 1.4 adds authenticated TV episode metadata. Version 1.5 adds native torrent resolution through Izumi's existing multi-provider debrid abstraction. Version 1.6 adds per-TV encrypted catalogue snapshots and playback checkpoints plus live Worker catalogue/search/detail adapters. It requires migration `0004_companion_independent.sql`.

After Version 1.6 has been configured once, the TV's normal data path no longer requires an open
Izumi client. It reads its encrypted home layouts and personal rows from D1, performs live AniList,
Kitsu, TMDB, and configured Stremio catalogue/search/detail requests through the Worker, resolves
playback there, and writes encrypted progress back for Izumi's normal history and sync stores to
ingest later. Cloudflare can select ciphertext by TV and catalogue screen but cannot decrypt home
data or viewing progress. Trailer previews use a short-lived Worker URL, so the TV never places its
long-lived pairing token in an iframe and does not need the linked client to host the YouTube bridge.

## Optional TV source resolving

Version 1.2 can ask the user's configured Stremio stream add-ons for an episode while the paired
Izumi client is closed. The option is off until the owner enables it and uploads a separate resolver
profile from Izumi.

- The TV sends a media identifier and episode to this Worker using its TV-scoped pairing token.
- This Worker maps AniList identifiers through AniZip, queries the owner's configured add-ons, and
  runs a generated copy of the same normalization and ranking modules compiled into Izumi.
- The response contains a short ranked list of direct HTTP/HLS/DASH/file candidates. The TV downloads
  the selected media directly from its source; media bytes never pass through this Worker.
- A configured debrid-enabled Stremio add-on is supported when it returns a public direct URL. A
  `notWebReady` hint does not reject that URL by itself: in Stremio it can simply denote a non-MP4
  or non-HTTPS source that is unsuitable for a browser, while Samsung AVPlay supports more formats.
- Some add-ons resolve torrents on their own gateway and return a playback route on that gateway
  instead of the file. Such routes are commonly bound to the network address that fetched the
  stream list, which is this Worker rather than the TV, so the TV can be refused when it connects.
  When the resolver profile carries a debrid credential, the Worker recovers the torrent hash the
  route names and prepares the same release through the owner's provider. The gateway route is
  kept only as a trailing fallback and is marked `hosted` so the TV can fail over from it.
- The TV sends the catalogue's release year and runtime with each request. The Worker uses them as
  refinement evidence when its own metadata lookups cannot supply a year, so a same-title
  production from another era is not offered in place of the requested one.
- When Izumi already has a debrid provider configured, the resolver profile carries that same
  provider and credential automatically. Torrent-only results are resolved through the same shared
  provider implementation used by local playback: Real-Debrid, AllDebrid, Premiumize, TorBox,
  Debrid-Link, Offcloud, EasyDebrid, and Izumi's experimental Deepbrid and Mega-Debrid entries.
  The Worker never echoes the account credential to an owner device or sends it to the TV.
- Torrent-only results without configured debrid and sources requiring playback headers the TV
  cannot apply are omitted. Cookie and User-Agent source requirements are passed to Samsung AVPlay.
  Direct private-LAN media-server URLs are disabled by default and can be explicitly enabled in
  Izumi; they travel from that LAN server straight to the TV and never through Cloudflare.
  Loopback URLs, the local P2P engine, and JVM/Android extensions are not executed inside the Worker.
- When a debrid provider exposes external subtitle files, the Worker obtains them through Izumi's
  existing provider-neutral sidecar adapter. AniList episode playback also carries best-effort
  AniSkip opening/ending/recap timing. Neither lookup can prevent the video from playing.
- The default is **Cloudflare only**. The Worker either returns a TV-ready URL or the TV reports that
  no source was found; it does not silently contact another device.
- The owner can separately enable **Cloudflare + connected Izumi device**. The TV tries the Worker
  first, then asks an open linked device to resolve an unsupported source. On Android, an enrolled
  private notification can open Izumi when it is closed. Desktop is contacted only while Izumi is
  open. A phone's P2P loopback stream or header-bound debrid stream is exposed to the TV through a
  temporary LAN relay on that phone; the Worker still never receives media bytes.

Resolver add-on URLs may contain credentials. Unlike ordinary sync records, the Worker must read
these URLs in order to contact the add-ons, so resolver profiles are deliberately separate from
end-to-end encrypted sync data. The optional debrid credential has the same constraint. Resolver
credentials are never returned to the TV, and the debrid credential is redacted from profile reads.
Disable the feature or delete the profile from Izumi to remove them from D1.

## Free-only media boundary

The Worker is a coordinator and resolver, not a media server. It uses Workers Free and D1 Free and
requires no custom domain. Media downloads go from the public source, the user's debrid provider,
or a separately approved LAN server directly to the TV.

No paid Cloudflare product is required. Debrid accounts remain optional third-party services with
their own plans; without one, direct HTTP/HLS/DASH sources still work but torrent-only results
cannot be played by the Worker.

- Do not add Cloudflare Stream, Containers, Media Transformations, R2 media storage, or another
  paid runtime to this project.
- Do not proxy episode files or adaptive-stream segments through this Worker. Apart from exhausting
  the per-request free-tier budget, using the self-serve CDN as a general video relay can violate
  Cloudflare's video-delivery policy.
- Generic transcoding/remuxing, raw non-debrid BitTorrent, and a source that exists only on an
  offline Izumi client's `localhost` remain outside the Worker. An already-running provider/media
  server may expose another compatible rendition directly, but the Worker never transforms or
  relays it. The linked client is an optional compatibility fallback for these cases, not the TV's
  primary backend.

Both the optional Deploy to Cloudflare button and Izumi's generated direct-upload bundle treat this
directory as a standalone project, so Worker code must not import files from the parent Izumi
checkout. The canonical resolver and debrid provider stack remain under `src/lib/stremio/` in the main repository;
maintainers regenerate the dependency closure committed under `src/generated/resolver-core/` with:

```sh
node scripts/generate-cloudflare-resolver-core.mjs
```

After changing Worker source, migrations, dependencies, or Wrangler configuration, regenerate the
bundle embedded in the native app:

```sh
npm run cloudflare:bundle
```

The main repository's Worker contract test fails if that generated copy is missing or stale. Users'
isolated Worker repositories need only the already-generated files and never run this command.

## Private TV notifications

On Android, pairing a TV can create a TV-specific capability in this Worker. Izumi then opens this Worker's enrollment page in the phone's full browser. Granting that site notification permission creates a standards-based Web Push subscription and a VAPID keypair owned by this deployment.

- With Worker resolving disabled, the TV first tries the local Smart View channel and uses this
  Worker only to notify an enrolled Android device when the app does not acknowledge the request.
  Cloudflare-only resolving never contacts the linked app. Combined mode tries Cloudflare first,
  then the local channel, then the Android notification route.
- Playback requests expire after five minutes and are encrypted with the local TV pairing credential before upload.
- The notification contains only opaque pairing/request identifiers and opens Izumi through its custom link.
- This deployment never calls an Izumi-operated relay and needs no Firebase project, SDK, key, or sender ID. Delivery goes from this Worker to the standards-based endpoint selected by the browser. Chrome currently backs its endpoint with FCM; that browser transport is unavoidable, but it is not an Izumi service and needs no Izumi/Firebase configuration.
- Removing site permission or clearing the browser's site data requires notification enrollment again.
- Desktop pairings never enroll for notifications and do not leave closed-app playback requests queued.

## Limits and privacy

- One Worker is intended for one person's devices, with at most 32 devices.
- Records are capped at 512 KiB of ciphertext and one current record per device/category.
- Cloudflare plan quotas and Developer Platform terms still apply.
- Do not use this Worker for media files, health data, unlawful content, or as a media proxy.
- Deleting a Worker/D1 database or ending the Cloudflare subscription may permanently delete its copy. Izumi remains the source of truth on each device.

Current Cloudflare references: [Claim deployments](https://developers.cloudflare.com/workers/platform/claim-deployments/), [API token template URLs](https://developers.cloudflare.com/fundamentals/api/how-to/account-owned-token-template/), [Worker script uploads](https://developers.cloudflare.com/api/resources/workers/subresources/scripts/), [multipart upload metadata](https://developers.cloudflare.com/workers/configuration/multipart-upload-metadata/), [D1 API](https://developers.cloudflare.com/api/resources/d1/), [Deploy buttons](https://developers.cloudflare.com/workers/platform/deploy-buttons/), [Workers limits](https://developers.cloudflare.com/workers/platform/limits/), [Terms of Service](https://www.cloudflare.com/terms/), and [Privacy Policy](https://www.cloudflare.com/privacypolicy/).

Stremio stream-hint reference: [Stream object and `notWebReady`](https://github.com/Stremio/stremio-addon-sdk/blob/master/docs/api/responses/stream.md).
