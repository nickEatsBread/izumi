# JVM resolver feasibility

Status: rejected for the Worker resolver. The Worker does not execute JVM extensions.

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

## CheerpJ / Browser Run decision

Cloudflare Browser Run can launch full Chromium from a binding on the user's Worker. CheerpJ runs
Java 8/11/17 bytecode inside a browser and documents support for reflection and dynamic class
loading. A local probe confirmed that CheerpJ 4.3 could initialize Java 17, load the real 41.9 MiB
AnymeX v2.3.0 desktop runtime JAR, resolve its Gson/coroutines/OkHttp classes, create its writable
filesystem directory, and complete an empty extension scan. Cold bridge-library readiness took
roughly 3.5–7.8 seconds on the test machine.

That result proves bytecode loading only; it does not make this a viable Izumi architecture.
CheerpJ transparently supports HTTP(S) to the browser page's same origin, while real extensions use
OkHttp against arbitrary provider origins. Supporting them would require a fetch/proxy adapter,
URL rewriting or runtime changes, and a second browser execution environment. Source work would
then be split across the Worker, headless browser, extension runtime, and TV. This creates unclear
ownership, duplicated failure modes, and a large compatibility/security surface.

Izumi will therefore not pursue CheerpJ or Browser Run for JVM source resolution. The short-lived
probe artifacts were not committed. The direct Stremio resolver and paired-client fallback remain
the supported paths.

References:

- [Cloudflare Browser Run limits](https://developers.cloudflare.com/browser-run/limits/)
- [Cloudflare Browser Run pricing](https://developers.cloudflare.com/browser-run/pricing/)
- [CheerpJ overview](https://cheerpj.com/docs/overview.html)
- [CheerpJ library mode](https://cheerpj.com/docs/guides/library-mode)
- [CheerpJ licensing](https://cheerpj.com/docs/licensing)

## Alternatives not selected

- **CheerpJ in the Worker isolate or Browser Run:** rejected above. Loading works in Chromium, but
  provider networking and split execution make the complete source flow unsuitable.
- **JavaBox:** technically interesting, but its project maturity, memory profile, Web Worker
  requirements, and unclear top-level licensing make it unsuitable for an automatic deployment.
- **TeaVM/JWebAssembly/Kotlin Wasm:** useful for controlled applications, not for loading arbitrary
  Android/JVM extensions without rewriting their host and dependencies.
- **A JVM behind Cloudflare Tunnel:** requires an always-on machine or another compute provider and
  therefore does not satisfy the self-contained Worker goal.
- **Cloudflare Containers:** intentionally deferred.
