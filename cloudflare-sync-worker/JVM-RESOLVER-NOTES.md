# JVM resolver feasibility

Status: research only. Version 1.2 does not execute JVM extensions.

## Boundary

Source resolution may run remotely, but playback must not. A successful resolver returns source
metadata (URL, content type, supported request metadata, and subtitles) to the paired TV. The TV
then connects to that source and plays it directly. Neither the Worker nor any browser session
downloads, proxies, or relays the media.

A source provider may occasionally create a temporary URL that only accepts the public IP which
performed resolution. If resolution happened on Cloudflare, that URL could reject the TV's later
request from the household IP. This is a source-validity edge case, not an alternate playback
design: the TV should reject the candidate and fall back to another source or the paired client.

## Why an ordinary Worker cannot host the current bridge

The AnymeX bridge is an open-world JVM host. It loads extension bytecode dynamically and depends
on Java reflection, class loading, threads, a filesystem facade, and Android/OkHttp compatibility.
An ordinary Worker isolate has a 128 MiB memory ceiling (including WebAssembly), a one-second
startup limit, and no native process in which to launch the bridge. The bridge's current JVM heap
configuration alone is larger than that ceiling.

Ahead-of-time compilers do not preserve this model. TeaVM explicitly restricts reflection,
resources, class loaders, and JNI, and expects incompatible applications to be rewritten. A
provider-by-provider Wasm port may be viable in the long term, but it would be a replacement
runtime rather than automatically consuming the existing extension APK/JAR set.

References:

- [Cloudflare Worker limits](https://developers.cloudflare.com/workers/platform/limits/)
- [TeaVM overview and compatibility boundaries](https://teavm.org/docs/intro/overview.html)
- [AnymeX extension runtime bridge](https://github.com/RyanYuuki/AnymeXExtensionRuntimeBridge)

## Non-container experiment worth testing

Cloudflare Browser Run can launch full Chromium from a binding on the user's Worker. CheerpJ runs
Java 8/11/17 bytecode inside a browser and documents support for reflection and dynamic class
loading. Its library mode exposes Java classes and methods to JavaScript, so it is the only
currently credible non-container route for exercising the existing bridge with limited changes.

This is not ready to add to Izumi. A spike should proceed in this order:

1. Run CheerpJ in local headless Chromium and load the desktop bridge plus one simple, converted
   AniYomi extension.
2. Expose only `search`, `getDetail`, and `getVideoList` through CheerpJ library mode.
3. Route extension HTTP through a same-origin, authenticated fetch adapter with strict response
   limits and SSRF protections. Return source metadata only.
4. Prove a direct non-localhost source is returned with the extension unchanged.
5. Repeat the exact harness using Browser Run from the user's own Worker and measure cold start,
   warm start, browser minutes, memory, and provider compatibility.
6. Before production work, confirm this server-side Browser Run use with Leaning Technologies.
   The community licence permits FOSS/evaluation use from their hosted runtime, while self-hosting
   is a commercial feature.

The spike succeeds only if a real extension works unchanged, cold resolution is tolerable, all
control traffic stays within the user's Worker deployment, and no media bytes cross Cloudflare.
Failure should leave the current Stremio resolver and paired-client fallback untouched.

References:

- [Cloudflare Browser Run limits](https://developers.cloudflare.com/browser-run/limits/)
- [Cloudflare Browser Run pricing](https://developers.cloudflare.com/browser-run/pricing/)
- [CheerpJ overview](https://cheerpj.com/docs/overview.html)
- [CheerpJ library mode](https://cheerpj.com/docs/guides/library-mode)
- [CheerpJ licensing](https://cheerpj.com/docs/licensing)

## Alternatives not selected

- **CheerpJ in the Worker isolate:** it expects browser facilities and still encounters the
  isolate's memory and startup constraints.
- **JavaBox:** technically interesting, but its project maturity, memory profile, Web Worker
  requirements, and unclear top-level licensing make it unsuitable for an automatic deployment.
- **TeaVM/JWebAssembly/Kotlin Wasm:** useful for controlled applications, not for loading arbitrary
  Android/JVM extensions without rewriting their host and dependencies.
- **A JVM behind Cloudflare Tunnel:** requires an always-on machine or another compute provider and
  therefore does not satisfy the self-contained Worker goal.
- **Cloudflare Containers:** intentionally deferred.
