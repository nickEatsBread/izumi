# Worker update runtime repair

The September 8 development Worker update failed before its first deployment API
request. The updater set `redirect: 'error'`, which Node fetch accepts but workerd
rejects when constructing a Request. The recorded failure also prevented another
attempt for six hours. A queued response is therefore not proof of installation.

Use `redirect: 'manual'` for both authenticated deployment API requests and the
legacy deploy hook. The existing response-status check rejects redirects without
forwarding credentials to another location. Release asset downloads still follow
their normal public download redirects and verify the package checksum.

`cloudflare-sync-worker/tests/worker-update-runtime.mjs` executes the updater in
Miniflare/workerd with a real D1 state table. It constructs outbound Requests in
the Worker runtime before routing them to local fixtures. Coverage includes
deployment, installed-version confirmation, the legacy hook, and rejecting
redirects without following them. Stable Worker publication runs this check.

The live development Worker was repaired in place and an authenticated update
request successfully installed stable Worker 1.13.2 over 1.13.1. The status then
reported `current`, with no error or retry delay. Because the already-published
1.13.2 package contains the same defect, the development installation also received
the two-line transport repair after updating. No database identity, pairing,
credentials or scheduled checks were replaced. The pending 1.14.0 source and
embedded installer bundle include the permanent fix; the public release feed
remains 1.13.2 until that release is published.

The HTTP updater's background operation still has the separate
[Cloudflare waitUntil time limit](https://developers.cloudflare.com/workers/runtime-apis/context/#waituntil).
That was not the observed failure: the failed deployment returned immediately,
and the repaired update completed within the existing execution window.
