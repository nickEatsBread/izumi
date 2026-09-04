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
short-lived, pre-scoped API token. Izumi keeps that token only in memory for the operation. The older
repository-based **Deploy to Cloudflare** flow is also retained as an optional manual route; it needs
a public GitHub/GitLab repository because that is how Cloudflare deploy buttons work.

Never share the setup secret or an Izumi invite ticket publicly. Invites are single-use and expire after ten minutes.

## Updating

Izumi checks the Worker's public version automatically. Claiming a temporary deployment does not
give Izumi permanent access to the Cloudflare account. To update a Worker created directly by Izumi,
the owner creates and pastes a new pre-scoped setup token; Izumi updates the Worker in place while
preserving its D1 database and device links. A manual or Git-based deployment must be updated through
its original deployment method.

Izumi never stores a Cloudflare API token and cannot silently mutate the account. Every direct
deployment or update requires the user to approve and paste a token again.

Database migrations are applied by the deploy command before the Worker update. Version 1.1 adds the companion pairing, short-lived request, browser enrollment, and Web Push subscription tables. Version 1.2 adds the optional direct-source resolver profile to the same private D1 database. Version 1.3 adds the explicit Cloudflare-only versus Cloudflare-plus-device playback policy. Version 1.4 adds authenticated TV episode-metadata lookup for AniList titles so series pages still receive episode titles, summaries, runtimes, and artwork when the paired client is unavailable. Versions 1.3 and 1.4 need no new migration.

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
- Torrent-only results, loopback/private URLs, and sources requiring playback headers the TV cannot
  apply are omitted. Izumi's built-in debrid-account APIs, local P2P engine, and JVM/Android
  extensions are not executed inside the Worker and their credentials are never uploaded to it.
- The default is **Cloudflare only**. The Worker either returns a TV-ready URL or the TV reports that
  no source was found; it does not silently contact another device.
- The owner can separately enable **Cloudflare + connected Izumi device**. The TV tries the Worker
  first, then asks an open linked device to resolve an unsupported source. On Android, an enrolled
  private notification can open Izumi when it is closed. Desktop is contacted only while Izumi is
  open. A phone's P2P loopback stream or header-bound debrid stream is exposed to the TV through a
  temporary LAN relay on that phone; the Worker still never receives media bytes.

Resolver add-on URLs may contain credentials. Unlike ordinary sync records, the Worker must read
these URLs in order to contact the add-ons, so resolver profiles are deliberately separate from
end-to-end encrypted sync data. They are never returned to the TV. Disable the feature or delete
the profile from Izumi to remove them from D1.

Both the optional Deploy to Cloudflare button and Izumi's generated direct-upload bundle treat this
directory as a standalone project, so Worker code must not import files from the parent Izumi
checkout. The canonical resolver remains under `src/lib/stremio/` in the main repository;
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
