# Vendored crates

Patched copies of librqbit 9.0.0 and two crates it depends on. The `[patch.crates-io]` section at
the end of `src-tauri/Cargo.toml` swaps them in.

| Crate | Version | Upstream |
| --- | --- | --- |
| `librqbit` | 9.0.0 | [ikatson/rqbit](https://github.com/ikatson/rqbit) `crates/librqbit` |
| `librqbit-dht` | 9.0.0 | [ikatson/rqbit](https://github.com/ikatson/rqbit) `crates/dht` |
| `librqbit-utp` | 0.7.0 | [ikatson/librqbit-utp](https://github.com/ikatson/librqbit-utp) |

Each directory is the published `.crate` archive unpacked unchanged, plus a patch described below
and a note at the top of each file it changes. The archives' sha256 matched the checksums Cargo.lock
had recorded for them. The one omission is librqbit's `webui/` directory: izumi builds librqbit
without its `webui` feature, and nothing else reads those sources. All three crates are Apache-2.0
(see `THIRD-PARTY-NOTICES.md`).

## librqbit: pieces a video player is waiting for

The player reads a torrent through librqbit's HTTP stream, which blocks until the piece at the read
position has arrived and been verified. librqbit gives each piece to a single peer, so one slow peer
holding that piece stalls playback while the rest of the swarm keeps delivering other pieces. In
one test the swarm delivered 91 MB in 9 seconds while the first piece of the file stayed missing.
The patch changes three things, in `src/piece_tracker.rs`, `src/torrent_state/live/mod.rs`,
`src/torrent_state/streaming.rs` and `src/chunk_tracker.rs`, and adds a passive read for scrub
previews:

- **Taking over a waited-for piece sooner.** The first eight pieces ahead of every open stream are
  "critical": mpv reads a release's embedded fonts, often several megabytes, before it shows
  anything. Before a peer starts anything else, it takes over a critical piece that another peer
  has held for 1.5 times this peer's average piece time, and never sooner than 500 ms. Upstream
  waits for ten times that average. A peer that has not completed a piece yet takes nothing.
- **Keeping what already arrived.** A peer that takes a piece over only requests the chunks that are
  still missing. Upstream requests every chunk again, in order, which put the missing ones last.
- **A request queue sized by delivery.** A peer serves requests in order, so a newly waited-for
  piece sits behind everything already asked of that peer. Upstream keeps up to 128 chunks (2 MiB)
  in flight per peer, several seconds at a typical peer's rate. The patch measures each peer's
  delivery rate while requests are outstanding and keeps about one second of it in flight: at
  least 16 chunks, 32 before the first measurement, and never more than the peer allows.

- **Passive reads for previews.** `ManagedTorrent::stream_passive` opens a stream that is not
  registered with the torrent, so it never changes which pieces are requested, and that fails at
  once on a piece that has not been downloaded instead of waiting for it. `FileStream::is_available`
  and `ManagedTorrent::file_range_downloaded` say whether a position or a byte range is already
  there. The seek bar's thumbnails read a direct torrent this way, so they never compete with the
  video the player is waiting for.

Unit tests cover the takeover rule, the chunk bookkeeping and the queue sizing
(`try_steal_critical`, `chunks_received_before_a_piece_completes_stay_downloaded` and
`delivery_rate_tests`).

To see the exact diff, unpack the published archive and compare:

```bash
curl -sL https://static.crates.io/crates/librqbit/librqbit-9.0.0.crate | tar -xz -C /tmp
diff -ru --exclude=webui /tmp/librqbit-9.0.0 src-tauri/vendor/librqbit
```

The tests run on the Windows dev box (keep the target directory outside the repo):

```bash
cargo test --locked --target-dir "$TEMP/vendor-target" --manifest-path src-tauri/vendor/librqbit/Cargo.toml --lib
```

This change is not upstream. Before moving to a newer librqbit, unpack its archive here and apply
the same change, or drop it if upstream has an equivalent.

## librqbit-dht and librqbit-utp: UDP receive errors on Windows

On Windows, `recv_from` on a UDP socket fails for three conditions that concern a single datagram.
The socket keeps working afterwards:

- WSAECONNRESET (10054): an earlier `send_to` got an ICMP port unreachable back.
- WSAENETRESET (10052): an earlier `send_to` got an ICMP time exceeded back.
- WSAEMSGSIZE (10040): the datagram was longer than the 16 KiB receive buffer.

Upstream returns on any receive error, in the DHT framer (`librqbit-dht/src/dht.rs`) and in the
uTP dispatcher (`librqbit-utp/src/socket.rs`). That ends the DHT worker or the uTP socket for the
rest of the session. After that, every DHT lookup fails with `DhtDead` and every uTP connect or
accept fails with `DispatcherDead`. Pausing and resuming torrents can't bring them back. One
unreachable DHT node or uTP peer is enough to cause it, and any host can send an oversized datagram.

The patch adds `is_datagram_error`, which matches these three codes on Windows only. Both loops now
skip such an error and keep reading. It also adds two tests to each crate that fail on Windows
without the patch.

Upstream merged the same commits on 2026-09-28:
[ikatson/rqbit#690](https://github.com/ikatson/rqbit/pull/690) (commit `2b123074`, closes
[ikatson/rqbit#664](https://github.com/ikatson/rqbit/issues/664)) and
[ikatson/librqbit-utp#4](https://github.com/ikatson/librqbit-utp/pull/4) (commit `1776dba`). No
crates.io release had them yet at that point; the latest were librqbit-dht 9.0.1 and
librqbit-utp 0.7.0.

To see the exact diff, unpack the published archive and compare:

```bash
curl -sL https://static.crates.io/crates/librqbit-dht/librqbit-dht-9.0.0.crate | tar -xz -C /tmp
diff -ru /tmp/librqbit-dht-9.0.0 src-tauri/vendor/librqbit-dht
```

## Checking it on Windows

izumi's own test binary doesn't start on the Windows dev box, but these crates' tests do. Keep the
target directory outside the repo. librqbit-utp's tests also build a C++ uTP implementation, which
needs MSVC.

```bash
cargo test --locked --target-dir "$TEMP/vendor-target" --manifest-path src-tauri/vendor/librqbit-dht/Cargo.toml --lib test_dht_answers_after
```

```bash
cargo test --locked --target-dir "$TEMP/vendor-target" --manifest-path src-tauri/vendor/librqbit-utp/Cargo.toml --lib e2e_test_connect_after
```

Other platforms never report these errors on an unconnected UDP socket, so there the tests pass with
or without the patch.

## Dropping it

Once librqbit-dht and librqbit-utp releases include the two upstream commits, delete their
directories and their lines in the `[patch.crates-io]` section, remove them from
`scripts/ci/librqbit-vendored-crates.test.ts`, and update those crates to the releases.

Until then, if a librqbit bump needs other DHT or uTP versions than the ones here, Cargo stops using
these copies and only prints a warning. `scripts/ci/librqbit-vendored-crates.test.ts` turns that
into a failure. The same test covers the librqbit copy. Unpack the new archives here and apply the
patches to them.
