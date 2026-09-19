# Companion resolve channel

Worker 1.14.0 and Companion 0.2.49 add protocol 1 of the source resolve channel. Search, catalogues, background prefetch and older clients retain their HTTP routes.

An authenticated POST to `/v1/companion/pairings/:id/resolve-channel` checks the TV pairing and selected viewer's PIN, then issues a single-use connection ticket valid for 30 seconds. The subsequent WebSocket upgrade consumes that ticket. The persistent TV bearer token and profile PIN never appear in its URL, socket attachment or operation record. A SHA-256 fingerprint of the saved resolver profile binds the admission to the selected viewer and current settings. Pairing revocation and profile edits invalidate subsequent commands and result delivery.

The SQLite Durable Object `CompanionResolveSession`, bound as `TV_RESOLVE_SESSIONS`, coordinates one active lookup per pairing. It uses `acceptWebSocket`, serialized authorization attachments and an automatic `izumi:ping` / `izumi:pong` response. A socket closes when its lookup ends; there is no permanent server heartbeat timer. Idle objects can hibernate. Active network work and deadlines keep an operation alive, so this improves latency and interaction rather than guaranteeing lower cost.

| Direction | Message | Purpose |
| --- | --- | --- |
| TV → Worker | `resolve.start` | Begin a request identified by 32 random hexadecimal characters |
| Worker → TV | `resolve.accepted` | Confirm the persisted operation and its deadline |
| Worker → TV | `resolve.progress` | Replace the candidate snapshot with current ranked choices |
| Worker → TV | `fetch.request` | Delegate one restricted public source request |
| TV → Worker | `fetch.result` | Return bounded torrent metadata for its fetch ID |
| TV → Worker | `resolve.resume` | Recover the current snapshot and pending delegated requests |
| TV → Worker | `resolve.cancel` | Abort pending discovery and release preparation |
| Worker → TV | `resolve.complete` / `resolve.error` | End the operation |

All JSON messages carry `protocol: 1`. Operation messages carry `requestId`; ordered snapshots carry a monotonically increasing `sequence`. Fetch replies use a separate random `fetchId`. Repeated starts with the retained ID replay the existing state, and repeated fetch replies are consumed only once.

The resolver runs discovery, conservative filtering, release preparation and candidate delivery concurrently. Partial candidates pass the same compatibility and source-priority checks as completed results. Subtitle downloads are converted to private delivery tickets before either transport returns them. Prepared releases are memoized within the operation, so the final ranking pass does not recreate external jobs. Final ordering remains authoritative; the TV does not autoplay a partial candidate. Back opens the available source picker and cancels discovery, allowing the viewer to choose immediately. Source session IDs remain stable across reordering.

Limits are 45 seconds per server operation, 60 seconds per TV attempt, six delegated fetches, two concurrent TV fetches, 80 metadata entries per reply, 360 KB of total delegated metadata, 512 KiB per JSON message and twelve returned candidates. The TV uses the existing source adapter's URL allowlist and strips URLs, headers, cache claims and credentials from returned metadata. The Worker independently sanitizes those replies. TV fetches time out after twelve seconds; pending server exchanges allow thirteen seconds.

The TV reconnects at most twice, with 500 ms and 1.5 second delays, and resumes the same request. The object retains its last snapshot and completion for two minutes after the operation deadline. If a runtime reset interrupts active work, the persisted running marker prevents it from being repeated. An absent or expired record is also treated as an interruption, never as proof that side effects did not occur. Usable partial choices survive an ordinary interruption, but authorization failures discard them.

HTTP fallback is automatic when WebSocket support or channel admission is unavailable, or a handshake fails before a start could have been sent. After a start may have reached the Worker, reconnect exhaustion does not start another HTTP or linked-device resolve. This avoids duplicate external jobs. The existing signed HTTP continuation remains supported for older Companions.

## Deployment and migration

Wrangler, direct desktop deployment, the Companion desktop/mobile installer, the stable build installer and automatic self-update all declare the SQLite class through Cloudflare's `exports` metadata and add its namespace binding. Repeated declarations are idempotent. Wrangler 4.127.1 or newer is required. There is no new D1 migration and no pairing reset.

Release packages retain schema 1 and add `resolveChannel: 1`. An older automatic updater can install the new program while omitting its new binding; that installation continues serving HTTP. The new updater recognizes the missing binding and redeploys the same verified stable version with the required metadata on its next eligible check. Existing deployment leases, update opt-out and six-hour retry backoff still apply. Installations without retained deployment access can acquire the binding by updating through Izumi or the installer. Set `TV_RESOLVE_WEBSOCKET=false` to disable channel admission while keeping HTTP available.

Cloudflare documents that a class appearing only in code is ignored until declared in `exports`, and that repeating a live declaration leaves its namespace intact: [class lifecycle and migrations](https://developers.cloudflare.com/durable-objects/reference/durable-objects-migrations/). Hibernation mechanics are documented under [WebSocket best practices](https://developers.cloudflare.com/durable-objects/best-practices/websockets/).

## Verification

Run the Worker Vitest suite, `node cloudflare-sync-worker/tests/resolve-channel-runtime.mjs`, the bundle freshness check and Wrangler's dry run. The native runtime test covers actual WebSocket upgrade, automatic heartbeat, progressive delivery, fetch delegation and reconnect. Unit tests additionally cover reconstruction, interrupted records, profile revocation, single-use admission, replay rejection, cancellation and migration repair. Companion tests cover transport fallback, reconnect, cancellation, delegated concurrency, progressive receiver delivery and stable candidate identity. Physical TV playback and a production Cloudflare rollout require separate validation.
