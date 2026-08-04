# Third-party notices

izumi itself is licensed under the [GNU AGPL-3.0-or-later](LICENSE). It links or bundles
the third-party components below; their own licenses apply to those components only.

## mpv / libmpv — LGPL-2.1-or-later

izumi embeds the [mpv](https://github.com/mpv-player/mpv) media player through its C
library **libmpv**, via the Rust bindings [`libmpv2`](https://crates.io/crates/libmpv2)
and [`libmpv2-sys`](https://crates.io/crates/libmpv2-sys) (both LGPL-2.1).

libmpv is used as a **separate, replaceable dynamic library** (`libmpv-2.dll` on
Windows, `libmpv.so` on Linux) — you may substitute your own build of libmpv, as
required by the LGPL. Note that an individual mpv/libmpv build may be **GPL** rather
than LGPL depending on which optional components it was compiled with; when you
distribute izumi, comply with the license of the specific libmpv binary you ship.

- LGPL-2.1: https://www.gnu.org/licenses/lgpl-2.1.html
- mpv license details: https://github.com/mpv-player/mpv/blob/master/Copyright

## Fonts — SIL Open Font License 1.1

Nunito and Geist Mono are licensed under the [OFL-1.1](https://openfontlicense.org/).

The Android build additionally ships Nunito as a **font file** (not just a webfont) so the
embedded player's subtitle renderer can use it — Android has no Nunito of its own. It is fetched
from the upstream Google Fonts repository at build time by `scripts/fetch-subtitle-font.mjs`, which
stages the OFL text next to it inside the APK.

## @lucide/svelte — ISC (icons)

izumi's interface icons come from [@lucide/svelte](https://lucide.dev/). The build strips the
per-module license banners that lucide ships inside its source (they accounted for ~15% of all
shipped JavaScript), so the required notice is reproduced here in full instead.

```
ISC License

Copyright (c) 2026 Lucide Icons and Contributors

Permission to use, copy, modify, and/or distribute this software for any
purpose with or without fee is hereby granted, provided that the above
copyright notice and this permission notice appear in all copies.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES
WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF
MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR
ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES
WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN
ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF
OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.
```

A subset of Lucide's icons are derived from the Feather project and additionally carry the MIT
license, Copyright (c) 2013-present Cole Bemis. The full text and the list of affected icons are in
`node_modules/@lucide/svelte/LICENSE` and at
https://github.com/lucide-icons/lucide/blob/main/LICENSE.

## Other dependencies

All remaining npm and Cargo dependencies are permissively licensed (MIT, Apache-2.0,
BSD-3-Clause, ISC). Refer to each package for its full license text.

## Harbor subtitle synchronizer — MIT

Izumi's speech-interval subtitle alignment is adapted from Harbor:
https://github.com/harborstremio/harbor

Copyright (c) Harbor contributors. Licensed under the MIT License; the complete license is
available at https://github.com/harborstremio/harbor/blob/main/LICENSE.
