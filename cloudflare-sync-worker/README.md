# Izumi self-hosted sync

This isolated Cloudflare Worker stores Izumi's end-to-end encrypted device-sync records in your own D1 database. It also provides the optional private Web Push path used when a paired Samsung TV needs to reach Android while Izumi is closed. Cloudflare receives ciphertext, device identifiers, push-subscription details, and access timestamps; it never receives the sync or companion encryption keys.

## Deploy

1. In Izumi, open **Settings → Device sync**, select **My Cloudflare**, and generate a setup secret.
2. Use Izumi's **Deploy with Cloudflare** button. Cloudflare signs you in, clones this directory to your own GitHub/GitLab account, provisions D1, applies its migration, and deploys the Worker.
3. When Cloudflare asks for `BOOTSTRAP_SECRET`, paste the setup secret from Izumi. This is an Izumi one-time claim secret, not a Cloudflare API key.
4. Copy the resulting `https://…workers.dev` URL back into Izumi and connect it.

Never share the setup secret or an Izumi invite ticket publicly. Invites are single-use and expire after ten minutes.

## Updating

Izumi checks the Worker's public version automatically. When an update is available, sync settings links back here. Sync your Cloudflare-created repository with this upstream directory and let Workers Builds deploy the resulting commit. Izumi deliberately never requests or stores a Cloudflare API token, so it cannot silently mutate your Cloudflare account.

Database migrations are applied by the deploy command before the Worker update. Version 1.1 adds the companion pairing, short-lived request, browser enrollment, and Web Push subscription tables. Version 1.2 adds the optional direct-source resolver profile to the same private D1 database. Version 1.3 adds the explicit Cloudflare-only versus Cloudflare-plus-device playback policy; it needs no new migration.

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

The Deploy to Cloudflare button treats this directory as a standalone repository, so Worker code
must not import files from the parent Izumi checkout. The canonical resolver remains under
`src/lib/stremio/` in the main repository; maintainers regenerate the dependency closure committed
under `src/generated/resolver-core/` with:

```sh
node scripts/generate-cloudflare-resolver-core.mjs
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

Current Cloudflare references: [Deploy buttons](https://developers.cloudflare.com/workers/platform/deploy-buttons/), [Workers limits](https://developers.cloudflare.com/workers/platform/limits/), [Developer Platform terms](https://www.cloudflare.com/service-specific-terms-developer-platform/), and [Self-Serve Subscription Agreement](https://www.cloudflare.com/terms/).

Stremio stream-hint reference: [Stream object and `notWebReady`](https://github.com/Stremio/stremio-addon-sdk/blob/master/docs/api/responses/stream.md).
