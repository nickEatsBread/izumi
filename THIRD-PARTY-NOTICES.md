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

## Other dependencies

All remaining npm and Cargo dependencies are permissively licensed (MIT, Apache-2.0,
BSD-3-Clause, ISC). Refer to each package for its full license text.
