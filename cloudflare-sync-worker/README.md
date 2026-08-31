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

Database migrations are applied by the deploy command before the Worker update. Version 1.1 adds the companion pairing, short-lived request, browser enrollment, and Web Push subscription tables. Version 1.2 adds the optional direct-source resolver profile to the same private D1 database.

## Optional TV source resolving

Version 1.2 can ask the user's configured Stremio stream add-ons for an episode while the paired
Izumi client is closed. The option is off until the owner enables it and uploads a separate resolver
profile from Izumi.

- The TV sends a media identifier and episode to this Worker using its TV-scoped pairing token.
- This Worker maps AniList identifiers through AniZip, queries the owner's configured add-ons, and
  runs a generated copy of the same normalization and ranking modules compiled into Izumi.
- The response contains a short ranked list of direct HTTP/HLS/DASH candidates. The TV downloads
  the selected media directly from its source; media bytes never pass through this Worker.
- Torrent-only results, loopback/private URLs, `notWebReady` results, and sources requiring playback
  headers the TV cannot apply are omitted. The TV can then fall back to opening the paired client.
- JVM/Android extensions and debrid-account APIs are not executed by this version of the Worker.

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

- The TV first tries the existing local Smart View channel. It contacts this Worker only when the linked Izumi client does not acknowledge the request.
- Playback requests expire after five minutes and are encrypted with the local TV pairing credential before upload.
- The notification contains only opaque pairing/request identifiers and opens Izumi through its custom link.
- This deployment never calls an Izumi-operated relay and needs no Firebase project, SDK, key, or sender ID. Delivery goes from this Worker to the standards-based endpoint selected by the browser. Chrome currently backs its endpoint with FCM; that browser transport is unavoidable, but it is not an Izumi service and needs no Izumi/Firebase configuration.
- Removing site permission or clearing the browser's site data requires notification enrollment again.

## Limits and privacy

- One Worker is intended for one person's devices, with at most 32 devices.
- Records are capped at 512 KiB of ciphertext and one current record per device/category.
- Cloudflare plan quotas and Developer Platform terms still apply.
- Do not use this Worker for media files, health data, unlawful content, or as a media proxy.
- Deleting a Worker/D1 database or ending the Cloudflare subscription may permanently delete its copy. Izumi remains the source of truth on each device.

Current Cloudflare references: [Deploy buttons](https://developers.cloudflare.com/workers/platform/deploy-buttons/), [Workers limits](https://developers.cloudflare.com/workers/platform/limits/), [Developer Platform terms](https://www.cloudflare.com/service-specific-terms-developer-platform/), and [Self-Serve Subscription Agreement](https://www.cloudflare.com/terms/).
